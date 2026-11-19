// test-license.js — проверка модуля лицензии и воркера выдачи ключей.
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const privateB64 = fs.readFileSync(path.join(root, 'server', 'keys', 'dev-private.txt'), 'utf8').trim();

// --- окружение ---
const store = {};
global.chrome = {
  storage: {
    local: {
      get(key, cb) {
        const res = {};
        if (store[key]) res[key] = store[key];
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set(payload, cb) {
        Object.assign(store, payload);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  }
};

// license.js написан как классический скрипт (var/function) — вычисляем в этом же скоупе
eval(fs.readFileSync(path.join(ext, 'license.js'), 'utf8'));

let failed = 0;
function check(name, condition, extra) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!condition) failed = 1;
}

function b64u(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signRaw(payload) {
  const key = await webcrypto.subtle.importKey(
    'pkcs8', Buffer.from(privateB64, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const data = Buffer.from(JSON.stringify(payload));
  const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data));
  return 'MS1.' + b64u(data) + '.' + b64u(sig);
}

(async () => {
  // 1. Воркер выдаёт ключ
  const worker = (await import('file:///' + path.join(root, 'server', 'src', 'index.js').replace(/\\/g, '/'))).default;
  const env = { PRIVATE_KEY_B64: privateB64, ADMIN_SECRET: 'test-secret' };

  const issueRes = await worker.fetch(new Request('https://api.test/api/license/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'test-secret' },
    body: JSON.stringify({ days: 30, tier: 'pro', order: 'TEST-1' })
  }), env);
  const issued = await issueRes.json();

  check('воркер выдал ключ', issueRes.status === 200 && !!issued.key, (issued.key || '').slice(0, 24) + '…');
  check('срок 30 дней', Math.abs(issued.days - 30) === 0, issued.days);
  check('CORS заголовок есть', issueRes.headers.get('Access-Control-Allow-Origin') === '*');

  // 2. Без секрета — отказ
  const denied = await worker.fetch(new Request('https://api.test/api/license/issue', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"days":30}'
  }), env);
  check('без X-Admin-Secret — 401', denied.status === 401, denied.status);

  // 3. Расширение проверяет ключ
  const verified = await msVerifyLicenseKey(issued.key);
  check('расширение приняло ключ', verified.ok === true, verified.error || verified.tier);
  check('срок из ключа ≈ 30 дней', Math.round((verified.exp * 1000 - Date.now()) / 86400000) === 30);

  // 4. Подделка
  const parts = issued.key.split('.');
  const payloadBuf = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const tampered = JSON.parse(payloadBuf.toString());
  tampered.exp += 86400 * 365;
  const forged = 'MS1.' + b64u(Buffer.from(JSON.stringify(tampered))) + '.' + parts[2];
  const forgedCheck = await msVerifyLicenseKey(forged);
  check('подделанный ключ отклонён', forgedCheck.ok === false, forgedCheck.error);

  // 5. Просроченный ключ
  const expiredToken = await signRaw({ v: 1, tier: 'pro', exp: Math.floor(Date.now() / 1000) - 86400 });
  const expiredCheck = await msVerifyLicenseKey(expiredToken);
  check('просроченный ключ отклонён', expiredCheck.ok === false && /закончился/.test(expiredCheck.error || ''), expiredCheck.error);

  // 6. Мусор вместо ключа
  const junkCheck = await msVerifyLicenseKey('MS1.abc.def');
  check('мусор отклонён', junkCheck.ok === false, junkCheck.error);

  // 7. Проверка на сервере
  const serverCheck = await worker.fetch(
    new Request('https://api.test/api/license/check?key=' + encodeURIComponent(issued.key)), env
  );
  const serverCheckBody = await serverCheck.json();
  check('сервер подтверждает ключ', serverCheckBody.valid === true, JSON.stringify(serverCheckBody).slice(0, 80));

  // 8. Режимы доступа
  delete store['ms-license'];
  let access = await msGetAccess();
  check('первый запуск — триал 7 дней', access.mode === 'trial' && access.daysLeft === 7, access.mode + '/' + access.daysLeft);

  store['ms-license'] = { trialStart: Date.now() - 2 * 86400000, key: null };
  access = await msGetAccess();
  check('через 2 дня триала — 5 дней', access.mode === 'trial' && access.daysLeft === 5, access.mode + '/' + access.daysLeft);

  store['ms-license'] = { trialStart: Date.now() - 8 * 86400000, key: null };
  access = await msGetAccess();
  check('через 8 дней — базовый режим', access.mode === 'expired', access.mode);

  const activated = await msActivateKey(issued.key);
  check('ключ активируется и сохраняется', activated.ok === true && !!store['ms-license'].key);
  access = await msGetAccess();
  check('с ключом — полная версия', access.mode === 'pro' && access.daysLeft === 30, access.mode + '/' + access.daysLeft);

  await msForgetKey();
  access = await msGetAccess();
  check('после удаления ключа снова не pro', access.mode !== 'pro', access.mode);

  console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
  process.exit(failed);
})();
