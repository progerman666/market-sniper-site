// serve-fixture.js — отдаёт сохранённую карточку товара по адресу market.yandex.ru
// (для физического теста расширения в реальном браузере без запросов к Яндексу).
const fs = require('fs');
const http = require('http');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'https___market_yandex_ru_product_6307487765.html'));
const port = Number(process.argv[2] || 8080);

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, '127.0.0.1', () => {
  console.log('fixture server on http://127.0.0.1:' + port);
});
