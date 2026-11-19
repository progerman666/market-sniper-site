// popup.js — попап: сбор данных со страницы, таблица расчёта и настройки ставок.
// ВАЖНО: document.getElementById('collect') живёт только здесь (по правилам проекта).

var STORAGE_KEY = 'ms-settings';
var DEFAULTS = (typeof MS_DEFAULTS !== 'undefined') ? MS_DEFAULTS : {
  commission: 0.10, logistics: 100, ads: 0, model: 'FBS', category: 'Все товары'
};

var els = {
  collect: document.getElementById('collect'),
  table: document.getElementById('data'),
  out: document.getElementById('out'),
  model: document.getElementById('model'),
  schemeHint: document.getElementById('scheme-hint'),
  category: document.getElementById('category'),
  commission: document.getElementById('commission'),
  logistics: document.getElementById('logistics'),
  ads: document.getElementById('ads'),
  cost: document.getElementById('cost'),
  applyCategory: document.getElementById('apply-category'),
  reset: document.getElementById('reset'),
  hint: document.getElementById('hint'),
  status: document.getElementById('status'),
  licenseKey: document.getElementById('license-key'),
  activate: document.getElementById('activate'),
  licenseMsg: document.getElementById('license-msg'),
  plansHint: document.getElementById('plans-hint'),
  buy: document.getElementById('buy'),
  manualPrice: document.getElementById('manual-price'),
  manualCalc: document.getElementById('manual-calc')
};

var CONTROL_IDS = ['model', 'category', 'commission', 'logistics', 'ads', 'cost', 'apply-category', 'reset'];
var access = null;

var saveTimer = null;
var lastData = null;

function fmtMoney(value) {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value)) + ' ₽';
}

function fmtPercent(fraction) {
  if (fraction === null || fraction === undefined || !isFinite(fraction)) return '—';
  return String(Math.round(fraction * 1000) / 10).replace('.', ',') + '%';
}

// Комиссия в настройках хранится долей: 42% -> 0.42.
function readForm() {
  var commissionPercent = parseFloat(els.commission.value);
  return {
    commission: isFinite(commissionPercent) ? commissionPercent / 100 : DEFAULTS.commission,
    logistics: parseFloat(els.logistics.value) || 0,
    ads: parseFloat(els.ads.value) || 0,
    cost: parseFloat(els.cost.value) || 0,
    model: els.model.value,
    category: els.category.value
  };
}

function fillForm(settings) {
  var s = Object.assign({}, DEFAULTS, settings || {});
  els.model.value = s.model;
  if (els.category.querySelector('option[value="' + s.category + '"]')) {
    els.category.value = s.category;
  }
  els.commission.value = Math.round(s.commission * 1000) / 10;
  els.logistics.value = s.logistics;
  els.ads.value = s.ads;
  // Пустое поле честнее нуля: видно, что себестоимость не задана.
  els.cost.value = s.cost ? s.cost : '';
  renderModelHint();
  renderHint();
}

function renderHint() {
  var category = els.category.value;
  var rate = (typeof MS_PLACEMENT !== 'undefined') ? MS_PLACEMENT[category] : null;
  var parts = [];

  if (typeof rate === 'number') {
    parts.push('Официальный тариф Маркета для категории «' + category + '» — ' + fmtPercent(rate) +
      ' от цены. Кнопка «Тариф Маркета» подставит его в расчёт.');
  }

  if (typeof MS_TARIFFS !== 'undefined') {
    parts.push('Если товар лежит на складе Маркета или вы отгружаете заказы в Маркет, добавьте доставку: ' +
      fmtPercent(MS_TARIFFS.deliveryPercent) + ' от цены, но не больше ' + fmtMoney(MS_TARIFFS.deliveryMax) +
      ', плюс обработка от ' + fmtMoney(MS_TARIFFS.avgMileBase) + '.');
    parts.push('Товар дешевле ' + fmtMoney(MS_TARIFFS.cheapPriceMax) + ' и не больше ' +
      MS_TARIFFS.cheapVolumeMax + ' литров — для него единый тариф ' + fmtPercent(MS_TARIFFS.cheapRate) + '.');
  }

  els.hint.textContent = parts.join(' ');
}

function renderModelHint() {
  var full = (typeof msModelFull === 'function') ? msModelFull(els.model.value) : '';
  els.schemeHint.textContent = full ? 'Простыми словами: ' + full + '.' : '';
}

// ---------- доступ: пробный период и ключ ----------

function setControlsEnabled(enabled) {
  CONTROL_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

function accessText(info) {
  if (!info) return '—';
  if (info.mode === 'pro') return 'полная версия до ' + msFormatDate(info.expiresAt);
  if (info.mode === 'trial') {
    return 'пробный период, осталось ' + info.daysLeft + ' ' +
      msPlural(info.daysLeft, 'день', 'дня', 'дней');
  }
  return 'базовый расчёт (пробный период закончился)';
}

function renderStatus() {
  if (!access) return;

  if (access.mode === 'pro') {
    els.status.className = 'status status-pro';
    els.status.textContent = 'Полная версия активна до ' + msFormatDate(access.expiresAt) + '.';
  } else if (access.mode === 'trial') {
    els.status.className = 'status status-trial';
    els.status.textContent = 'Пробный период: ' + access.daysLeft + ' ' +
      msPlural(access.daysLeft, 'день', 'дня', 'дней') + ' полного доступа. Потом останется только базовый расчёт.';
  } else {
    els.status.className = 'status status-expired';
    els.status.textContent = 'Пробный период закончился. Считаем по базовым ставкам: Маркет 42% и доставка 100 ₽.';
  }

  if (access.purchaseUrl) els.buy.href = access.purchaseUrl;
  if (typeof msPriceLabel === 'function') {
    els.buy.textContent = 'Подключить полную версию — ' + msPriceLabel('month');
    els.plansHint.textContent = 'Или ' + msPriceLabel('year') + ' — два месяца в подарок.';
  }
  setControlsEnabled(access.mode !== 'expired');

  if (access.keyError) {
    els.licenseMsg.style.color = '#c0392b';
    els.licenseMsg.textContent = access.keyError;
  }
}

async function refreshAccess() {
  access = (typeof msGetAccess === 'function') ? await msGetAccess() : null;
  renderStatus();
  return access;
}

function loadModels() {
  var codes = (typeof MS_MODELS !== 'undefined') ? Object.keys(MS_MODELS) : [DEFAULTS.model];
  els.model.textContent = '';
  codes.forEach(function (code) {
    var option = document.createElement('option');
    option.value = code;
    option.textContent = (typeof msModelOption === 'function') ? msModelOption(code) : code;
    els.model.appendChild(option);
  });
}

function loadCategories() {
  var keys = (typeof MS_PLACEMENT !== 'undefined') ? Object.keys(MS_PLACEMENT) : [DEFAULTS.category];
  els.category.textContent = '';
  keys.forEach(function (name) {
    var option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    els.category.appendChild(option);
  });
}

function renderTable(data) {
  var s = data.settings;
  var commissionMoney = data.price ? data.price * s.commission : null;
  var scheme = (typeof msModelShort === 'function') ? msModelShort(s.model) : s.model;
  if (scheme) scheme = scheme.charAt(0).toUpperCase() + scheme.slice(1);

  // Почему рынка нет — короткой фразой, а не прочерком: иначе это читается
  // как «функция платная», хотя подписка рыночные данные не закрывает.
  var marketHint = (function () {
    if (data.offersUrl) return 'цены грузятся — откройте попап ещё раз';
    if (data.title === 'Ручной расчёт') return 'недоступно при ручном расчёте';
    return 'блок «Все предложения» не найден — обновите страницу (F5)';
  })();

  var rows = [
    ['Товар', data.title || '—'],
    ['Магазин', data.seller || 'не найден'],
    ['Цена сейчас', fmtMoney(data.price)],
    ['Цена без скидки', data.oldPrice ? fmtMoney(data.oldPrice) : '—'],
    ['Скидка', (data.discount === null || data.discount === undefined) ? '—' : data.discount + '%'],
    ['Маркет забирает', fmtPercent(s.commission) +
      (commissionMoney !== null ? ' — ' + fmtMoney(commissionMoney) : '')],
    ['Доставка', fmtMoney(s.logistics)],
    ['Реклама', fmtMoney(s.ads)],
    ['Себестоимость', s.cost ? fmtMoney(s.cost) : 'не задана'],
    ['Схема работы', scheme],
    ['Прибыль с продажи', fmtMoney(data.profit)],
    ['Остаётся от цены', (data.margin === null || data.margin === undefined)
      ? '—' : String(data.margin).replace('.', ',') + '%'],
    ['Без убытка', (data.breakEven === null || data.breakEven === undefined)
      ? '—' : 'от ' + fmtMoney(data.breakEven)],
    ['Для маржи 20%', (data.targetPrice === null || data.targetPrice === undefined)
      ? '—' : fmtMoney(data.targetPrice)],
    ['Медиана рынка', data.market
      ? fmtMoney(data.market.median) + ' · ' + data.market.count + ' предл.'
      : marketHint],
    ['Ваша цена на рынке', (data.market && data.market.position)
      ? data.market.position + '-я из ' + data.market.count
      : marketHint],
    ['Предложений у товара', data.offersCount ? String(data.offersCount)
      : (data.offersUrl ? 'не распознано' : marketHint)],
    ['Доступ', accessText(data.access)]
  ];

  els.table.textContent = '';
  rows.forEach(function (row) {
    var tr = document.createElement('tr');
    var th = document.createElement('td');
    th.textContent = row[0];
    var td = document.createElement('td');
    td.textContent = row[1];
    if (row[0] === 'Прибыль с продажи' && typeof data.profit === 'number') {
      td.className = data.profit >= 0 ? 'profit' : 'loss';
    }
    tr.appendChild(th);
    tr.appendChild(td);
    els.table.appendChild(tr);
  });

  if (data.offersUrl) {
    var tr = document.createElement('tr');
    var th = document.createElement('td');
    th.textContent = 'Все предложения';
    var td = document.createElement('td');
    var a = document.createElement('a');
    a.href = data.offersUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'открыть';
    td.appendChild(a);
    tr.appendChild(th);
    tr.appendChild(td);
    els.table.appendChild(tr);
  }
}

function describeDiagnostics(data) {
  var d = (data && data.debug) || {};
  var lines = [];
  lines.push('Цену не нашёл.');
  lines.push('Страница: ' + (d.page === 'product' ? 'карточка товара' : 'не карточка товара') +
    (d.path ? ' (' + d.path + ')' : ''));
  lines.push('Версия расширения: ' + (d.version || '—'));
  lines.push('Что делать: обновите страницу (F5) и проверьте, что открыт товар на market.yandex.ru.');
  lines.push('Если не помогло — введите цену вручную в поле выше.');
  return lines.join('\n');
}

function manualData(price) {
  var s = readForm();
  var profit = (typeof msNetProfit === 'function')
    ? msNetProfit(price, s)
    : Math.round(price * (1 - s.commission) - s.logistics - s.ads);
  return {
    status: 'ok',
    title: 'Ручной расчёт',
    seller: null,
    price: price,
    oldPrice: null,
    discount: null,
    offersCount: 0,
    offersUrl: null,
    profit: profit,
    margin: Math.round((profit / price) * 1000) / 10,
    cost: s.cost,
    breakEven: (typeof msBreakEvenPrice === 'function') ? msBreakEvenPrice(s) : null,
    targetPrice: (typeof msTargetMarginPrice === 'function') ? msTargetMarginPrice(s, 20) : null,
    market: null,
    access: access,
    settings: s,
    debug: { page: 'manual', priceSource: 'manual', sellerSource: null, offersSource: null, version: null }
  };
}

async function getActiveTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function saveSettings() {
  var payload = {};
  payload[STORAGE_KEY] = readForm();
  await chrome.storage.local.set(payload);

  try {
    var tab = await getActiveTab();
    if (tab && tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' });
  } catch (e) { /* вкладка не маркетплейс или content script не загружен */ }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 300);
}

// --- события ---

document.getElementById('collect').addEventListener('click', async function () {
  els.out.textContent = '';
  els.collect.disabled = true;
  try {
    var tab = await getActiveTab();
    if (!tab || !tab.id) {
      els.out.textContent = 'Нет активной вкладки';
      return;
    }

    var data = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT' });
    if (!data) {
      els.out.textContent = 'Страница не ответила. Обновите её.';
      return;
    }
    if (data.status === 'no-price') {
      els.out.textContent = describeDiagnostics(data);
      return;
    }
    lastData = data;
    renderTable(data);
    if (data.access) {
      access = data.access;
      renderStatus();
    }
  } catch (e) {
    els.out.textContent = 'Ошибка: ' + e.message + '\n(Откройте страницу market.yandex.ru и обновите её)';
  } finally {
    els.collect.disabled = false;
  }
});

[els.model, els.category, els.commission, els.logistics, els.ads, els.cost].forEach(function (el) {
  el.addEventListener('input', scheduleSave);
  el.addEventListener('change', scheduleSave);
});

els.category.addEventListener('change', renderHint);
els.model.addEventListener('change', renderModelHint);

els.applyCategory.addEventListener('click', function () {
  if (typeof MS_PLACEMENT === 'undefined') return;
  var rate = MS_PLACEMENT[els.category.value];
  if (typeof rate !== 'number') return;

  els.commission.value = Math.round(rate * 1000) / 10;
  if (lastData && lastData.price && typeof msEstimateLogistics === 'function') {
    els.logistics.value = msEstimateLogistics(lastData.price);
  }
  renderHint();
  saveSettings();
});

els.reset.addEventListener('click', function () {
  fillForm(DEFAULTS);
  saveSettings();
  els.out.textContent = '';
  els.table.textContent = '';
  lastData = null;
});

if (els.manualCalc) {
  els.manualCalc.addEventListener('click', function () {
    var price = parseFloat(String(els.manualPrice.value).replace(',', '.'));
    if (!isFinite(price) || price <= 0) {
      els.out.textContent = 'Введите цену товара числом, например 1500';
      return;
    }
    lastData = manualData(price);
    renderTable(lastData);
    els.out.textContent = 'Считаю по вашей цене. Ставки — из полей выше.';
  });
}

els.activate.addEventListener('click', async function () {
  var raw = els.licenseKey.value.trim();

  if (!raw) {
    els.licenseMsg.style.color = '#c0392b';
    els.licenseMsg.textContent = 'Вставьте ключ из письма после оплаты';
    return;
  }
  if (typeof msActivateKey !== 'function') {
    els.licenseMsg.style.color = '#c0392b';
    els.licenseMsg.textContent = 'Не удалось проверить ключ: модуль лицензии не загружен';
    return;
  }

  els.activate.disabled = true;
  try {
    var result = await msActivateKey(raw);
    if (result.ok) {
      els.licenseKey.value = '';
      els.licenseMsg.style.color = '#0b7a3b';
      els.licenseMsg.textContent = 'Ключ принят. Полная версия активна до ' + msFormatDate(result.exp * 1000) + '.';
      await refreshAccess();
      try {
        var tab = await getActiveTab();
        if (tab && tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' });
      } catch (e) { /* вкладка не Маркет */ }
    } else {
      els.licenseMsg.style.color = '#c0392b';
      els.licenseMsg.textContent = result.error || 'Ключ не подошёл';
    }
  } finally {
    els.activate.disabled = false;
  }
});

// --- инициализация ---

loadModels();
loadCategories();
chrome.storage.local.get(STORAGE_KEY).then(function (res) {
  fillForm((res && res[STORAGE_KEY]) || DEFAULTS);
  refreshAccess();
});