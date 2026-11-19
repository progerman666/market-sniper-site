// Диагностика VK Ads API: поиск сообществ и схема ad_plans.
// Запуск: node _scrape\vk-probe.js
// Токен берётся из D:\apivk.txt (строка "access_token = ..."), в коде не хранится.
const fs = require('fs');

const CRED = 'D:\\apivk.txt';
const tok = fs.readFileSync(CRED, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.match(/^\s*access_token\s*[=:]\s*(.+)$/i))
  .filter(Boolean)
  .map((m) => m[1].trim())[0];

if (!tok) {
  console.error('В ' + CRED + ' нет строки access_token');
  process.exit(1);
}

const H = { Authorization: 'Bearer ' + tok };

async function get(url) {
  const r = await fetch(url, { headers: H });
  const text = await r.text();
  return { status: r.status, text };
}

(async () => {
  const variants = [
    'https://ads.vk.ru/api/v2/vk_groups.json?q=ozon&limit=3',
    'https://ads.vk.ru/api/v2/vk_groups.json?q=ozon&limit=3&offset=0',
    'https://ads.vk.ru/api/v2/vk_groups.json?q%5B%5D=ozon&limit=3',
    'https://ads.vk.ru/api/v2/vk_groups.json?q=ozon',
    'https://ads.vk.ru/api/v2/vk_groups.json?search=ozon&limit=3',
  ];

  for (const u of variants) {
    const { status, text } = await get(u);
    console.log('--- ' + u);
    console.log(status + ' ' + text.slice(0, 400).replace(/\s+/g, ' '));
    console.log('');
  }
})();
