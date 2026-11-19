// issue-keys.js — пакетная выдача ключей (когда платёж подтверждён вручную).
// Печатает список и пишет CSV, чтобы просто копировать ключи покупателям.
//
// Пример: node tools\issue-keys.js --plan month --count 20 --out keys-month.csv

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const KEY_B64 = path.join(root, 'server', 'keys', 'dev-private.txt');
const LOG = path.join(root, 'server', 'issued.log');
const PLANS = { month: 30, year: 365 };

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

(async () => {
  const plan = String(arg('plan', 'month'));
  const count = Math.max(1, Math.min(500, Number(arg('count', 10)) || 10));
  const days = Number(arg('days', PLANS[plan] || 30));
  const out = String(arg('out', 'keys-' + plan + '.csv'));

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(fs.readFileSync(KEY_B64, 'utf8').trim(), 'base64'),
    format: 'der',
    type: 'pkcs8'
  });

  const rows = ['plan,days,exp,order,key,id'];

  for (let i = 1; i <= count; i++) {
    const order = String(arg('prefix', 'BATCH')) + '-' + String(i).padStart(3, '0');
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const payload = { v: 1, tier: 'pro', exp, sub: order, plan };
    const data = Buffer.from(JSON.stringify(payload));
    const signature = crypto.sign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    const key = 'MS1.' + b64url(data) + '.' + b64url(signature);
    const id = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);

    fs.appendFileSync(LOG, JSON.stringify({ id, plan, days, exp, order, created: new Date().toISOString() }) + '\n');
    rows.push([plan, days, exp, order, key, id].join(','));

    console.log(String(i).padStart(3, ' ') + '. ' + key);
  }

  const outPath = path.join(root, out);
  fs.writeFileSync(outPath, rows.join('\n') + '\n', 'utf8');
  console.log('');
  console.log('Готово: ' + count + ' ключей, тариф ' + plan + ' (' + days + ' дн.)');
  console.log('CSV: ' + outPath);
  console.log('Каждый ключ записан в server\\issued.log');
})();
