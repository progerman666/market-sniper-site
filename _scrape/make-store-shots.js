// make-store-shots.js — скриншоты 1280×800 для Edge Add-ons из готовых снимков.
const sharp = require('D:/projects/ozon-finds-worker/node_modules/sharp');
const fs = require('fs');
const path = require('path');

const root = 'D:/projects/market-sniper';
const outDir = path.join(root, 'store', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const W = 1280;
const H = 800;

function caption(title, subtitle) {
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0b1f3a"/>
        <stop offset="100%" stop-color="#122b4a"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <circle cx="1100" cy="120" r="220" fill="#f5c451" opacity="0.07"/>
    <circle cx="160" cy="700" r="240" fill="#3b82f6" opacity="0.08"/>
    <text x="64" y="96" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="700" fill="#ffffff">${title}</text>
    <text x="64" y="140" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#9fb3cc">${subtitle}</text>
  </svg>`);
}

async function makeShot(srcFile, title, subtitle, outName, maxW, maxH, topOverride) {
  const img = await sharp(path.join(root, srcFile))
    .resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const meta = await sharp(img).metadata();

  const left = Math.round((W - meta.width) / 2);
  // topOverride нужен для высоких картинок: иначе они наезжают на подпись сверху.
  const top = (typeof topOverride === 'number')
    ? topOverride
    : Math.round((H - meta.height) / 2) + 40;

  // тень под скриншотом
  const shadow = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${left - 12}" y="${top - 12}" width="${meta.width + 24}" height="${meta.height + 24}"
          rx="18" fill="#000" opacity="0.35"/>
  </svg>`);

  await sharp(caption(title, subtitle))
    .composite([
      { input: shadow, top: 0, left: 0 },
      { input: img, top, left }
    ])
    .png()
    .toFile(path.join(outDir, outName));

  console.log(outName, meta.width + 'x' + meta.height);
}

(async () => {
  // для третьего кадра берём верх страницы (hero), иначе скриншот сжимается в узкую полоску
  const meta = await sharp(path.join(root, '_scrape/site-index.png')).metadata();
  await sharp(path.join(root, '_scrape/site-index.png'))
    .extract({ left: 0, top: 0, width: meta.width, height: Math.min(meta.height, 760) })
    .png()
    .toFile(path.join(root, '_scrape/site-hero.png'));

  // Источник первого кадра — демо-бейдж, отрендеренный теми же функциями, что и в расширении
  // (_scrape/make-badge.js). Раньше брался старый кроп с комиссией 10% и маржой 89,8%.
  await makeShot('_scrape/shot-badge-real.png',
    'Прибыль — прямо под ценой', 'Комиссия Маркета, доставка, реклама и закупка уже вычтены',
    'shot1-badge.png', 1080, 540);

  // Попап стал выше (себестоимость, безубыток, рынок) и в кадр 1280×800 целиком не влезает —
  // берём верхнюю часть с таблицей расчёта.
  const popupMeta = await sharp(path.join(root, '_scrape/shot-popup.png')).metadata();
  await sharp(path.join(root, '_scrape/shot-popup.png'))
    .extract({ left: 0, top: 0, width: popupMeta.width, height: Math.min(popupMeta.height, 975) })
    .png()
    .toFile(path.join(root, '_scrape/shot-popup-top.png'));

  await makeShot('_scrape/shot-popup-top.png',
    'Подробный расчёт в окне расширения', 'Свои ставки, себестоимость, цена без убытка и медиана рынка',
    'shot2-popup.png', 620, 620, 160);

  await makeShot('_scrape/site-hero.png',
    '7 дней полного доступа бесплатно', 'Без карты и регистрации — проверьте на своих товарах',
    'shot3-trial.png', 1080, 600);
})();
