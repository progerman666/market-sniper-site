// test-issue.js — проверка офлайн-выпуска ключей: CLI tools/issue-key.js + верификатор расширения.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');

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

(async () => {
  const out = execFileSync('node', [path.join(root, 'tools', 'issue-key.js'), '--plan', 'month', '--order', 'TEST-OFFLINE'], {
    encoding: 'utf8'
  });
  const match = out.match(/MS1\.[A-Za-z0-9_\-.]+/);
  check('скрипт напечатал ключ', !!match, match ? match[0].slice(0, 24) + '…' : 'нет');

  const verified = await msVerifyLicenseKey(match[0]);
  check('расширение принимает офлайн-ключ', verified.ok === true, verified.error || verified.tier);

  const days = Math.round((verified.exp * 1000 - Date.now()) / 86400000);
  check('срок 30 дней', days === 30, days);

  const yearOut = execFileSync('node', [path.join(root, 'tools', 'issue-key.js'), '--plan', 'year', '--order', 'TEST-Y'], {
    encoding: 'utf8'
  });
  const yearKey = yearOut.match(/MS1\.[A-Za-z0-9_\-.]+/)[0];
  const yearVerified = await msVerifyLicenseKey(yearKey);
  const yearDays = Math.round((yearVerified.exp * 1000 - Date.now()) / 86400000);
  check('годовой ключ 365 дней', yearDays === 365, yearDays);

  const log = fs.readFileSync(path.join(root, 'server', 'issued.log'), 'utf8').trim().split('\n');
  check('лог выдачи пополняется', log.length >= 2, log.length + ' записей');

  console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
  process.exit(failed);
})();
