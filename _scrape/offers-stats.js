// offers-stats.js — прототип рыночных данных со страницы «Все предложения» Яндекс.Маркета.
//
// Зачем: расширение уже знает URL этой страницы (content.js → getOffers().url) и число
// предложений из data-zone-data. Здесь проверяем, что оттуда можно достать цены конкурентов
// и посчитать медиану/минимум/позицию — то, что продавец сам узнать не может.
//
// Запуск на сохранённой странице:
//   node _scrape\offers-stats.js
//   node _scrape\offers-stats.js _scrape\offers.html --price 46844 --commission 42
//
// Функции parseOfferPrices() и marketStats() написаны без зависимостей, чтобы их можно было
// перенести в content.js как есть (там доступен DOMParser).

const fs = require('fs');
const path = require('path');

// «46 844 ₽» -> 46844; «1 234,50 ₽» -> 1234.5
function parsePriceText(text) {
  const cleaned = String(text || '').replace(/[^\d.,]/g, '').replace(',', '.');
  const value = parseFloat(cleaned);
  return isFinite(value) && value > 0 ? value : null;
}

// Цены всех предложений на странице. Работает и с DOMParser, и с jsdom.
// Контейнер предложения ищем вверх по дереву: внутри него есть ссылка data-auto="snippet-link".
function parseOfferPrices(doc) {
  const nodes = doc.querySelectorAll('[data-auto="snippet-price-current"]');
  const offers = [];
  const seen = new Set();

  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const price = parsePriceText(el.textContent);
    if (!price) continue;

    let node = el;
    let depth = 0;
    while (node && depth < 14 && !(node.querySelector && node.querySelector('[data-auto="snippet-link"]'))) {
      node = node.parentElement;
      depth++;
    }

    const link = node ? node.querySelector('[data-auto="snippet-link"]') : null;
    const href = link ? String(link.getAttribute('href') || '') : '';
    const idMatch = href.match(/\/card\/[^/]+\/(\d+)/);
    const id = idMatch ? idMatch[1] : '';

    // Один товар может встретиться дважды (карусель, дубль блока) — считаем один раз.
    const key = id || 'p' + price;
    if (seen.has(key)) continue;
    seen.add(key);

    offers.push({ price, id, href });
  }

  return offers;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value);
}

function percentile(values, share) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * share)));
  return Math.round(sorted[index]);
}

// Сводка по рынку. currentPrice — цена товара, на карточке которого стоит пользователь.
function marketStats(prices, currentPrice) {
  const list = (prices || []).filter((p) => isFinite(p) && p > 0);
  if (!list.length) return null;

  const sorted = list.slice().sort((a, b) => a - b);
  const stats = {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: median(sorted),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    current: null,
    position: null,
    cheaperCount: null,
    percentBelowMedian: null,
    percentAboveMin: null
  };

  if (isFinite(currentPrice) && currentPrice > 0) {
    stats.current = currentPrice;
    stats.cheaperCount = sorted.filter((p) => p < currentPrice).length;
    stats.position = stats.cheaperCount + 1; // 1 = самый дешёвый
    stats.percentBelowMedian = stats.median
      ? Math.round(((stats.median - currentPrice) / stats.median) * 1000) / 10
      : null;
    stats.percentAboveMin = stats.min
      ? Math.round(((currentPrice - stats.min) / stats.min) * 1000) / 10
      : null;
  }

  return stats;
}

// ---------- CLI ----------

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fmt(value) {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(value));
}

function main() {
  const file = process.argv[2] && process.argv[2].indexOf('--') !== 0
    ? path.resolve(process.argv[2])
    : path.join(__dirname, 'offers.html');
  const price = Number(arg('price', 46844));
  const commission = Number(arg('commission', 42)) / 100;

  const html = fs.readFileSync(file, 'utf8');
  const { JSDOM } = require(path.join(__dirname, 'test', 'node_modules', 'jsdom'));
  const doc = new JSDOM(html).window.document;

  const offers = parseOfferPrices(doc);
  const stats = marketStats(offers.map((o) => o.price), price);

  console.log('Файл:', file);
  console.log('Предложений на странице:', offers.length);
  console.log('Цены:', offers.map((o) => fmt(o.price)).join(' · '));
  console.log('');
  console.log('Минимум:  ' + fmt(stats.min) + ' ₽');
  console.log('Медиана:  ' + fmt(stats.median) + ' ₽');
  console.log('Максимум: ' + fmt(stats.max) + ' ₽');
  console.log('25–75%:   ' + fmt(stats.p25) + ' — ' + fmt(stats.p75) + ' ₽');
  console.log('');
  console.log('Ваша цена: ' + fmt(price) + ' ₽ — позиция ' + stats.position + ' из ' + stats.count);
  console.log('Ниже медианы на ' + String(stats.percentBelowMedian).replace('.', ',') + '%');
  console.log('');

  // Сколько денег «на столе»: разница до медианы за вычетом комиссии Маркета.
  const gap = stats.median - price;
  const extra = Math.round(gap * (1 - commission));
  console.log('Если поднять цену до медианы (при той же скорости продаж):');
  console.log('  +' + fmt(gap) + ' ₽ к цене → +' + fmt(extra) + ' ₽ к прибыли с продажи');
}

if (require.main === module) {
  main();
}

module.exports = { parsePriceText, parseOfferPrices, median, percentile, marketStats };
