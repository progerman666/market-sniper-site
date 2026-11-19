// make-icons.js — режет готовую иконку 1024×1024 под размеры расширения.
// Запуск: node _scrape/make-icons.js "<путь к исходнику>"
const fs = require('fs');
const path = require('path');
const sharp = require('D:/projects/ozon-finds-worker/node_modules/sharp');

const SRC = process.argv[2] || 'C:/Users/dlypo/Downloads/MiniMax H3 Image-1.jpeg';
const ROOT = 'D:/projects/market-sniper';
const OUT = path.join(ROOT, 'extension', 'icons');

// Белый фон вокруг скруглённой карточки -> прозрачный.
async function transparentWhite(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 236 && data[i + 1] > 236 && data[i + 2] > 236) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const meta = await sharp(SRC).metadata();
  console.log('источник:', meta.width + 'x' + meta.height, meta.format);

  // 128 и 48 — вся иконка с подписью
  const full = await transparentWhite(SRC);
  await sharp(full).resize(128, 128, { kernel: 'lanczos3' }).png().toFile(path.join(OUT, 'icon128.png'));
  await sharp(full).resize(48, 48, { kernel: 'lanczos3' }).png().toFile(path.join(OUT, 'icon48.png'));

  // 16 — только символ: подпись начинается с y=804, символ заканчивается на y=763
  // (границы посчитаны по золотым/зелёным пикселям: x 56..870, y 58..763).
  const symbolBox = { left: 40, top: 0, width: 840, height: 770 };
  const symbol = await sharp(SRC).extract(symbolBox).toBuffer();
  const symbolPng = await transparentWhite(symbol);
  await sharp(symbolPng)
    .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png().toFile(path.join(OUT, 'icon16.png'));

  // Превью для визуальной проверки кадрирования
  await sharp(symbolPng)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(path.join(ROOT, '_scrape', 'preview-symbol.png'));
  await sharp(path.join(OUT, 'icon16.png')).resize(128, 128, { kernel: 'nearest' }).png()
    .toFile(path.join(ROOT, '_scrape', 'preview-16-zoom.png'));
  await sharp(full).resize(256, 256, { kernel: 'lanczos3' }).png()
    .toFile(path.join(ROOT, '_scrape', 'preview-full.png'));

  ['icon16.png', 'icon48.png', 'icon128.png'].forEach((name) => {
    const p = path.join(OUT, name);
    console.log(name, fs.statSync(p).size + ' B');
  });
})();
