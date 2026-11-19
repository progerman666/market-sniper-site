// check-site.js — проверка SEO-разметки и внутренних ссылок сайта.
// Запуск: node tools\check-site.js
'use strict';

const fs = require('fs');
const path = require('path');

const siteDir = path.join(__dirname, '..', 'site');
const htmlFiles = fs.readdirSync(siteDir).filter((name) => name.endsWith('.html')).sort();

let errors = 0;
let warnings = 0;

// Служебные страницы (404, «спасибо за оплату») не индексируются и в sitemap не входят.
const noindexPages = new Set();

const fail = (file, message) => { errors++; console.log('  FAIL  ' + file + ': ' + message); };
const warn = (file, message) => { warnings++; console.log('  WARN  ' + file + ': ' + message); };
const ok = (message) => console.log('  OK    ' + message);

function textLength(value) {
  return (value || '').trim().length;
}

function checkPage(file) {
  const html = fs.readFileSync(path.join(siteDir, file), 'utf8');
  const is404 = file === '404.html';
  const noindex = /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
  if (noindex) { noindexPages.add(file); }
  const isServicePage = is404 || noindex;

  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  if (!title) { fail(file, 'нет <title>'); }
  else {
    const length = textLength(title);
    if (length < 20 || length > 80) { warn(file, 'длина title ' + length + ' (норма 20–80)'); }
  }

  const description = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1];
  if (!description) { fail(file, 'нет meta description'); }
  else {
    const length = textLength(description);
    if (length < 70 || length > 200) { warn(file, 'длина description ' + length + ' (норма 70–200)'); }
  }

  if (!isServicePage) {
    if (!/<link\s+rel="canonical"\s+href="https:\/\/sniper\.gadget-nakhodki\.ru\//i.test(html)) {
      fail(file, 'нет абсолютного canonical');
    }
    if (!/property="og:image"\s+content="https:\/\//i.test(html)) {
      fail(file, 'og:image должен быть абсолютным URL');
    }
  }

  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1Count !== 1) { warn(file, 'H1 на странице: ' + h1Count); }

  if (!/js\/metrica\.js/i.test(html)) { fail(file, 'не подключена Метрика (js/metrica.js)'); }

  const jsonBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  if (!isServicePage && jsonBlocks.length === 0) { warn(file, 'нет JSON-LD'); }
  jsonBlocks.forEach((block, index) => {
    try { JSON.parse(block[1]); }
    catch (error) { fail(file, 'JSON-LD #' + (index + 1) + ' не парсится: ' + error.message); }
  });

  const openDivs = (html.match(/<div[\s>]/gi) || []).length;
  const closeDivs = (html.match(/<\/div>/gi) || []).length;
  if (openDivs !== closeDivs) { fail(file, '<div> ' + openDivs + ' vs </div> ' + closeDivs); }

  // Внутренние ссылки: файл должен существовать, якорь — быть на странице.
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((match) => match[1]);
  hrefs.forEach((href) => {
    if (/^(https?:|mailto:|tel:|#)/i.test(href)) { return; }
    const [rawPath, anchor] = href.split('#');
    const target = rawPath || file;
    const targetPath = path.join(siteDir, target.split('?')[0]);
    if (!fs.existsSync(targetPath)) { fail(file, 'битая ссылка: ' + href); return; }
    if (anchor && target.endsWith('.html')) {
      const targetHtml = fs.readFileSync(targetPath, 'utf8');
      if (!new RegExp('id="' + anchor + '"').test(targetHtml)) {
        fail(file, 'нет якоря #' + anchor + ' в ' + target);
      }
    }
  });

  ok(file);
}

console.log('Страницы сайта:');
htmlFiles.forEach(checkPage);

console.log('\nrobots.txt и sitemap.xml:');
const robots = fs.readFileSync(path.join(siteDir, 'robots.txt'), 'utf8');
if (!/Sitemap:\s*https:\/\/sniper\.gadget-nakhodki\.ru\/sitemap\.xml/i.test(robots)) {
  console.log('  FAIL  robots.txt: нет строки Sitemap');
  errors++;
} else {
  console.log('  OK    robots.txt указывает на sitemap.xml');
}

const sitemap = fs.readFileSync(path.join(siteDir, 'sitemap.xml'), 'utf8');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expected = new Set(htmlFiles.filter((name) => name !== '404.html' && !noindexPages.has(name)));
locations.forEach((url) => {
  const match = url.match(/^https:\/\/sniper\.gadget-nakhodki\.ru\/(.*)$/);
  if (!match) { console.log('  FAIL  sitemap: чужой домен ' + url); errors++; return; }
  const local = match[1] === '' ? 'index.html' : match[1];
  if (!fs.existsSync(path.join(siteDir, local))) {
    console.log('  FAIL  sitemap: нет файла ' + local); errors++;
  } else {
    expected.delete(local);
  }
});
expected.forEach((name) => {
  console.log('  FAIL  sitemap: не включена страница ' + name);
  errors++;
});

console.log('\nconfig/selectors.json:');
const configPath = path.join(siteDir, 'config', 'selectors.json');
if (!fs.existsSync(configPath)) {
  console.log('  FAIL  нет config/selectors.json');
  errors++;
} else {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const required = ['priceCurrent', 'priceOld', 'shopBlock', 'offersZone', 'offersLink'];
    const missing = required.filter((key) => !Array.isArray(config[key]) || !config[key].length);
    if (missing.length) { console.log('  FAIL  пустые ключи: ' + missing.join(', ')); errors++; }
    else { console.log('  OK    селекторы на месте'); }
  } catch (error) {
    console.log('  FAIL  JSON не парсится: ' + error.message);
    errors++;
  }
}

console.log('\nИтого: ошибок ' + errors + ', предупреждений ' + warnings);
process.exit(errors ? 1 : 0);
