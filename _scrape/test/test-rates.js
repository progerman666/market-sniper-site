// test-rates.js — проверка обратной задачи цены и рыночных сводок (extension/rates.js).
// Числа взяты с реального товара: цена 46 844 ₽, закупка 25 000 ₽, ставка Маркета 42%, доставка 192 ₽.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
eval(fs.readFileSync(path.join(root, 'extension', 'rates.js'), 'utf8'));

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!ok) failed = 1;
}

const settings = { commission: 0.42, logistics: 192, ads: 0, cost: 25000 };

// Прибыль после закупки: 46 844 × 0,58 − 192 − 25 000 = 1 977,5
check('чистая прибыль после себестоимости', msNetProfit(46844, settings) === 1978, msNetProfit(46844, settings));
check('без себестоимости совпадает с прежним расчётом',
  msNetProfit(46844, { commission: 0.42, logistics: 192, ads: 0 }) === Math.round(46844 * 0.58 - 192),
  msNetProfit(46844, { commission: 0.42, logistics: 192, ads: 0 }));

// Точка безубыточности: (25 000 + 192) / 0,58 = 43 434,5
check('минимальная цена без убытка', msBreakEvenPrice(settings) === 43434, msBreakEvenPrice(settings));
check('на этой цене прибыль равна нулю', msNetProfit(msBreakEvenPrice(settings), settings) === 0,
  msNetProfit(msBreakEvenPrice(settings), settings));
check('ниже неё — убыток', msNetProfit(msBreakEvenPrice(settings) - 100, settings) < 0,
  msNetProfit(msBreakEvenPrice(settings) - 100, settings));

// Цена для маржи 20%: 25 192 / (1 − 0,42 − 0,20) = 66 294,7
check('цена для маржи 20%', msTargetMarginPrice(settings, 20) === 66295, msTargetMarginPrice(settings, 20));
const targetProfit = msNetProfit(msTargetMarginPrice(settings, 20), settings);
const targetMargin = Math.round((targetProfit / msTargetMarginPrice(settings, 20)) * 100);
check('на этой цене маржа ≈ 20%', targetMargin === 20, targetMargin + '%');

check('ставка 100% — цены не существует', msBreakEvenPrice({ commission: 1 }) === null);
check('ставка 90% + маржа 20% — невозможно', msTargetMarginPrice({ commission: 0.9 }, 20) === null);
check('нулевые расходы — цена 0', msBreakEvenPrice({ commission: 0.42 }) === 0, msBreakEvenPrice({ commission: 0.42 }));

// Рыночная сводка: те же 16 цен, что на странице предложений.
const prices = [46844, 75686, 78233, 77386, 75041, 80299, 94471, 79630, 73110, 87121, 80016, 75605, 87836, 66335, 51696, 82492];
const market = msMarketStats(prices, 46844);
check('рынок: число предложений', market.count === 16, market.count);
check('рынок: медиана', market.median === 77810, market.median);
check('рынок: минимум и максимум', market.min === 46844 && market.max === 94471, market.min + '/' + market.max);
check('рынок: квартили', market.p25 === 75041 && market.p75 === 80299, market.p25 + '/' + market.p75);
check('рынок: позиция 1 из 16', market.position === 1, market.position);
check('рынок: ниже медианы на 39,8%', market.percentBelowMedian === 39.8, market.percentBelowMedian);
check('рынок: пустой список — null', msMarketStats([], 100) === null);
check('рынок: мусор отбрасывается', msMarketStats(['нет', null, 0, -5, 100]).count === 1,
  JSON.stringify(msMarketStats(['нет', null, 0, -5, 100])));

// Справочник тарифов на месте.
check('тариф по категории', msCategoryCommission('Электроника') === 0.515, msCategoryCommission('Электроника'));

console.log(failed ? 'ITOG: FAIL' : 'ITOG: OK');
process.exit(failed);
