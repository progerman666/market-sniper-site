// test-yookassa.js — e2e проверка онлайн-оплаты без реального ЮKassa.
// Поднимаем мок API ЮKassa + php -S, проходим путь pay.php -> webhook.php -> ключ -> письмо.
// Проверяем: чек и его повтор без чека, идемпотентность, подмену суммы, отмену, неизвестный платёж.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');
const site = path.join(root, 'site');
const ext = path.join(root, 'extension');
const dataDir = path.join(__dirname, 'tmp-yookassa-data');
const PORT = 8103;
const MOCK_PORT = 8104;
const BASE = 'http://127.0.0.1:' + PORT;
const SHOP_ID = '4100119685733916';
const SECRET = 'test_yookassa_secret';
const BUYER = 'buyer@mail.ru';
const ADMIN = 'admin@example.ru';

// Верификатор ключей из расширения
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
const payments = new Map();
let seq = 0;
let lastAuth = '';
let lastBody = null;
let rejectReceiptOnce = false;

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    lastAuth = req.headers.authorization || '';

    if (req.method === 'POST' && req.url === '/v3/payments') {
      const body = JSON.parse(raw || '{}');
      lastBody = body;
      if (rejectReceiptOnce && body.receipt) {
        rejectReceiptOnce = false;
        send(400, {
          type: 'error',
          code: 'invalid_request',
          description: 'Receipt is invalid: vat_code',
          parameter: 'receipt.items[0].vat_code'
        });
        return;
      }
      seq += 1;
      const id = 'yk-' + String(seq).padStart(4, '0');
      payments.set(id, {
        id,
        status: 'pending',
        paid: false,
        amount: body.amount,
        metadata: body.metadata || {},
        confirmation: { type: 'redirect', confirmation_url: 'https://yookassa.test/checkout/' + id },
        created_at: new Date().toISOString()
      });
      send(200, payments.get(id));
      return;
    }

    const getMatch = req.url.match(/^\/v3\/payments\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && getMatch) {
      const payment = payments.get(getMatch[1]);
      if (!payment) { send(404, { type: 'error', code: 'not_found' }); return; }
      send(200, payment);
      return;
    }

    const stateMatch = req.url.match(/^\/__state\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'POST' && stateMatch) {
      const payment = payments.get(stateMatch[1]);
      if (!payment) { send(404, { type: 'error', code: 'not_found' }); return; }
      const patch = JSON.parse(raw || '{}');
      if (patch.status) { payment.status = patch.status; }
      if (patch.paid !== undefined) { payment.paid = patch.paid; }
      if (patch.amount) { payment.amount = patch.amount; }
      send(200, payment);
      return;
    }

    send(404, { type: 'error', code: 'not_found' });
  });
});

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

function webhook(paymentId, event) {
  return postJson(BASE + '/api/webhook.php', {
    type: 'notification',
    event: event || 'payment.succeeded',
    object: { id: paymentId }
  });
}

function setPaymentState(paymentId, patch) {
  return postJson('http://127.0.0.1:' + MOCK_PORT + '/__state/' + paymentId, patch);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function mailHas(needle) {
  return fs.existsSync(path.join(dataDir, 'mail.log')) &&
    fs.readFileSync(path.join(dataDir, 'mail.log'), 'utf8').indexOf(needle) !== -1;
}

function paymentFile(paymentId) {
  return path.join(dataDir, 'payments', paymentId + '.json');
}

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

  const php = spawn('php', ['-S', '127.0.0.1:' + PORT, '-t', site], {
    env: Object.assign({}, process.env, {
      MS_ADMIN_SECRET: 'test-secret',
      MS_PROVIDER: 'yookassa',
      MS_YOOKASSA_SHOP_ID: SHOP_ID,
      MS_YOOKASSA_SECRET_KEY: SECRET,
      MS_YOOKASSA_API_URL: 'http://127.0.0.1:' + MOCK_PORT + '/v3',
      MS_RETURN_URL: BASE + '/thanks.html',
      MS_SEND_RECEIPT: '1',
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

    // 1. Без e-mail платёж не создаём
    const noEmail = await postJson(BASE + '/api/pay.php', { plan: 'month' });
    check('pay.php без e-mail — 400', noEmail.status === 400, noEmail.data.error);

    // 2. Создание платежа: месяц, 199 ₽, чек с почтой покупателя
    const pay = await postJson(BASE + '/api/pay.php', { plan: 'month', email: BUYER });
    const paymentId = pay.data.payment_id;
    const authOk = lastAuth === 'Basic ' + Buffer.from(SHOP_ID + ':' + SECRET).toString('base64');
    check('pay.php создал платёж', pay.status === 200 && pay.data.ok === true && !!paymentId, paymentId);
    check('ссылка на оплату ЮKassa', String(pay.data.confirmation_url || '').indexOf(paymentId) !== -1, pay.data.confirmation_url);
    check('Basic-авторизация shop_id:secret_key', authOk, String(lastAuth).slice(0, 12) + '…');
    check('сумма 199.00 RUB', lastBody.amount.value === '199.00' && lastBody.amount.currency === 'RUB', JSON.stringify(lastBody.amount));
    check('чек содержит e-mail покупателя', lastBody.receipt.customer.email === BUYER, JSON.stringify(lastBody.receipt.customer));

    // 3. Уведомление приходит раньше оплаты — ключ не выдаём
    const pendingHook = await webhook(paymentId);
    const pendingFile = readJson(paymentFile(paymentId)) || {};
    check('webhook до оплаты — 200 без ключа', pendingHook.status === 200 && !pendingFile.key, pendingHook.text);

    // 4. Оплата прошла — ключ выдан и письмо отправлено
    await setPaymentState(paymentId, { status: 'succeeded', paid: true });
    const paidHook = await webhook(paymentId);
    const paidFile = readJson(paymentFile(paymentId)) || {};
    check('webhook после оплаты — 200 OK', paidHook.status === 200 && paidHook.text === 'OK', paidHook.text);
    check('ключ записан в платёж', typeof paidFile.key === 'string' && paidFile.key.indexOf('MS1.') === 0,
      String(paidFile.key).slice(0, 24) + '…');
    check('статус paid и mailSent', paidFile.status === 'paid' && paidFile.mailSent === true,
      paidFile.status + '/' + paidFile.mailSent);

    const verified = await msVerifyLicenseKey(paidFile.key);
    check('расширение принимает ключ из оплаты', verified.ok === true, verified.error || verified.tier);
    check('в ключе 30 дней', Math.round((paidFile.exp - Math.floor(Date.now() / 1000)) / 86400) === 30, paidFile.exp);

    check('письмо покупателю ушло', mailHas(BUYER), BUYER);
    check('копия администратору ушла', mailHas(ADMIN), ADMIN);
    check('отправка отмечена успешной', mailHas('"ok":true'));

    const issuedLog = path.join(dataDir, 'issued.log');
    const issuedAfterPaid = readLines(issuedLog);
    check('журнал выдачи: 1 запись', issuedAfterPaid.length === 1, issuedAfterPaid.length);
    check('заказ = номер платежа', issuedAfterPaid[0].indexOf('ЮK-' + paymentId) !== -1, issuedAfterPaid[0].slice(0, 90));

    // 5. Повторный webhook не выдаёт второй ключ
    const dupHook = await webhook(paymentId);
    const dupFile = readJson(paymentFile(paymentId)) || {};
    check('повторный webhook — 200', dupHook.status === 200, dupHook.text);
    check('ключ не изменился', dupFile.key === paidFile.key);
    check('вторая запись в журнале не появилась', readLines(issuedLog).length === 1, readLines(issuedLog).length);

    // 6. Магазин без фискализации: чек отклонён — pay.php повторяет без чека
    rejectReceiptOnce = true;
    const retry = await postJson(BASE + '/api/pay.php', { plan: 'month', email: BUYER });
    const retryLog = fs.readFileSync(path.join(dataDir, 'payments.log'), 'utf8');
    check('повтор платежа без чека сработал', retry.status === 200 && !!retry.data.payment_id, retry.data.payment_id);
    check('в журнале отмечен receipt_retry', retryLog.indexOf('receipt_retry') !== -1);

    // 7. Подмена суммы: годовой тариф оплачен на 199 ₽ — ключ не выдаём
    const yearPay = await postJson(BASE + '/api/pay.php', { plan: 'year', email: BUYER });
    const yearId = yearPay.data.payment_id;
    await setPaymentState(yearId, { status: 'succeeded', paid: true, amount: { value: '199.00', currency: 'RUB' } });
    const mismatchHook = await webhook(yearId);
    const mismatchFile = readJson(paymentFile(yearId)) || {};
    check('неверная сумма — 200 без ключа', mismatchHook.status === 200 && !mismatchFile.key, mismatchHook.text);
    check('администратору ушло предупреждение', mailHas('сумма платежа не совпала'));
    check('журнал выдачи не вырос', readLines(issuedLog).length === 1, readLines(issuedLog).length);

    // 8. Отмена платежа
    const canceledPay = await postJson(BASE + '/api/pay.php', { plan: 'month', email: BUYER });
    const canceledId = canceledPay.data.payment_id;
    await setPaymentState(canceledId, { status: 'canceled' });
    const canceledHook = await webhook(canceledId, 'payment.canceled');
    const canceledFile = readJson(paymentFile(canceledId)) || {};
    check('отмена — 200 без ключа', canceledHook.status === 200 && !canceledFile.key, canceledHook.text);
    check('статус canceled', canceledFile.status === 'canceled', canceledFile.status);

    // 9. Неизвестный платёж — 200, чтобы ЮKassa не повторяла
    const unknownHook = await webhook('yk-9999');
    check('неизвестный платёж — 200 OK', unknownHook.status === 200 && unknownHook.text === 'OK', unknownHook.text);
    check('неизвестный платёж записан в журнал',
      fs.readFileSync(path.join(dataDir, 'payments.log'), 'utf8').indexOf('unknown_payment') !== -1);

    console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
  } finally {
    php.kill();
    mock.close();
  }

  if (!failed) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  process.exit(failed);
})().catch((error) => {
  console.error('ERROR:', error && error.message);
  mock.close();
  process.exit(1);
});
