// test-php-api.js — e2e проверка PHP-API на локальном сервере (php -S) + сверка ключа верификатором расширения.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const site = path.join(root, 'site');
const PORT = 8099;
const BASE = 'http://127.0.0.1:' + PORT;
const SECRET = 'test-secret';

// окружение для license.js (chrome mock + WebCrypto)
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

(async () => {
  const php = spawn('php', ['-S', '127.0.0.1:' + PORT, '-t', site], {
    env: Object.assign({}, process.env, { MS_ADMIN_SECRET: SECRET }),
    stdio: 'ignore'
  });

  try {
    await sleep(1800);

    const plansRes = await fetch(BASE + '/api/plans.php');
    const plans = await plansRes.json();
    check('plans.php отвечает', plansRes.status === 200 && Array.isArray(plans.plans) && plans.plans.length === 2,
      JSON.stringify(plans).slice(0, 80));
    check('цена месяца 199', plans.plans.some((p) => p.plan === 'month' && p.price === 199));

    const denied = await fetch(BASE + '/api/issue.php', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'month' })
    });
    check('без пароля — 401', denied.status === 401, denied.status);

    const issueRes = await fetch(BASE + '/api/issue.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ plan: 'month', order: 'TEST-1' })
    });
    const issued = await issueRes.json();
    check('ключ выдан', issueRes.status === 200 && typeof issued.key === 'string', (issued.key || '').slice(0, 26) + '…');
    check('срок 30 дней', issued.days === 30, issued.days);

    const verified = await msVerifyLicenseKey(issued.key);
    check('расширение приняло ключ PHP', verified.ok === true, verified.error || verified.tier);

    const yearRes = await fetch(BASE + '/api/issue.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ plan: 'year' })
    });
    const year = await yearRes.json();
    check('годовой тариф 365 дней / 1990 ₽', year.days === 365 && year.price === 1990, year.days + '/' + year.price);

    const checkRes = await fetch(BASE + '/api/check.php?key=' + encodeURIComponent(issued.key));
    const checkBody = await checkRes.json();
    check('check.php подтверждает ключ', checkBody.valid === true, JSON.stringify(checkBody).slice(0, 80));

    const badCheck = await (await fetch(BASE + '/api/check.php?key=MS1.abc.def')).json();
    check('мусорный ключ отклонён', badCheck.valid === false, badCheck.reason);

    const forgedPayload = Buffer.from(JSON.stringify({ v: 1, tier: 'pro', exp: Math.floor(Date.now() / 1000) + 99999 }));
    const parts = issued.key.split('.');
    const forged = 'MS1.' + forgedPayload.toString('base64url') + '.' + parts[2];
    const forgedCheck = await (await fetch(BASE + '/api/check.php?key=' + encodeURIComponent(forged))).json();
    check('подделка отклонена сервером', forgedCheck.valid === false, forgedCheck.reason);

    const log = fs.readFileSync(path.join(site, 'api', 'data', 'issued.log'), 'utf8').trim().split('\n');
    check('журнал выдачи пишется', log.length >= 2, log.length + ' записей');

    const directConfig = await fetch(BASE + '/api/config.php');
    const directBody = await directConfig.text();
    check('config.php не отдаёт секреты', directBody.indexOf(SECRET) === -1 && directConfig.status === 404,
      directConfig.status);

    console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
  } finally {
    php.kill();
  }
  process.exit(failed);
})();
