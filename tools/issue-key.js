// issue-key.js — выпуск лицензионного ключа офлайн, без сервера.
// Нужен только приватный ключ подписи; ключ подписывается локально (ECDSA P-256, WebCrypto).
//
// Примеры:
//   node tools\issue-key.js --plan month --order "СБП-0001"
//   node tools\issue-key.js --plan year --order "buyer@mail.ru" --days 365
//
// Лог выдачи пишется в server\issued.log (не публикуется).

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
  const order = String(arg('order', ''));
  const days = Number(arg('days', PLANS[plan] || 30));

  if (!fs.existsSync(KEY_B64)) {
    console.error('Нет файла с ключом подписи:', KEY_B64);
    process.exit(1);
  }

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(fs.readFileSync(KEY_B64, 'utf8').trim(), 'base64'),
    format: 'der',
    type: 'pkcs8'
  });

  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const payload = { v: 1, tier: 'pro', exp, sub: order, plan };
  const data = Buffer.from(JSON.stringify(payload));
  const signature = crypto.sign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' });

  const key = 'MS1.' + b64url(data) + '.' + b64url(signature);
  const record = {
    id: crypto.createHash('sha256').update(key).digest('hex').slice(0, 32),
    plan, days, exp, order, created: new Date().toISOString()
  };
  fs.appendFileSync(LOG, JSON.stringify(record) + '\n');

  const until = new Date(exp * 1000).toLocaleDateString('ru-RU');
  console.log('');
  console.log('Ключ доступа (отправьте покупателю):');
  console.log('');
  console.log(key);
  console.log('');
  console.log('Тариф: ' + plan + ' (' + days + ' дн.), действует до ' + until);
  console.log('id ключа: ' + record.id + '  (для отзыва — занесите в revoked.json)');
  console.log('');
})();
