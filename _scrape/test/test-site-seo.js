// test-site-seo.js — проверка калькулятора прибыли и целей Метрики без браузера.
// Запуск: cd _scrape\test; node test-site-seo.js
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const siteDir = path.join(__dirname, '..', '..', 'site');
const html = fs.readFileSync(path.join(siteDir, 'kalkulyator-pribyli.html'), 'utf8');
const calcJs = fs.readFileSync(path.join(siteDir, 'js', 'calc.js'), 'utf8');
const metricaJs = fs.readFileSync(path.join(siteDir, 'js', 'metrica.js'), 'utf8');

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const normalize = (value) => String(value).replace(/\u00a0/g, ' ').trim();
  if (normalize(actual) === normalize(expected)) {
    passed++;
    console.log('  OK    ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + ': получено "' + actual + '", ожидалось "' + expected + '"');
  }
}

function fire(window, element, type) {
  element.dispatchEvent(new window.Event(type, { bubbles: true }));
}

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://sniper.gadget-nakhodki.ru/kalkulyator-pribyli.html' });
const { window } = dom;
const { document } = window;

// Стаб цели, чтобы проверить, что кнопка «Рассчитать» её отправляет.
window.eval(metricaJs.replace(/var MS_METRIKA_ID = \d+;/, 'var MS_METRIKA_ID = 12345678;'));

const realMsGoal = window.msGoal;
const goals = [];
window.msGoal = (goal) => { goals.push(goal); };

window.eval(calcJs);

const byId = (id) => document.getElementById(id);

check('цена по умолчанию', byId('calc-sum-price').textContent, '1 500 ₽');
check('комиссия 42%', byId('calc-sum-commission').textContent, '−630 ₽');
check('доставка и средняя миля', byId('calc-sum-delivery').textContent, '−167 ₽');
check('себестоимость', byId('calc-sum-cost').textContent, '−700 ₽');
check('чистая прибыль', byId('calc-profit').textContent, '3 ₽');
check('маржа', byId('calc-margin').textContent, 'Маржа: 0,2% от цены');

byId('calc-price').value = '3000';
fire(window, byId('calc-price'), 'input');
check('доставка пересчиталась', byId('calc-sum-delivery').textContent, '−242 ₽');
check('прибыль при цене 3000', byId('calc-profit').textContent, '798 ₽');

byId('calc-category').value = 'Спорт и отдых';
fire(window, byId('calc-category'), 'change');
check('комиссия по категории', byId('calc-commission').value, '53');
check('прибыль в категории 53%', byId('calc-profit').textContent, '468 ₽');

byId('calc-cost').value = '5000';
fire(window, byId('calc-cost'), 'input');
check('убыток подсвечен', byId('calc-profit').classList.contains('is-negative'), 'true');
check('маржа отрицательная', byId('calc-margin').textContent, 'Убыток: -127,7% от цены');

fire(window, byId('calc-run'), 'click');
check('цель calc отправлена', goals.join(','), 'calc');

// Автоматические цели Метрики по кликам — возвращаем настоящий msGoal.
window.msGoal = realMsGoal;
const ymCalls = [];
window.ym = function () { ymCalls.push(Array.prototype.slice.call(arguments)); };

const download = document.querySelector('a[href^="download/"]');
fire(window, download, 'click');
const buy = document.querySelector('a[href="buy.html"]');
if (buy) { fire(window, buy, 'click'); }

const reachGoals = ymCalls.filter((call) => call[1] === 'reachGoal').map((call) => call[2]);
check('цель download по клику', reachGoals.includes('download'), 'true');

const details = document.querySelector('details');
details.open = true;
fire(window, details, 'toggle');
const reachAfterFaq = ymCalls.filter((call) => call[1] === 'reachGoal').map((call) => call[2]);
check('цель faq_open при раскрытии', reachAfterFaq.includes('faq_open'), 'true');

console.log('\nИтого: пройдено ' + passed + ', провалено ' + failed);
process.exit(failed ? 1 : 0);
