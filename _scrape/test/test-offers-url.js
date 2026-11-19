// Тест: карточка нового формата /card/<slug>/0?productId=<id> без блока «Ещё предложения».
// Проверяем, что content.js собирает адрес /offers/<slug>/<id> сам, тянет оттуда рынок
// и кладёт его в кэш по настоящему productId, а не по "0".
// Запуск: node test-offers-url.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const cardHtml = fs.readFileSync(path.join(__dirname, '..', 'https___market_yandex_ru_product_6307487765.html'), 'utf8');
const offersHtml = fs.readFileSync(path.join(__dirname, '..', 'offers.html'), 'utf8');
const rates = fs.readFileSync(path.join(ext, 'rates.js'), 'utf8');
const license = fs.readFileSync(path.join(ext, 'license.js'), 'utf8');
const content = fs.readFileSync(path.join(ext, 'content.js'), 'utf8');

let failures = 0;
function check(name, condition, extra) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!condition) failures++;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Поднимает content.js в отдельном jsdom: свой chrome.storage, свой fetch-мок.
function boot(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;

  let handler = null;
  const stored = {};
  const fetchUrls = [];

  win.chrome = {
    runtime: { onMessage: { addListener: (fn) => { handler = fn; } } },
    storage: {
      local: {
        get: (key, cb) => {
          const res = {};
          if (stored[key]) res[key] = stored[key];
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (payload, cb) => {
          Object.assign(stored, payload);
          if (cb) cb();
          return Promise.resolve();
        }
      }
    }
  };

  const { webcrypto } = require('crypto');
  try {
    Object.defineProperty(win, 'crypto', { value: webcrypto, configurable: true });
  } catch (e) { /* не критично для этого теста */ }

  // Вместо сети — сохранённая страница «Все предложения».
  win.fetch = (target) => {
    fetchUrls.push(String(target));
    return Promise.resolve({ ok: true, text: () => Promise.resolve(offersHtml) });
  };

  win.eval(rates + '\n' + license + '\n' + content);

  const ask = (type) => new Promise((resolve) => handler({ type }, {}, resolve));
  return { win, doc, stored, fetchUrls, ask };
}

(async () => {
  // --- 1. Новая карточка: в пути 0, настоящий id в query, блока «Ещё предложения» нет ---
  const card = boot(cardHtml, 'https://market.yandex.ru/card/smartfon-apple-iphone-15/0?productId=6307487765');
  card.doc.querySelectorAll('[data-zone-name="morePrices"]').forEach((el) => el.remove());
  card.doc.querySelectorAll('[data-auto="offersEntrypoint"]').forEach((el) => el.remove());
  await wait(250);

  const first = await card.ask('COLLECT');
  check('productId взят из query, а не "0"', first.debug.productId === '6307487765', first.debug.productId);
  check('ссылка на предложения собрана из пути',
    first.offersUrl === 'https://market.yandex.ru/offers/smartfon-apple-iphone-15/6307487765',
    first.offersUrl);
  check('источник ссылки — path', first.debug.offersSource === 'path', first.debug.offersSource);
  check('цена при этом найдена', typeof first.price === 'number' && first.price > 0, first.price);

  let data = first;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !(data.market && data.market.count >= 3)) {
    await wait(150);
    data = await card.ask('COLLECT');
  }

  check('рынок подтянулся по прямому адресу', !!data.market && data.market.count === 16,
    data.market && data.market.count);
  check('медиана из живой страницы предложений', !!data.market && data.market.median === 77810,
    data.market && data.market.median);
  check('позиция по цене', !!data.market && data.market.position === 1, data.market && data.market.position);
  check('запрос ушёл на собранный адрес',
    card.fetchUrls.length > 0 && card.fetchUrls[0] === 'https://market.yandex.ru/offers/smartfon-apple-iphone-15/6307487765',
    card.fetchUrls[0]);
  check('повторный COLLECT берёт кэш', card.fetchUrls.length === 1, card.fetchUrls.length + ' запрос(ов)');

  const cache = card.stored['ms-market-cache'] || {};
  check('кэш лежит под настоящим id', !!cache['6307487765'] && cache['6307487765'].prices.length === 16,
    cache['6307487765'] ? cache['6307487765'].prices.length + ' цен' : 'нет записи');
  check('мусорной записи "0" нет', !cache['0'], cache['0'] ? 'есть' : 'нет');

  // --- 2. Старый адрес /product--<slug>/<id>: ссылка тоже собирается ---
  const legacy = boot(
    '<html><body><div data-zone-name="price"><span data-auto="snippet-price-current">1 000 ₽</span></div></body></html>',
    'https://market.yandex.ru/product--test-tovar/1234567'
  );
  await wait(200);
  const legacyData = await legacy.ask('COLLECT');
  check('старый путь /product--slug/id', legacyData.offersUrl === 'https://market.yandex.ru/offers/test-tovar/1234567',
    legacyData.offersUrl);
  check('productId из старого пути', legacyData.debug.productId === '1234567', legacyData.debug.productId);

  console.log(failures ? 'ITOG: FAIL' : 'ITOG: OK');
  process.exit(failures ? 1 : 0);
})();
