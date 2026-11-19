// market-sniper-license — выдача и проверка лицензионных ключей «Маркет-Снайпера».
// Подпись ECDSA P-256: приватный ключ хранится только здесь (secret PRIVATE_KEY_B64),
// в расширении лежит публичный ключ, поэтому ключ нельзя подделать.

const PREFIX = 'MS1';
const MAX_DAYS = 400;

// Стартовая цена (199 ₽). При повышении: старым покупателям цена не меняется —
// при продлении вызывайте issue с тем же order и пропишите в KV price:<id>.
const PLANS = {
  month: { days: 30, price: 199 },
  year: { days: 365, price: 1990 }
};

// Сайт статический (GitHub Pages), поэтому создание платежа и webhook живут здесь.
// Секреты — только в окружении Worker: YOOKASSA_SECRET_KEY, RESEND_API_KEY.
const YK_API_DEFAULT = 'https://api.yookassa.ru/v3';
const PAYMENT_TTL = 400 * 86400; // запись о платеже переживает годовой тариф

function text(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// «199.00» -> 19900 копеек: сравнивать деньги в копейках надёжнее, чем во float.
function kopecks(value) {
  const num = Number(String(value || '0').replace(',', '.'));
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
}

function money(price) {
  return (Math.round(Number(price) * 100) / 100).toFixed(2);
}

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || ''));
}

function planTitle(name) {
  return name === 'year' ? 'Год' : 'Месяц';
}

function yookassaReady(env) {
  return !!(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY);
}

async function kvGet(env, key) {
  if (!env.LICENSES) return null;
  return env.LICENSES.get(key, 'json');
}

async function kvPut(env, key, value, ttl) {
  if (!env.LICENSES) return;
  await env.LICENSES.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);
}

// Ограничение частоты по IP: не больше limit платежей за час (KV, приблизительно).
async function rateLimit(env, bucket, limit) {
  if (!env.LICENSES || !limit) return true;
  const hour = Math.floor(Date.now() / 3600000);
  const key = 'rl:' + bucket + ':' + hour;
  const current = Number(await env.LICENSES.get(key)) || 0;
  if (current >= limit) return false;
  await env.LICENSES.put(key, String(current + 1), { expirationTtl: 7200 });
  return true;
}

async function yookassaRequest(env, method, path, payload, idempotenceKey) {
  const base = (env.YOOKASSA_API_URL || YK_API_DEFAULT).replace(/\/+$/, '');
  const headers = {
    Authorization: 'Basic ' + btoa(env.YOOKASSA_SHOP_ID + ':' + env.YOOKASSA_SECRET_KEY),
    Accept: 'application/json'
  };
  if (payload) headers['Content-Type'] = 'application/json';
  if (idempotenceKey) headers['Idempotence-Key'] = idempotenceKey;

  try {
    const response = await fetch(base + path, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined
    });
    let data = {};
    try { data = await response.json(); } catch (e) { data = {}; }
    return { status: response.status, data };
  } catch (e) {
    return { status: 0, data: {}, error: e && e.message ? e.message : 'сеть недоступна' };
  }
}

// Магазин без фискализации: ЮKassa отклоняет чек — повторяем запрос без него.
function isReceiptError(data) {
  const text = ((data && data.code) || '') + ' ' + ((data && data.description) || '') +
    ' ' + ((data && data.parameter) || '');
  return /receipt|чек|vat_code|fiscal|54-?фз/i.test(text);
}

// Письма — через Resend (у Workers нет SMTP). Если ключа нет, оплата всё равно
// проходит: ключ сохраняется и его можно забрать на thanks.html по номеру платежа.
async function sendMail(env, to, subject, body) {
  if (!env.RESEND_API_KEY || !to) return false;
  const from = env.MAIL_FROM || 'Маркет-Снайпер <no-reply@sniper.gadget-nakhodki.ru>';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, text: body })
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

function keyEmailText(record, siteUrl) {
  const until = new Date(record.exp * 1000).toLocaleDateString('ru-RU');
  const admin = record.adminEmail || 'goinslims@gmail.com';

  return 'Здравствуйте!\n\n'
    + 'Оплата получена — спасибо. Ваш ключ доступа к «Маркет-Снайперу»:\n\n'
    + record.key + '\n\n'
    + 'Тариф: ' + planTitle(record.plan) + ' (' + record.days + ' дн.), действует до ' + until + '.\n\n'
    + 'Как включить полную версию:\n'
    + '1. Нажмите на иконку «Маркет-Снайпер» на панели браузера.\n'
    + '2. Вставьте ключ в поле «Ключ доступа» и нажмите «ОК».\n'
    + '3. Бейдж с чистой прибылью появится на карточках Яндекс.Маркета.\n\n'
    + 'Ключ привязан к сроку, а не к устройству: его можно ввести и на другом компьютере.\n'
    + 'Если письмо попало в спам — добавьте наш адрес в контакты.\n\n'
    + 'Вопросы и возврат в течение 7 дней: ' + admin + '\n'
    + 'Номер платежа: ' + record.payment_id + '\n\n'
    + '--\n'
    + 'Маркет-Снайпер · ' + siteUrl + '\n'
    + 'Самозанятый Воробьев Евгений Александрович, ИНН 422194497805\n';
}

async function deliverKey(env, record) {
  const admin = env.MAIL_ADMIN || 'goinslims@gmail.com';
  const siteUrl = env.SITE_URL || 'https://sniper.gadget-nakhodki.ru';
  const sent = await sendMail(env, record.email, 'Ваш ключ доступа — Маркет-Снайпер',
    keyEmailText(Object.assign({ adminEmail: admin }, record), siteUrl));

  const adminText = 'Новая оплата «Маркет-Снайпер».\n\n'
    + 'Сумма: ' + record.amount + ' ₽\n'
    + 'Тариф: ' + planTitle(record.plan) + ' (' + record.days + ' дн.)\n'
    + 'Покупатель: ' + (record.email || 'адрес не указан') + '\n'
    + 'Платёж: ' + record.payment_id + '\n'
    + 'Ключ: ' + record.key + '\n'
    + 'Действует до: ' + new Date(record.exp * 1000).toLocaleDateString('ru-RU') + '\n\n'
    + 'Чек НПД: убедитесь, что провайдер передал его в «Мой налог».\n';

  await sendMail(env, admin, 'Оплата ' + record.amount + ' ₽ — ключ выдан', adminText);

  return sent;
}



function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers });
}

function b64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToB64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signToken(env, payload) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    b64ToBytes(env.PRIVATE_KEY_B64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, data)
  );
  return PREFIX + '.' + bytesToB64Url(data) + '.' + bytesToB64Url(signature);
}

async function keyId(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function readBody(request) {
  try {
    if ((request.headers.get('Content-Type') || '').indexOf('application/json') > -1) {
      return await request.json();
    }
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch (e) {
    return {};
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    if (url.pathname === '/' || url.pathname === '') {
      return cors(json({
        service: 'market-sniper-license',
        endpoints: [
          'GET /api/health',
          'GET /api/plans',
          'POST /api/pay',
          'GET /api/pay/status',
          'POST /api/webhook',
          'POST /api/license/issue',
          'POST /api/license/check'
        ]
      }));
    }

    if (url.pathname === '/api/health') {
      return cors(json({
        ok: true,
        service: 'market-sniper-license',
        hasKey: !!env.PRIVATE_KEY_B64,
        hasYooKassa: yookassaReady(env),
        hasKv: !!env.LICENSES
      }));
    }

    if (url.pathname === '/api/plans') {
      return cors(json({
        plans: Object.keys(PLANS).map((name) => ({
          plan: name, days: PLANS[name].days, price: PLANS[name].price, currency: 'RUB'
        }))
      }));
    }

    // --- выдача ключа; только со секретом администратора ---
    if (url.pathname === '/api/license/issue') {
      if (request.method !== 'POST') return cors(json({ error: 'нужен POST' }, 405));
      const secret = request.headers.get('X-Admin-Secret') || '';
      if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
        return cors(json({ error: 'нет доступа' }, 401));
      }

      const body = await readBody(request);
      const planName = PLANS[body.plan] ? body.plan : 'month';
      const plan = PLANS[planName];
      const days = Math.min(MAX_DAYS, Math.max(1, Number(body.days) || plan.days));
      const tier = body.tier === 'lite' ? 'lite' : 'pro';
      const exp = Math.floor(Date.now() / 1000) + days * 86400;

      const token = await signToken(env, { v: 1, tier, exp, sub: String(body.order || ''), plan: planName });
      const id = await keyId(token);

      if (env.LICENSES) {
        await env.LICENSES.put('key:' + id, JSON.stringify({
          exp, tier, plan: planName, price: plan.price, order: body.order || null,
          created: new Date().toISOString()
        }), { expirationTtl: days * 86400 + 86400 });
      }

      return cors(json({ key: token, exp, tier, id, days, plan: planName, price: plan.price }));
    }

    // --- проверка ключа на сервере (отзыв лицензии) ---
    if (url.pathname === '/api/license/check') {
      let token = '';
      if (request.method === 'GET') {
        token = url.searchParams.get('key') || '';
      } else {
        const body = await readBody(request);
        token = body.key || '';
      }
      if (!token) return cors(json({ valid: false, reason: 'нет ключа' }, 400));

      const parts = token.split('.');
      if (parts.length !== 3 || parts[0] !== PREFIX) {
        return cors(json({ valid: false, reason: 'неверный формат' }));
      }

      let payload;
      try {
        payload = JSON.parse(new TextDecoder().decode(
          b64ToBytes(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
        ));
      } catch (e) {
        return cors(json({ valid: false, reason: 'нечитаемый ключ' }));
      }

      const expired = typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now();
      const id = await keyId(token);

      let revoked = false;
      if (env.LICENSES) {
        revoked = !!(await env.LICENSES.get('revoked:' + id));
      }

      return cors(json({
        valid: !expired && !revoked,
        exp: payload.exp || null,
        tier: payload.tier || null,
        id,
        reason: expired ? 'срок истёк' : (revoked ? 'лицензия отозвана' : null)
      }));
    }

    // --- создание платежа в ЮKassa (вызывается с лендинга на GitHub Pages) ---
    if (url.pathname === '/api/pay') {
      if (request.method !== 'POST') return cors(json({ ok: false, error: 'нужен POST' }, 405));
      if (!yookassaReady(env)) {
        return cors(json({ ok: false, error: 'Онлайн-оплата пока не подключена — оплатите по СБП' }, 503));
      }

      const body = await readBody(request);
      const email = String(body.email || '').trim();
      if (!isEmail(email)) {
        return cors(json({ ok: false, error: 'Укажите e-mail — на него придёт ключ' }, 400));
      }

      const planName = PLANS[body.plan] ? body.plan : 'month';
      const plan = PLANS[planName];
      const ip = request.headers.get('CF-Connecting-IP') || '0';
      const limit = Number(env.PAY_RATE_LIMIT || 10);
      if (!(await rateLimit(env, 'pay-' + ip, limit))) {
        return cors(json({ ok: false, error: 'Слишком много попыток оплаты. Подождите час или напишите нам.' }, 429));
      }

      const description = 'Маркет-Снайпер — доступ на ' + plan.days + ' дн., тариф «' + planTitle(planName) + '»';
      const payload = {
        amount: { value: money(plan.price), currency: 'RUB' },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: env.RETURN_URL || 'https://sniper.gadget-nakhodki.ru/thanks.html'
        },
        description,
        metadata: { plan: planName, days: plan.days, email, source: 'site' }
      };

      if (env.SEND_RECEIPT !== '0') {
        payload.receipt = {
          customer: { email },
          items: [{
            description,
            quantity: '1.00',
            amount: { value: money(plan.price), currency: 'RUB' },
            vat_code: Number(env.RECEIPT_VAT_CODE || 1),
            payment_subject: 'service',
            payment_mode: 'full_payment'
          }]
        };
      }

      let res = await yookassaRequest(env, 'POST', '/payments', payload, crypto.randomUUID());
      if (res.status >= 400 && payload.receipt && isReceiptError(res.data)) {
        delete payload.receipt;
        res = await yookassaRequest(env, 'POST', '/payments', payload, crypto.randomUUID());
      }

      const id = res.data && res.data.id ? String(res.data.id) : '';
      const confirmation = res.data && res.data.confirmation
        ? String(res.data.confirmation.confirmation_url || '')
        : '';
      if (!id || !confirmation) {
        return cors(json({
          ok: false,
          error: 'Платёжный сервис не принял запрос. Попробуйте ещё раз или оплатите по СБП'
        }, 502));
      }

      await kvPut(env, 'payment:' + id, {
        status: 'pending',
        payment_id: id,
        plan: planName,
        days: plan.days,
        amount: plan.price,
        email,
        created: new Date().toISOString(),
        ip
      }, PAYMENT_TTL);

      return cors(json({
        ok: true,
        payment_id: id,
        confirmation_url: confirmation,
        plan: planName,
        days: plan.days,
        amount: plan.price
      }));
    }

    // --- уведомление ЮKassa: перепроверяем платёж через API и выдаём ключ ---
    if (url.pathname === '/api/webhook') {
      if (request.method !== 'POST') return text('need POST', 405);
      if (!yookassaReady(env)) return text('no api keys', 503);

      const body = await readBody(request);
      const event = String(body.event || '');
      const paymentId = String((body.object && body.object.id) || '');
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(paymentId)) return text('bad payment id', 400);

      const res = await yookassaRequest(env, 'GET', '/payments/' + encodeURIComponent(paymentId));
      // Такого платежа нет — 200, чтобы ЮKassa не повторяла запрос.
      if (res.status === 404) return text('OK', 200);
      // Сеть или 5xx — пусть повторит позже.
      if (res.status !== 200 || !res.data || !res.data.id) return text('verify failed', 502);

      const payment = res.data;
      const state = String(payment.status || '');

      if (event === 'payment.canceled' || state === 'canceled') {
        const saved = (await kvGet(env, 'payment:' + paymentId)) || { payment_id: paymentId };
        saved.status = 'canceled';
        saved.canceled_at = new Date().toISOString();
        await kvPut(env, 'payment:' + paymentId, saved, PAYMENT_TTL);
        return text('OK', 200);
      }

      if (state !== 'succeeded' || !payment.paid) return text('OK', 200);

      const meta = payment.metadata || {};
      const planName = PLANS[meta.plan] ? meta.plan : 'month';
      const plan = PLANS[planName];
      const amount = payment.amount || {};
      const paid = kopecks(amount.value);
      const expected = plan.price * 100;

      // Подменить metadata и заплатить 1 ₽ не получится: сумма сверяется в копейках.
      if (paid !== expected || amount.currency !== 'RUB') {
        await sendMail(env, env.MAIL_ADMIN || 'goinslims@gmail.com',
          'Маркет-Снайпер: сумма платежа не совпала',
          'Платёж ' + paymentId + ' прошёл, но сумма не совпала с тарифом.\n\n'
          + 'Тариф: ' + planTitle(planName) + ' (' + plan.price + ' ₽)\n'
          + 'Пришло: ' + String(amount.value || '?') + ' ' + String(amount.currency || '') + '\n\n'
          + 'Ключ автоматически не выдан. Проверьте платёж в кабинете ЮKassa.\n');
        return text('OK', 200);
      }

      let email = String(meta.email || '').trim();
      if (!email && payment.receipt && payment.receipt.customer) {
        email = String(payment.receipt.customer.email || '').trim();
      }
      if (email && !isEmail(email)) email = '';

      // Повторное уведомление: ключ уже есть — второй раз не выдаём.
      const existing = await kvGet(env, 'payment:' + paymentId);
      if (existing && existing.key) {
        if (!existing.mailSent) {
          existing.mailSent = await deliverKey(env, existing);
          await kvPut(env, 'payment:' + paymentId, existing, PAYMENT_TTL);
        }
        return text('OK', 200);
      }
      if (existing && existing.status === 'processing' && Number(existing.startedTs || 0) > Date.now() - 120000) {
        return text('OK', 200);
      }

      await kvPut(env, 'payment:' + paymentId, {
        status: 'processing',
        payment_id: paymentId,
        plan: planName,
        days: plan.days,
        amount: plan.price,
        email,
        startedTs: Date.now(),
        started: new Date().toISOString()
      }, PAYMENT_TTL);

      const exp = Math.floor(Date.now() / 1000) + plan.days * 86400;
      const token = await signToken(env, { v: 1, tier: 'pro', exp, sub: 'ЮK-' + paymentId, plan: planName });
      const keyHash = await keyId(token);

      const record = {
        status: 'paid',
        payment_id: paymentId,
        plan: planName,
        days: plan.days,
        amount: plan.price,
        email,
        key: token,
        key_id: keyHash,
        exp,
        paid_at: String(payment.created_at || new Date().toISOString()),
        mailSent: false
      };
      record.mailSent = await deliverKey(env, record);
      await kvPut(env, 'payment:' + paymentId, record, PAYMENT_TTL);

      return text('OK', 200);
    }

    // --- статус заказа и ключ для страницы «Спасибо» ---
    if (url.pathname === '/api/pay/status') {
      const id = url.searchParams.get('id') || '';
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
        return cors(json({ ok: false, error: 'нет номера платежа' }, 400));
      }
      const record = await kvGet(env, 'payment:' + id);
      if (!record) return cors(json({ ok: false, error: 'платёж не найден' }, 404));
      return cors(json({
        ok: true,
        status: record.status || null,
        plan: record.plan || null,
        days: record.days || null,
        exp: record.exp || null,
        key: record.status === 'paid' ? record.key : null,
        email: record.email || null
      }));
    }

    return cors(json({ error: 'not found' }, 404));
  }
};
