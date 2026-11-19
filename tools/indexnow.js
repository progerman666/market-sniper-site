// indexnow.js — сообщает Яндексу и IndexNow, что страницы сайта обновились.
// Запуск: node tools\indexnow.js  (после деплоя сайта на GitHub Pages)
'use strict';

const fs = require('fs');
const path = require('path');

const HOST = 'sniper.gadget-nakhodki.ru';
const KEY = 'b7f3c9e2a41d58c6f0e9a2b7d4c1e8f3';
const KEY_URL = 'https://' + HOST + '/' + KEY + '.txt';

const siteDir = path.join(__dirname, '..', 'site');
const keyFile = path.join(siteDir, KEY + '.txt');

if (!fs.existsSync(keyFile) || fs.readFileSync(keyFile, 'utf8').trim() !== KEY) {
  console.error('Нет файла ключа ' + KEY + '.txt в site/ — IndexNow не сможет подтвердить домен.');
  process.exit(1);
}

const sitemap = fs.readFileSync(path.join(siteDir, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (!urls.length) {
  console.error('В sitemap.xml нет адресов.');
  process.exit(1);
}

const payload = { host: HOST, key: KEY, keyLocation: KEY_URL, urlList: urls };
const endpoints = ['https://yandex.com/indexnow', 'https://api.indexnow.org/indexnow'];

(async () => {
  console.log('Страниц к отправке: ' + urls.length + ', ключ: ' + KEY_URL);
  let failed = 0;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const ok = response.status >= 200 && response.status < 300;
      if (!ok) { failed++; }
      console.log((ok ? 'OK    ' : 'FAIL  ') + endpoint + ' -> ' + response.status);
    } catch (error) {
      failed++;
      console.log('FAIL  ' + endpoint + ' -> ' + (error && error.message ? error.message : error));
    }
  }
  process.exit(failed ? 1 : 0);
})();
