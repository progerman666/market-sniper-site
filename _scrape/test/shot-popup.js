// shot-popup.js — скриншот попапа расширения (без ручного клика) через CDP.
// Запуск: node shot-popup.js <порт> <id расширения> <путь к png>
const fs = require('fs');
const http = require('http');

const PORT = process.argv[2] || '9666';
const EXT_ID = process.argv[3];
const OUT = process.argv[4] || 'popup.png';

const getJSON = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => resolve(JSON.parse(data)));
  }).on('error', reject);
});

const SAMPLE = {
  status: 'ok',
  title: 'Смартфон Apple iPhone 15 256 ГБ, Dual: nano SIM + eSIM, Black',
  seller: 'chengzhongde',
  sellerUrl: 'https://market.yandex.ru/business--chengzhongde/216944481',
  price: 46844,
  oldPrice: 104677,
  discount: 55,
  offersCount: 74,
  offersUrl: 'https://market.yandex.ru/offers/smartfon-apple-iphone-15/6307487765',
  profit: 42060,
  margin: 89.8,
  settings: { commission: 0.1, logistics: 100, ads: 0, model: 'FBS', category: 'Все товары' }
};

(async () => {
  const list = await getJSON('http://127.0.0.1:' + PORT + '/json');
  const page = list.find((t) => t.type === 'page');
  if (!page) { console.log('нет page-таргета'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 380, height: Number(process.argv[6] || 760), deviceScaleFactor: 2, mobile: false
  });

  await send('Page.navigate', { url: 'chrome-extension://' + EXT_ID + '/popup.html' });
  await new Promise((r) => setTimeout(r, 2500));

  // режим: trial (по умолчанию) или expired (пробный период истёк)
  if (process.argv[5] === 'expired') {
    await send('Runtime.evaluate', {
      expression: "chrome.storage.local.set({'ms-license': {trialStart: Date.now() - 8*86400000, key: null}})",
      awaitPromise: true
    });
    await send('Page.reload', {});
    await new Promise((r) => setTimeout(r, 2500));
  }

  const accessInfo = process.argv[5] === 'expired'
    ? { mode: 'expired', daysLeft: 0, expiresAt: Date.now() - 86400000, keyError: null }
    : { mode: 'trial', daysLeft: 5, expiresAt: Date.now() + 5 * 86400000, keyError: null };

  const sample = Object.assign({}, SAMPLE, { access: accessInfo });

  await send('Runtime.evaluate', {
    expression: 'fillForm(' + JSON.stringify(SAMPLE.settings) + '); renderTable(' + JSON.stringify(sample) + '); "ok"',
    returnByValue: true
  });
  await new Promise((r) => setTimeout(r, 600));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('saved:', OUT, fs.statSync(OUT).size + ' B');
  ws.close();
  process.exit(0);
})();
