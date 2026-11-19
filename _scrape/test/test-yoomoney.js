// test-yoomoney.js — e2e проверка оплаты на кошелёк ЮMoney (quickpay + HTTP-уведомления).
// Проверяем: создание заказа, страницу go.php с формой, подпись sign, выдачу ключа,
// идемпотентность, отказ при неверной подписи и при заниженной сумме.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');
const site = path.join(root, 'site');
const ext = path.join(root, 'extension');
const dataDir = path.join(__dirname, 'tmp-yoomoney-data');
const PORT = 8105;
const BASE = 'http://127.0.0.1:' + PORT;
const RECEIVER = '4100119685733916';
const SECRET = 'ym-test-secret';
const BUYER = 'buyer@mail.ru';
const ADMIN = 'admin@example.ru';

const store = {};
global.chrome = {
  storage: {
    local: {
      get(key, cb) { const res = {}; if (store[key]) res[key] = store[key]; if (cb) cb(res); return Promise.resolve(res); },
      set(payload, cb) { Object.assign(store, payload); if (cb) cb(); return Promise.resolve(); }
    }
  }
};
eval(fs.readFileSync(path.join(ext, 'license.js'), 'utf8'));

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!ok) failed = 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RFC 3986, как в PHP rawurlencode — иначе подпись не сойдётся.
function enc(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) =>
    '%' + char.charCodeAt(0).toString(16).toUpperCase()
  );
}

function sign(params, secret) {
  const base = Object.keys(params)
    .filter((key) => key !== 'sign')
    .sort()
    .map((key) => key + '=' + enc(params[key]))
    .join('&');
  return require('crypto').createHmac('sha256', secret).update(base).digest('hex');
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) { data = {}; }
  return { status: res.status, data, text };
}

async function notify(params) {
  const full = Object.assign({ sign: sign(params, SECRET) }, params);
  const res = await fetch(BASE + '/api/webhook.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(full).toString()
  });
  const text = await res.text();
  return { status: res.status, text };
}

function notification(label, operationId, amount, extra) {
  return Object.assign({
    notification_type: 'card-incoming',
    operation_id: operationId,
    amount: amount,
    withdraw_amount: '199.00',
    currency: '643',
    datetime: '2026-11-14T15:00:00Z',
    sender: '',
    codepro: 'false',
    label: label,
    unaccepted: 'false'
  }, extra || {});
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean); } catch (e) { return []; }
}

function paymentFile(label) {
  return path.join(dataDir, 'payments', label + '.json');
}

function mailHas(needle) {
  const file = path.join(dataDir, 'mail.log');
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').indexOf(needle) !== -1;
}

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });

  const php = spawn('php', ['-S', '127.0.0.1:' + PORT, '-t', site], {
    env: Object.assign({}, process.env, {
      MS_ADMIN_SECRET: 'test-secret',
      MS_PROVIDER: 'yoomoney',
      MS_YOOMONEY_RECEIVER: RECEIVER,
      MS_YOOMONEY_SECRET: SECRET,
      MS_MAIL_TRANSPORT: 'log',
      MS_MAIL_ADMIN: ADMIN,
      MS_MAIL_REPLY_TO: ADMIN,
      MS_DATA_DIR: dataDir,
      MS_PAY_RATE_LIMIT: '50'
    }),
    stdio: 'ignore'
  });

  try {
    await sleep(1800);

    // 1. Заказ на оплату
    const pay = await postJson(BASE + '/api/pay.php', { plan: 'month', email: BUYER });
    const label = pay.data.payment_id;
    check('pay.php создал заказ ЮMoney', pay.status === 200 && /^MS-[a-f0-9]{16}$/.test(String(label)), label);
    check('ссылка ведёт на api/go.php',
      String(pay.data.confirmation_url || '').indexOf('/api/go.php?label=') !== -1, pay.data.confirmation_url);

    // 2. Страница с формой быстрой оплаты
    const page = await fetch(pay.data.confirmation_url);
    const html = await page.text();
    check('go.php отдаёт форму', page.status === 200 && html.indexOf('https://yoomoney.ru/quickpay/confirm') !== -1);
    check('получатель — кошелёк', html.indexOf('name="receiver" value="' + RECEIVER + '"') !== -1);
    check('сумма 199.00', html.indexOf('name="sum" value="199.00"') !== -1);
    check('метка в форме', html.indexOf('name="label" value="' + label + '"') !== -1);
    check('quickpay-form=button, оплата картой',
      html.indexOf('name="quickpay-form" value="button"') !== -1 && html.indexOf('name="paymentType" value="AC"') !== -1);

    // 3. Уведомление о переводе (с комиссией 3%: зачислено 193.03 из 199)
    const note = await notify(notification(label, 'op-1001', '193.03'));
    const paidFile = readJson(paymentFile(label)) || {};
    check('уведомление принято — 200 OK', note.status === 200 && note.text === 'OK', note.text);
    check('ключ выдан', typeof paidFile.key === 'string' && paidFile.key.indexOf('MS1.') === 0,
      String(paidFile.key).slice(0, 24) + '…');
    check('сохранены операция и зачисление',
      paidFile.operation_id === 'op-1001' && paidFile.paid_amount === 193.03,
      paidFile.operation_id + '/' + paidFile.paid_amount);
    const verified = await msVerifyLicenseKey(paidFile.key);
    check('расширение принимает ключ', verified.ok === true, verified.error || verified.tier);
    check('письмо покупателю ушло', mailHas(BUYER));
    check('копия администратору ушла', mailHas(ADMIN));
    const issued = readLines(path.join(dataDir, 'issued.log'));
    check('журнал: 1 запись с YM-op-1001', issued.length === 1 && issued[0].indexOf('YM-op-1001') !== -1, issued.length);

    // 4. Повтор уведомления
    const dup = await notify(notification(label, 'op-1001', '193.03'));
    check('повтор — 200', dup.status === 200, dup.text);
    check('второй ключ не выпущен',
      (readJson(paymentFile(label)) || {}).key === paidFile.key && readLines(path.join(dataDir, 'issued.log')).length === 1);

    // 5. Подпись не сходится
    const forged = Object.assign(notification(label, 'op-1002', '193.03'), { sign: 'deadbeef' });
    const forgedRes = await fetch(BASE + '/api/webhook.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(forged).toString()
    });
    check('неверная подпись — 403', forgedRes.status === 403, forgedRes.status);

    // 6. Сумма меньше тарифа
    const yearPay = await postJson(BASE + '/api/pay.php', { plan: 'year', email: BUYER });
    const yearLabel = yearPay.data.payment_id;
    await notify(notification(yearLabel, 'op-1003', '100.00', { withdraw_amount: '103.09' }));
    const yearFile = readJson(paymentFile(yearLabel)) || {};
    check('заниженная сумма — без ключа', !yearFile.key, yearFile.status);
    check('предупреждение администратору', mailHas('перевод меньше тарифа'));

    // 7. Код протекции — ключ не выдаём
    const heldPay = await postJson(BASE + '/api/pay.php', { plan: 'month', email: BUYER });
    const heldLabel = heldPay.data.payment_id;
    await notify(notification(heldLabel, 'op-1004', '193.03', { codepro: 'true' }));
    check('codepro=true — без ключа', !(readJson(paymentFile(heldLabel)) || {}).key);

    // 8. Неизвестная метка
    const unknown = await notify(notification('MS-0000000000000000', 'op-1005', '193.03'));
    check('неизвестная метка — 200 без падения', unknown.status === 200, unknown.text);

    // 9. Несуществующий заказ на странице оплаты
    const missing = await fetch(BASE + '/api/go.php?label=MS-0000000000000000');
    check('go.php для неизвестного заказа — 404', missing.status === 404, missing.status);

    console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
  } finally {
    php.kill();
  }

  if (!failed) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  process.exit(failed);
})().catch((error) => {
  console.error('ERROR:', error && error.message);
  process.exit(1);
});
