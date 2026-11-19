// test-worker-pay.js — проверка онлайн-оплаты через Cloudflare Worker без реального ЮKassa.
// Мокаем fetch (api.yookassa.ru, Resend) и KV, вызываем worker.fetch напрямую:
// сайт статический (GitHub Pages), поэтому весь платёжный путь живёт в server/src/index.js.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const workerPath = path.join(root, 'server', 'src', 'index.js');

const SHOP_ID = '1529556';
const SECRET = 'test_yookassa_secret';
const BUYER = 'buyer@mail.ru';
const ADMIN = 'admin@example.ru';

// Верификатор ключей из расширения — им же проверяем ключ, выданный Worker'ом.
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

// --- мок KV ---
const kvStore = new Map();
const kv = {
  async get(key, type) {
    const value = kvStore.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  },
  async put(key, value) { kvStore.set(key, value); }
};

// --- мок ЮKassa и Resend ---
const payments = new Map();
const mails = [];
let seq = 0;
let lastAuth = '';
let lastBody = null;
let rejectReceiptOnce = false;

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const options = init || {};

  if (url.indexOf('https://yookassa.test/v3') === 0) {
    lastAuth = (options.headers && options.headers.Authorization) || '';

    if (url === 'https://yookassa.test/v3/payments' && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      lastBody = body;
      if (rejectReceiptOnce && body.receipt) {
        rejectReceiptOnce = false;
        return jsonResponse(400, {
          type: 'error',
          code: 'invalid_request',
          description: 'Receipt is invalid: vat_code',
          parameter: 'receipt.items[0].vat_code'
        });
      }
      seq += 1;
      const id = 'yk-' + String(seq).padStart(4, '0');
      payments.set(id, {
        id,
        status: 'pending',
        paid: false,
        amount: body.amount,
        metadata: body.metadata || {},
        receipt: body.receipt || null,
        confirmation: { type: 'redirect', confirmation_url: 'https://yookassa.test/checkout/' + id },
        created_at: new Date().toISOString()
      });
      return jsonResponse(200, payments.get(id));
    }

    const match = url.match(/\/v3\/payments\/([A-Za-z0-9_-]+)$/);
    if (match) {
      const payment = payments.get(match[1]);
      return payment ? jsonResponse(200, payment) : jsonResponse(404, { type: 'error', code: 'not_found' });
    }

    return jsonResponse(404, { type: 'error', code: 'not_found' });
  }

  if (url === 'https://api.resend.com/emails') {
    const body = JSON.parse(options.body || '{}');
    mails.push({ to: (body.to || [])[0], subject: body.subject, text: body.text });
    return jsonResponse(200, { id: 'mail-' + mails.length });
  }

  throw new Error('неожиданный fetch: ' + url);
};

function paymentState(id, patch) {
  const payment = payments.get(id);
  if (!payment) throw new Error('нет платежа ' + id);
  Object.assign(payment, patch);
}

function mailTo(address) {
  return mails.filter((mail) => mail.to === address);
}

function readRecord(id) {
  const raw = kvStore.get('payment:' + id);
  return raw ? JSON.parse(raw) : null;
}

function baseEnv(overrides) {
  return Object.assign({
    YOOKASSA_SHOP_ID: SHOP_ID,
    YOOKASSA_SECRET_KEY: SECRET,
    YOOKASSA_API_URL: 'https://yookassa.test/v3',
    RETURN_URL: 'https://sniper.gadget-nakhodki.ru/thanks.html',
    SEND_RECEIPT: '1',
    MAIL_ADMIN: ADMIN,
    MAIL_FROM: 'Маркет-Снайпер <no-reply@example.ru>',
    RESEND_API_KEY: 'resend-test',
    SITE_URL: 'https://sniper.gadget-nakhodki.ru',
    PRIVATE_KEY_B64: fs.readFileSync(path.join(root, 'server', 'keys', 'dev-private.txt'), 'utf8').trim(),
    LICENSES: kv
  }, overrides || {});
}

async function call(worker, env, pathName, options) {
  const request = new Request('https://api.test' + pathName, options);
  const response = await worker.fetch(request, env);
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) { data = {}; }
  return { status: response.status, text, data, headers: response.headers };
}

function postJson(body, headers) {
  return {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  };
}

(async () => {
  const worker = (await import(pathToFileURL(workerPath).href)).default;
  const env = baseEnv();

  // 1. Health и пустой конфиг
  const health = await call(worker, env, '/api/health');
  check('health: ЮKassa и KV подключены',
    health.status === 200 && health.data.hasYooKassa === true && health.data.hasKv === true);

  const noKeys = await call(worker, baseEnv({ YOOKASSA_SECRET_KEY: '' }), '/api/pay',
    postJson({ plan: 'month', email: BUYER }));
  check('pay без ключей — 503 с подсказкой про СБП',
    noKeys.status === 503 && String(noKeys.data.error || '').indexOf('СБП') !== -1, noKeys.text);

  const noEmail = await call(worker, env, '/api/pay', postJson({ plan: 'month', email: 'нет-почты' }));
  check('pay без e-mail — 400', noEmail.status === 400, noEmail.text);

  // 2. Создание платежа
  const pay = await call(worker, env, '/api/pay', postJson({ plan: 'month', email: BUYER }));
  const paymentId = pay.data.payment_id;
  check('pay создал платёж', pay.status === 200 && !!paymentId, paymentId);
  check('ссылка на оплату ЮKassa', String(pay.data.confirmation_url || '').indexOf('yookassa.test/checkout/') !== -1);
  check('Basic-авторизация shopId:secret',
    lastAuth === 'Basic ' + Buffer.from(SHOP_ID + ':' + SECRET).toString('base64'));
  check('сумма 199.00 RUB', lastBody.amount.value === '199.00' && lastBody.amount.currency === 'RUB');
  check('чек с e-mail покупателя', !!lastBody.receipt && lastBody.receipt.customer.email === BUYER);
  check('CORS для статического сайта', pay.headers.get('Access-Control-Allow-Origin') === '*');
  check('заказ записан в KV как pending', (readRecord(paymentId) || {}).status === 'pending');

  // 3. Магазин без фискализации: чек отклонён — повтор без чека
  rejectReceiptOnce = true;
  const retry = await call(worker, env, '/api/pay', postJson({ plan: 'month', email: BUYER }));
  check('повтор без чека сработал', retry.status === 200 && !!retry.data.payment_id, retry.data.payment_id);
  check('во втором запросе чека нет', lastBody.receipt === undefined);

  // 4. Webhook до оплаты — ключа нет
  const early = await call(worker, env, '/api/webhook', postJson({ event: 'payment.succeeded', object: { id: paymentId } }));
  check('webhook до оплаты — 200 без ключа', early.status === 200 && !(readRecord(paymentId) || {}).key, early.text);

  // 5. Оплата прошла — ключ, письма, KV
  paymentState(paymentId, { status: 'succeeded', paid: true });
  const paid = await call(worker, env, '/api/webhook', postJson({ event: 'payment.succeeded', object: { id: paymentId } }));
  const record = readRecord(paymentId) || {};
  check('webhook после оплаты — 200 OK', paid.status === 200 && paid.text === 'OK', paid.text);
  check('ключ выдан', typeof record.key === 'string' && record.key.indexOf('MS1.') === 0,
    String(record.key).slice(0, 20) + '…');
  check('статус paid и письмо отправлено', record.status === 'paid' && record.mailSent === true);
  check('в ключе 30 дней', Math.round((record.exp - Math.floor(Date.now() / 1000)) / 86400) === 30, record.exp);

  const verified = await msVerifyLicenseKey(record.key);
  check('расширение принимает ключ', verified.ok === true, verified.error || verified.tier);
  check('письмо покупателю ушло', mailTo(BUYER).length === 1);
  check('копия администратору ушла', mailTo(ADMIN).length === 1);
  check('в письме есть ключ', (mailTo(BUYER)[0] || {}).text.indexOf(record.key) !== -1);
  check('номер платежа в письме', (mailTo(BUYER)[0] || {}).text.indexOf(paymentId) !== -1);

  // 6. Повторный webhook не выдаёт второй ключ
  const dup = await call(worker, env, '/api/webhook', postJson({ event: 'payment.succeeded', object: { id: paymentId } }));
  check('повтор webhook — 200', dup.status === 200, dup.text);
  check('ключ не изменился', (readRecord(paymentId) || {}).key === record.key);
  check('второе письмо не отправлено', mailTo(BUYER).length === 1);

  // 7. Подмена суммы: годовой тариф оплачен на 199 ₽
  const yearPay = await call(worker, env, '/api/pay', postJson({ plan: 'year', email: BUYER }));
  const yearId = yearPay.data.payment_id;
  paymentState(yearId, { status: 'succeeded', paid: true, amount: { value: '199.00', currency: 'RUB' } });
  const mismatch = await call(worker, env, '/api/webhook',
    postJson({ event: 'payment.succeeded', object: { id: yearId } }));
  check('неверная сумма — 200 без ключа', mismatch.status === 200 && !(readRecord(yearId) || {}).key, mismatch.text);
  check('администратору ушло предупреждение',
    mailTo(ADMIN).some((mail) => mail.subject.indexOf('сумма платежа не совпала') !== -1));

  // 8. Отмена платежа
  const canceledPay = await call(worker, env, '/api/pay', postJson({ plan: 'month', email: BUYER }));
  const canceledId = canceledPay.data.payment_id;
  paymentState(canceledId, { status: 'canceled' });
  const canceled = await call(worker, env, '/api/webhook',
    postJson({ event: 'payment.canceled', object: { id: canceledId } }));
  check('отмена — 200 без ключа', canceled.status === 200 && !(readRecord(canceledId) || {}).key, canceled.text);
  check('статус canceled', (readRecord(canceledId) || {}).status === 'canceled');

  // 9. Неизвестный платёж — 200, чтобы ЮKassa не повторяла
  const unknown = await call(worker, env, '/api/webhook',
    postJson({ event: 'payment.succeeded', object: { id: 'yk-9999' } }));
  check('неизвестный платёж — 200 OK', unknown.status === 200 && unknown.text === 'OK', unknown.text);

  // 10. Страница «Спасибо»: статус и ключ по номеру платежа
  const status = await call(worker, env, '/api/pay/status?id=' + paymentId);
  check('status отдаёт ключ', status.status === 200 && status.data.key === record.key && status.data.status === 'paid');
  const badStatus = await call(worker, env, '/api/pay/status?id=' + encodeURIComponent('плохой!'));
  check('status без корректного id — 400', badStatus.status === 400, badStatus.text);
  const missingStatus = await call(worker, env, '/api/pay/status?id=yk-0000');
  check('status неизвестного платежа — 404', missingStatus.status === 404, missingStatus.text);

  // 11. Ограничение частоты
  for (const key of Array.from(kvStore.keys())) {
    if (key.indexOf('rl:') === 0) kvStore.delete(key);
  }
  const limited = baseEnv({ PAY_RATE_LIMIT: '2' });
  await call(worker, limited, '/api/pay', postJson({ plan: 'month', email: BUYER }));
  await call(worker, limited, '/api/pay', postJson({ plan: 'month', email: BUYER }));
  const blocked = await call(worker, limited, '/api/pay', postJson({ plan: 'month', email: BUYER }));
  check('третья попытка с IP при лимите 2 — 429', blocked.status === 429, blocked.text);

  console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
  process.exit(failed);
})().catch((error) => {
  console.error('ERROR:', error && error.message);
  process.exit(1);
});


