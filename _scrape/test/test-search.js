// Проверка: на странице поиска (нет [data-zone-name="price"]) бейдж не рисуется.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const html = fs.readFileSync(path.join(__dirname, '..', 'search.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'https://market.yandex.ru/search?text=iphone%2015',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});

const win = dom.window;
const doc = win.document;
let handler = null;

win.chrome = {
  runtime: { onMessage: { addListener: (fn) => { handler = fn; } } },
  storage: { local: { get: (key, cb) => { if (cb) cb({}); return Promise.resolve({}); } } }
};

win.eval(fs.readFileSync(path.join(ext, 'rates.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(ext, 'license.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(ext, 'content.js'), 'utf8'));

function check(name, condition, extra) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!condition) process.exitCode = 1;
}

setTimeout(() => {
  const data = handler({ type: 'COLLECT' }, {}, () => {});
  let result = null;
  handler({ type: 'COLLECT' }, {}, (r) => { result = r; });

  check('на поиске цены нет (status no-price)', !!result && result.status === 'no-price', result && result.status);
  check('бейдж не вставлен', !doc.getElementById('ms-profit-badge'));
  check('чужие сниппеты не парсятся как товар', result && result.price === null, result && result.price);

  console.log(process.exitCode ? 'ITOG: FAIL' : 'ITOG: OK');
  process.exit(process.exitCode || 0);
}, 150);
