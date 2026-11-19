// make-badge.js — рендер демо-бейджа «Чистая прибыль» для лендинга (site/img/badge.png).
//
// Почему переделан: прежний скриншот показывал комиссию Маркета 10% и маржу 89,8% —
// любой селлер знает, что тариф за размещение 32–53%, и такой скриншот читается как
// «калькулятор не знает, как работает Маркет». Здесь реальные числа:
//   цена 46 844 ₽, ставка 42%, доставка 192 ₽, закупка 25 000 ₽, медиана рынка 77 810 ₽.
//
// Запуск: node _scrape\make-badge.js
// Результат: _scrape\shot-badge-real.png (2× от 780×400), затем копируется в site\img\badge.png.

const fs = require('fs');
const path = require('path');
const sharp = require('D:/projects/ozon-finds-worker/node_modules/sharp');

const root = path.join(__dirname, '..');
const outFile = path.join(__dirname, 'shot-badge-real.png');

const W = 1560;
const H = 800;

const money = (value) => new Intl.NumberFormat('ru-RU').format(value);

// Числа считаются теми же функциями, что и в расширении, — картинка не расходится с продуктом.
eval(fs.readFileSync(path.join(root, 'extension', 'rates.js'), 'utf8'));

const PRICE = 46844;
const OLD_PRICE = 104677;
const SETTINGS = { commission: 0.42, logistics: 192, ads: 0, cost: 25000 };
const MARKET = msMarketStats(
  [46844, 75686, 78233, 77386, 75041, 80299, 94471, 79630, 73110, 87121, 80016, 75605, 87836, 66335, 51696, 82492],
  PRICE
);

const profit = msNetProfit(PRICE, SETTINGS);
const margin = Math.round((profit / PRICE) * 1000) / 10;
const breakEven = msBreakEvenPrice(SETTINGS);
const target20 = msTargetMarginPrice(SETTINGS, 20);
const commissionMoney = Math.round(PRICE * SETTINGS.commission);
const gapToMedian = MARKET.median - PRICE;
const extraProfit = Math.round(gapToMedian * (1 - SETTINGS.commission));
const belowMedian = Math.round(((MARKET.median - PRICE) / MARKET.median) * 100);

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1f3a"/>
      <stop offset="100%" stop-color="#14304f"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#ffffff"/>

  <!-- Строка цены карточки Маркета -->
  <text x="40" y="112" font-family="Segoe UI, Arial, sans-serif" font-size="74" font-weight="700" fill="#1a1a1a">${money(PRICE)} ₽</text>
  <rect x="330" y="58" width="96" height="40" rx="10" fill="#e8f5ec"/>
  <text x="378" y="88" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="600" fill="#0b7a3b">Пэй</text>
  <text x="452" y="104" font-family="Segoe UI, Arial, sans-serif" font-size="34" fill="#8a97a8" text-decoration="line-through">${money(OLD_PRICE)} ₽</text>
  <rect x="700" y="64" width="96" height="38" rx="9" fill="#fdecea"/>
  <text x="748" y="92" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="700" fill="#c0392b">−55%</text>

  <!-- Блок расширения -->
  <rect x="40" y="160" width="1480" height="600" rx="26" fill="url(#badge)"/>

  <text x="84" y="248" font-family="Segoe UI, Arial, sans-serif" font-size="52" font-weight="700" fill="#f5c451">Прибыль с продажи ≈ ${money(profit)} ₽</text>
  <text x="1476" y="244" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="600" fill="#ff8a80">маржа ${String(margin).replace('.', ',')}% — риск</text>

  <line x1="84" y1="286" x2="1476" y2="286" stroke="#2c517d" stroke-width="2"/>

  <text x="84" y="348" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#c9d6e8">Медиана рынка ${money(MARKET.median)} ₽ — вы дешевле на ${belowMedian}%</text>
  <text x="84" y="398" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="600" fill="#7ee2a8">При цене медианы: +${money(extraProfit)} ₽ к прибыли с продажи</text>

  <line x1="84" y1="446" x2="1476" y2="446" stroke="#2c517d" stroke-width="2"/>

  <text x="84" y="510" font-family="Segoe UI, Arial, sans-serif" font-size="27" fill="#9fb3cc">Без убытка — от ${money(breakEven)} ₽</text>
  <text x="84" y="556" font-family="Segoe UI, Arial, sans-serif" font-size="27" fill="#9fb3cc">Для маржи 20% — ${money(target20)} ₽</text>
  <text x="84" y="602" font-family="Segoe UI, Arial, sans-serif" font-size="27" fill="#9fb3cc">Вы 1-е из ${MARKET.count} предложений по цене</text>

  <text x="84" y="700" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#6f87a6">Маркет ${Math.round(SETTINGS.commission * 100)}% (${money(commissionMoney)} ₽) · доставка ${money(SETTINGS.logistics)} ₽ · закупка ${money(SETTINGS.cost)} ₽ · схема: свой склад, везёт Маркет</text>
</svg>`;

(async () => {
  await sharp(Buffer.from(svg)).png().toFile(outFile);
  console.log('Готово:', outFile);
  console.log('Прибыль: ' + profit + ' ₽ (маржа ' + margin + '%)');
  console.log('Без убытка: ' + breakEven + ' ₽, для маржи 20%: ' + target20 + ' ₽');
  console.log('Медиана рынка: ' + MARKET.median + ' ₽, потенциал: +' + extraProfit + ' ₽');
})();
