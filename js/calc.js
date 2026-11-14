// calc.js — калькулятор прибыли на странице «Калькулятор прибыли».
// Ставки те же, что в extension/rates.js (MS_PLACEMENT, MS_TARIFFS) — правьте оба места сразу.
(function () {
  'use strict';

  var PLACEMENT = {
    'Все товары': 42,
    'Авто': 52,
    'Аптека': 52,
    'Бытовая техника': 51,
    'Дача, сад и огород': 52,
    'Детские товары': 52,
    'Досуг и развлечения': 52,
    'Книги': 43,
    'Компьютерная техника': 51.5,
    'Оборудование': 52,
    'Одежда, обувь и аксессуары': 52,
    'Продукты': 52,
    'Ритуальные товары': 50,
    'Спорт и отдых': 53,
    'Строительство и ремонт': 53,
    'Товары для дома': 52,
    'Товары для животных': 50,
    'Товары для красоты': 52,
    'Цветы, букеты, композиции': 32,
    'Электроника': 51.5
  };

  var TARIFFS = { deliveryPercent: 0.05, deliveryMax: 1000, avgMileBase: 92 };

  var form = document.getElementById('calc-form');
  if (!form) { return; }

  var priceEl = document.getElementById('calc-price');
  var categoryEl = document.getElementById('calc-category');
  var commissionEl = document.getElementById('calc-commission');
  var deliveryEl = document.getElementById('calc-delivery');
  var adsEl = document.getElementById('calc-ads');
  var costEl = document.getElementById('calc-cost');
  var runEl = document.getElementById('calc-run');

  var out = {
    profit: document.getElementById('calc-profit'),
    margin: document.getElementById('calc-margin'),
    price: document.getElementById('calc-sum-price'),
    commission: document.getElementById('calc-sum-commission'),
    delivery: document.getElementById('calc-sum-delivery'),
    ads: document.getElementById('calc-sum-ads'),
    cost: document.getElementById('calc-sum-cost')
  };

  var money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  var percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

  function num(el, fallback) {
    var value = parseFloat(String(el.value).replace(',', '.'));
    return isFinite(value) && value >= 0 ? value : fallback;
  }

  function estimateDelivery(price) {
    return Math.round(Math.min(price * TARIFFS.deliveryPercent, TARIFFS.deliveryMax) + TARIFFS.avgMileBase);
  }

  function applyCategory() {
    var rate = PLACEMENT[categoryEl.value];
    if (typeof rate === 'number') { commissionEl.value = String(rate); }
  }

  function applyDelivery() {
    deliveryEl.value = String(estimateDelivery(num(priceEl, 0)));
  }

  function calculate() {
    var price = num(priceEl, 0);
    var rate = num(commissionEl, 0);
    var delivery = num(deliveryEl, 0);
    var ads = num(adsEl, 0);
    var cost = num(costEl, 0);

    var commission = Math.round(price * rate / 100);
    var profit = Math.round(price - commission - delivery - ads - cost);
    var margin = price > 0 ? profit / price * 100 : 0;

    out.profit.textContent = money.format(profit) + ' ₽';
    out.profit.classList.toggle('is-negative', profit < 0);
    out.margin.textContent = (profit < 0 ? 'Убыток: ' : 'Маржа: ') + percent.format(margin) + '% от цены';
    out.price.textContent = money.format(price) + ' ₽';
    out.commission.textContent = '−' + money.format(commission) + ' ₽';
    out.delivery.textContent = '−' + money.format(delivery) + ' ₽';
    out.ads.textContent = '−' + money.format(ads) + ' ₽';
    out.cost.textContent = '−' + money.format(cost) + ' ₽';
  }

  categoryEl.addEventListener('change', function () { applyCategory(); calculate(); });
  priceEl.addEventListener('input', function () { applyDelivery(); calculate(); });

  [commissionEl, deliveryEl, adsEl, costEl].forEach(function (el) {
    el.addEventListener('input', calculate);
  });

  if (runEl) {
    runEl.addEventListener('click', function () { calculate(); });
  }

  applyCategory();
  applyDelivery();
  calculate();
})();