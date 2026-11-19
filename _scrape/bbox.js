// bbox.js — находит границы золотых/зелёных элементов (символ без подписи).
const sharp = require('D:/projects/ozon-finds-worker/node_modules/sharp');

const SRC = process.argv[2] || 'C:/Users/dlypo/Downloads/MiniMax H3 Image-1.jpeg';
const LIMIT_Y = Number(process.argv[3] || 760); // ниже этой строки — плашка с текстом

(async () => {
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = 0, maxY = 0, count = 0;

  for (let y = 0; y < Math.min(LIMIT_Y, height); y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const gold = r > 150 && g > 105 && b < 120;
      const green = g > 110 && r < 110 && b < 120;
      if (gold || green) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  console.log(JSON.stringify({ width, height, colorPixels: count, minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }));
})();
