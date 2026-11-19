// make-popup-shot.js — актуальный скриншот попапа для лендинга и листингов магазинов.
//
// Почему отдельный скрипт: старый _scrape/test/shot-popup.js подставлял данные без
// себестоимости и без рыночной медианы, поэтому на скрине был старый набор строк.
// Здесь данные те же, что в демо-бейдже (ставка 42%, закупка 25 000 ₽, медиана рынка).
//
// Как работает: поднимает headless Edge с загруженной папкой extension\, находит id
// расширения по service worker'у, открывает chrome-extension://<id>/popup.html,
// подставляет данные через fillForm/renderTable и снимает PNG через CDP.
//
// Запуск:
//   node _scrape\make-popup-shot.js
//   node _scrape\make-popup-shot.js --out _scrape\shot-popup-expired.png --mode expired

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9688;

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT = path.resolve(root, arg('out', '_scrape/shot-popup.png'));
const MODE = arg('mode', 'trial');
const HEIGHT = Number(arg('height', 880));

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
  profit: 1978,
  margin: 4.2,
  cost: 25000,
  breakEven: 43434,
  targetPrice: 66295,
  market: {
    count: 16, min: 46844, max: 94471, median: 77810, p25: 75041, p75: 80299,
    current: 46844, position: 1, cheaperCount: 0, percentBelowMedian: 39.8
  },
  settings: { commission: 0.42, logistics: 192, ads: 0, cost: 25000, model: 'FBS', category: 'Все товары' }
};

const getJSON = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
  }).on('error', reject);
});

async function waitForTargets(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const list = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
      if (list && list.length) return list;
    } catch (e) { /* Edge ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Edge не открыл отладочный порт ' + PORT);
}

// id распакованного расширения Chromium считает так: SHA-256 от байтов пути (UTF-16LE на Windows),
// первые 16 байт, каждый полубайт -> буква a..p. Считаем сами: в headless service worker расширения
// ленивый и в списке целей CDP его нет, а брать первый chrome-extension:// нельзя — там встроенные.
function unpackedExtensionIds(dir) {
  const variants = [
    dir,                                  // как есть
    dir.replace(/\\/g, '/'),              // прямые слэши
    dir.charAt(0).toLowerCase() + dir.slice(1) // строчная буква диска
  ];
  const ids = [];
  variants.forEach((variant) => {
    [Buffer.from(variant, 'utf16le'), Buffer.from(variant, 'utf8')].forEach((bytes) => {
      const hash = crypto.createHash('sha256').update(bytes).digest();
      let id = '';
      for (let i = 0; i < 16; i++) {
        id += String.fromCharCode(97 + (hash[i] >> 4));
        id += String.fromCharCode(97 + (hash[i] & 0x0f));
      }
      if (ids.indexOf(id) === -1) ids.push(id);
    });
  });
  return ids;
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-popup-shot-'));
  const edge = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--load-extension=' + extDir,
    '--disable-extensions-except=' + extDir,
    'about:blank'
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    const targets = await waitForTargets(20000);
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('нет page-таргета');

    ws = new WebSocket(page.webSocketDebuggerUrl);
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
      const msgId = ++seq;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
    });

    await new Promise((resolve) => (ws.onopen = resolve));
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 380, height: HEIGHT, deviceScaleFactor: 2, mobile: false
    });

    // Ищем рабочий id: Chromium не отдаёт id в целях, пока service worker не проснулся.
    let id = null;
    for (const candidate of unpackedExtensionIds(extDir)) {
      const probe = await send('Page.navigate', { url: 'chrome-extension://' + candidate + '/popup.html' });
      if (probe && !probe.errorText) { id = candidate; break; }
    }
    if (!id) throw new Error('не удалось открыть popup.html: ни один id не подошёл');
    console.log('extension id:', id);

    if (MODE === 'expired') {
      await new Promise((r) => setTimeout(r, 1200));
      await send('Runtime.evaluate', {
        expression: "chrome.storage.local.set({'ms-license': {trialStart: Date.now() - 8*86400000, key: null}})",
        awaitPromise: true
      });
      await send('Page.reload', {});
    }

    await new Promise((r) => setTimeout(r, 2500));

    const access = MODE === 'expired'
      ? { mode: 'expired', daysLeft: 0, expiresAt: Date.now() - 86400000, keyError: null }
      : { mode: 'trial', daysLeft: 5, expiresAt: Date.now() + 5 * 86400000, keyError: null };

    const sample = Object.assign({}, SAMPLE, { access });
    await send('Runtime.evaluate', {
      expression: 'fillForm(' + JSON.stringify(SAMPLE.settings) + '); renderTable(' +
        JSON.stringify(sample) + '); "ok"',
      returnByValue: true
    });
    await new Promise((r) => setTimeout(r, 600));

    // --clip-height N — снять только верхние N CSS-пикселей попапа.
    // Без него снимок получается «простынёй» на всю высоту (2144 px при 2×), а странице нужен
    // скриншот нормальной формы: 384×512 CSS при deviceScaleFactor=2 даёт 768×1024.
    // clip.scale здесь 1: масштаб уже задан в Emulation.setDeviceMetricsOverride.
    const clipHeight = Number(arg('clip-height', 0));
    const shotParams = { format: 'png', captureBeyondViewport: true };
    if (clipHeight > 0) {
      shotParams.captureBeyondViewport = false;
      shotParams.clip = { x: 0, y: 0, width: 384, height: clipHeight, scale: 1 };
      // Обрезанный скриншот идёт на лендинг: полоса прокрутки в кадре выглядит как брак вёрстки.
      await send('Runtime.evaluate', {
        expression: 'document.documentElement.style.scrollbarWidth = "none";'
          + 'var s = document.createElement("style");'
          + 's.textContent = "::-webkit-scrollbar{display:none}";'
          + 'document.head.appendChild(s); "ok"'
      });
      await new Promise((r) => setTimeout(r, 300));
    }
    const shot = await send('Page.captureScreenshot', shotParams);
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('saved:', OUT, fs.statSync(OUT).size + ' B');
  } finally {
    if (ws) { try { ws.close(); } catch (e) { /* уже закрыт */ } }
    edge.kill();
  }
  process.exit(0);
})();
