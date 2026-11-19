// check-live.js — быстрая проверка опубликованных страниц (после GitHub Pages).
// Перед запуском скачать страницы:
//   curl.exe -s --resolve sniper.gadget-nakhodki.ru:443:185.199.108.153 https://sniper.gadget-nakhodki.ru/ -o _scrape\live-index.html
//   curl.exe -s --resolve sniper.gadget-nakhodki.ru:443:185.199.108.153 https://sniper.gadget-nakhodki.ru/kalkulyator-pribyli.html -o _scrape\live-calc.html
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const files = [
  path.join(__dirname, '..', 'live-index.html'),
  path.join(__dirname, '..', 'live-calc.html')
];

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

  try {
    blocks.forEach((block) => JSON.parse(block[1]));
    console.log('OK    ' + name + ': JSON-LD блоков ' + blocks.length);
  } catch (error) {
    failed++;
    console.log('FAIL  ' + name + ': JSON-LD ' + error.message);
  }

  const checks = [
    ['Метрика', /js\/metrica\.js/],
    ['canonical', /rel="canonical"/],
    ['og:image', /property="og:image"/]
  ];

  for (const [label, pattern] of checks) {
    if (!pattern.test(html)) { failed++; console.log('FAIL  ' + name + ': нет ' + label); }
  }

  if (name === 'live-calc.html' && !/id="calc-form"/.test(html)) {
    failed++;
    console.log('FAIL  ' + name + ': нет формы калькулятора');
  }
}

console.log(failed ? '\nПровалено: ' + failed : '\nВсё на месте');
process.exit(failed ? 1 : 0);
