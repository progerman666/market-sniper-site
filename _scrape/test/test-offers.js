// test-offers.js — проверка рыночных данных со страницы «Все предложения» (прототип offers-stats.js).
// Фикстура _scrape/offers.html снята с живой страницы 14.11.2026 (16 предложений из 74).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const stats = require(path.join(root, '_scrape', 'offers-stats.js'));

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!ok) failed = 1;
}

const html = fs.readFileSync(path.join(root, '_scrape', 'offers.html'), 'utf8');
const doc = new JSDOM(html).window.document;

const offers = stats.parseOfferPrices(doc);
const prices = offers.map((o) => o.price);
const market = stats.marketStats(prices, 46844);

check('парсер нашёл предложения', offers.length >= 10, offers.length + ' шт.');
check('все цены в разумном диапазоне', prices.every((p) => p >= 1000 && p <= 10000000),
  'от ' + Math.min.apply(null, prices) + ' до ' + Math.max.apply(null, prices));
check('дубликатов нет', new Set(offers.map((o) => o.id)).size === offers.length,
  new Set(offers.map((o) => o.id)).size + ' уникальных id');

check('минимум', market.min === 46844, market.min);
check('медиана', market.median === 77810, market.median);
check('максимум', market.max === 94471, market.max);
check('квартили 25/75', market.p25 === 75041 && market.p75 === 80299, market.p25 + '/' + market.p75);
check('позиция текущей цены', market.position === 1, market.position + ' из ' + market.count);
check('отклонение от медианы', market.percentBelowMedian === 39.8, market.percentBelowMedian + '%');

// Деньги «на столе»: разница до медианы минус комиссия Маркета 42%.
const gap = market.median - 46844;
const extra = Math.round(gap * (1 - 0.42));
check('потенциал к цене', gap === 30966, gap);
check('потенциал к прибыли с продажи', extra === 17960, extra);

// Чистые функции — отдельно от фикстуры.
check('median на нечётном массиве', stats.median([3, 1, 2]) === 2, stats.median([3, 1, 2]));
check('median на чётном массиве', stats.median([1, 2, 3, 4]) === 3, stats.median([1, 2, 3, 4]));
check('пустой рынок даёт null', stats.marketStats([], 100) === null);
check('цена парсится с пробелами и знаком', stats.parsePriceText('46 844 ₽') === 46844, stats.parsePriceText('46 844 ₽'));
check('дробная цена парсится', stats.parsePriceText('1 234,50 ₽') === 1234.5, stats.parsePriceText('1 234,50 ₽'));

console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
process.exit(failed);
