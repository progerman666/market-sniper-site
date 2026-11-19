// Тест content.js на сохранённой карточке товара (jsdom, без Chrome).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const htmlPath = path.join(__dirname, '..', 'https___market_yandex_ru_product_6307487765.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const dom = new JSDOM(html, {
  url: 'https://market.yandex.ru/product/6307487765',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});

const win = dom.window;
const doc = win.document;

let handler = null;
const stored = {};

win.chrome = {
  runtime: { onMessage: { addListener: (fn) => { handler = fn; } } },
  storage: {
    local: {
      get: (key, cb) => {
        const res = {};
        if (stored[key]) res[key] = stored[key];
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (payload, cb) => {
        Object.assign(stored, payload);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  }
};

// jsdom не реализует crypto.subtle — подкладываем Node WebCrypto (нужен для проверки ключа)
const { webcrypto } = require('crypto');
try {
  Object.defineProperty(win, 'crypto', { value: webcrypto, configurable: true });
} catch (e) {
  console.log('не удалось подменить crypto:', e.message);
}

const rates = fs.readFileSync(path.join(ext, 'rates.js'), 'utf8');
const license = fs.readFileSync(path.join(ext, 'license.js'), 'utf8');
const content = fs.readFileSync(path.join(ext, 'content.js'), 'utf8');
win.eval(rates + '\n' + license + '\n' + content);

function ask(type) {
  return new Promise((resolve) => {
    handler({ type }, {}, resolve);
  });
}

function check(name, condition, extra) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!condition) process.exitCode = 1;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Ждём асинхронный результат (рыночные данные подгружаются после рендера бейджа).
async function waitFor(fn, timeout) {
  const started = Date.now();
  while (Date.now() - started < (timeout || 15000)) {
    if (fn()) return true;
    await wait(100);
  }
  return false;
}

// Intl.NumberFormat('ru-RU') разделяет разряды неразрывным пробелом — приводим к обычному.
const norm = (value) => String(value || '').replace(/\u00A0/g, ' ');

// Бейдж теперь в Shadow DOM — читаем текст из .ms-root (без служебного <style>).
const badgeText = (badge) => {
  if (!badge) return '';
  if (badge.shadowRoot) {
    const root = badge.shadowRoot.querySelector('.ms-root');
    return root ? root.textContent : badge.shadowRoot.textContent;
  }
  return badge.textContent;
};

(async () => {
  await wait(150);

  // Независимый расчёт ожиданий прямо из DOM
  const priceEl = doc.querySelector('[data-zone-name="price"] [data-auto="snippet-price-current"]');
  const oldEl = doc.querySelector('[data-zone-name="price"] [data-auto="snippet-price-old"]');
  const priceText = priceEl ? priceEl.textContent : '';
  const expectedPrice = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', '.'));
  const expectedProfit = Math.round(expectedPrice * (1 - 0.42) - 100);

  const data = await ask('COLLECT');
  console.log('--- COLLECT ---');
  console.log(JSON.stringify(data, null, 2));

  check('цена найдена', data.price === expectedPrice, data.price + ' vs ' + expectedPrice);
  check('цена > 0', typeof data.price === 'number' && data.price > 0);
  check('магазин найден', data.seller === 'chengzhongde', data.seller);
  check('ссылка на магазин', !!data.sellerUrl && data.sellerUrl.indexOf('/business--') > -1, data.sellerUrl);
  check('старая цена больше новой', data.oldPrice > data.price, data.oldPrice);
  check('число предложений = 74', data.offersCount === 74, data.offersCount);
  check('прибыль по формуле', data.profit === expectedProfit, data.profit + ' vs ' + expectedProfit);
  check('маржа посчитана', typeof data.margin === 'number', data.margin);
  check('модель по умолчанию FBS', data.settings.model === 'FBS');

  const badge = doc.getElementById('ms-profit-badge');
  check('бейдж вставлен', !!badge);
  check('бейдж после блока цены', !!badge && badge.previousElementSibling === doc.querySelector('[data-zone-name="price"]'));
  check('в бейдже магазин', !!badge && badgeText(badge).indexOf('chengzhongde') > -1, badgeText(badge));
  check('подсказка про ставку при первом запуске',
    !!badge && badgeText(badge).indexOf('средняя по Маркету') > -1, badgeText(badge).slice(-140));

  // Ставка ниже официальной: бейдж обязан предупредить, что прибыль завышена.
  stored['ms-settings'] = { commission: 0.1, logistics: 100, ads: 0, model: 'FBS', category: 'Все товары' };
  await ask('SETTINGS_UPDATED');
  const badgeLow = doc.getElementById('ms-profit-badge');
  check('предупреждение о низкой ставке',
    !!badgeLow && badgeText(badgeLow).indexOf('ниже тарифа Маркета') > -1, badgeText(badgeLow).slice(-140));

  // Смена настроек: тариф «Электроника» 51,5% + логистика 192 ₽ + реклама 50 ₽
  stored['ms-settings'] = {
    commission: 0.515, logistics: 192, ads: 50, model: 'FBY', category: 'Электроника'
  };
  const updated = await ask('SETTINGS_UPDATED');
  const expectedUpdated = Math.round(expectedPrice * (1 - 0.515) - 192 - 50);

  check('пересчёт с новыми ставками', updated.profit === expectedUpdated, updated.profit + ' vs ' + expectedUpdated);
  const badge2 = doc.getElementById('ms-profit-badge');
  check('бейдж показывает комиссию 51,5%', !!badge2 && badgeText(badge2).indexOf('51,5%') > -1, badgeText(badge2));
  check('бейдж обновил сумму', !!badge2 && badgeText(badge2).indexOf('Прибыль с продажи') === 0, badgeText(badge2).slice(0, 40));
  check('в бейдже нет аббревиатуры FBS', !!badge2 && badgeText(badge2).indexOf('FBS') === -1);
  check('в бейдже схема по-русски', !!badge2 && badgeText(badge2).indexOf('схема: склад Маркета') > -1, badgeText(badge2).slice(-120));
  check('склонение «74 предложения»', !!badge2 && badgeText(badge2).indexOf('74 предложения') > -1, badgeText(badge2).slice(-40));

  // Второй вызов не должен плодить бейджи
  const count = doc.querySelectorAll('#ms-profit-badge').length;
  check('бейдж один', count === 1, count);

  // Страница может снести бейдж при перерисовке — он должен вернуться сам
  doc.getElementById('ms-profit-badge').remove();
  check('бейдж удалён вручную', !doc.getElementById('ms-profit-badge'));
  await wait(1800);
  check('бейдж восстановлен автоматически', !!doc.getElementById('ms-profit-badge'));

  // --- Рыночные данные: вместо сети подкладываем сохранённую страницу предложений ---
  const offersHtml = fs.readFileSync(path.join(__dirname, '..', 'offers.html'), 'utf8');
  let fetchCalls = 0;
  win.fetch = () => {
    fetchCalls++;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(offersHtml) });
  };

  // Бейдж уже отрисован — просим пересчёт, чтобы запустился фоновый запрос рынка.
  await ask('SETTINGS_UPDATED');

  const marketLoaded = await waitFor(() => {
    const badge = doc.getElementById('ms-profit-badge');
    return badge && badgeText(badge).indexOf('медиана рынка') > -1;
  });

  const badgeMarket = doc.getElementById('ms-profit-badge');
  const marketText = badgeMarket ? badgeText(badgeMarket) : '';

  check('рыночные данные подтянулись', marketLoaded, marketText.slice(-160));
  check('в бейдже медиана рынка', norm(marketText).indexOf('77 810') > -1, norm(marketText).slice(-120));
  check('в бейдже позиция по цене', marketText.indexOf('1-е из 16') > -1, marketText.slice(-120));
  check('в бейдже потенциал к прибыли', norm(marketText).indexOf('+15 019') > -1, norm(marketText).slice(-120));

  const marketData = await ask('COLLECT');
  check('COLLECT отдаёт сводку рынка', !!marketData.market && marketData.market.count === 16,
    marketData.market && marketData.market.count);
  check('COLLECT: медиана', !!marketData.market && marketData.market.median === 77810,
    marketData.market && marketData.market.median);
  check('COLLECT: позиция 1 из 16', !!marketData.market && marketData.market.position === 1,
    marketData.market && marketData.market.position);

  const cache = stored['ms-market-cache'] || {};
  check('рынок закэширован по productId', !!cache['6307487765'] && cache['6307487765'].prices.length === 16,
    cache['6307487765'] ? cache['6307487765'].prices.length + ' цен' : 'нет');

  // Второй запрос не должен снова ходить на страницу предложений.
  await ask('SETTINGS_UPDATED');
  await wait(400);
  check('повторный запрос берёт кэш', fetchCalls === 1, fetchCalls + ' запрос(ов)');

  // --- Себестоимость и красный флаг: маржа ниже 10% ---
  stored['ms-settings'] = {
    commission: 0.42, logistics: 100, ads: 0, cost: 24000, model: 'FBS', category: 'Все товары'
  };
  const withCost = await ask('SETTINGS_UPDATED');
  const badgeRisk = doc.getElementById('ms-profit-badge');
  const riskText = badgeRisk ? badgeText(badgeRisk) : '';

  check('себестоимость учтена в прибыли', withCost.profit === 3070, withCost.profit);
  check('маржа пересчитана', withCost.margin === 6.6, withCost.margin);
  check('красный флаг риска в бейдже', riskText.indexOf('риск') > -1, riskText.slice(-140));
  check('точка безубыточности в COLLECT', withCost.breakEven === 41552, withCost.breakEven);
  check('цена для маржи 20% в COLLECT', withCost.targetPrice === 63421, withCost.targetPrice);

  // Пробный период закончился: пользовательские ставки игнорируются, считаем по базовым
  stored['ms-license'] = { trialStart: Date.now() - 8 * 86400000, key: null };
  const limited = await ask('SETTINGS_UPDATED');
  const expectedLimited = Math.round(expectedPrice * (1 - 0.42) - 100);

  check('базовый режим: комиссия 42%', limited.settings.commission === 0.42, limited.settings.commission);
  check('базовый режим: доставка 100 ₽', limited.settings.logistics === 100, limited.settings.logistics);
  check('базовый режим: прибыль по базовым ставкам', limited.profit === expectedLimited,
    limited.profit + ' vs ' + expectedLimited);
  check('в попап отдан режим expired', limited.access.mode === 'expired', limited.access.mode);

  const badge3 = doc.getElementById('ms-profit-badge');
  check('в бейдже ссылка на полную версию', !!badge3 && !!badge3.shadowRoot && !!badge3.shadowRoot.querySelector('a') &&
    badgeText(badge3).indexOf('Пробный период закончился') > -1);
  check('в expired рынок показан, потенциал скрыт',
    !!badge3 && badgeText(badge3).indexOf('медиана рынка') > -1 && badgeText(badge3).indexOf('в полной версии') > -1,
    badge3 ? badgeText(badge3).slice(-150) : '');

  // Вёрстка сломалась: цену берём из JSON-LD карточки.
  doc.querySelectorAll('[data-zone-name="price"] [data-auto="snippet-price-current"]').forEach((el) => el.remove());
  const fallback = await ask('SETTINGS_UPDATED');
  check('цена из JSON-LD при сломанной вёрстке', fallback.debug.priceSource === 'json-ld', fallback.debug.priceSource);
  check('цена из JSON-LD > 0', typeof fallback.price === 'number' && fallback.price > 0, fallback.price);
  const expectedFallback = Math.round(fallback.price * (1 - 0.42) - 100);
  check('прибыль по цене из JSON-LD', fallback.profit === expectedFallback, fallback.profit + ' vs ' + expectedFallback);
  check('версия в диагностике', typeof fallback.debug.version === 'string' || fallback.debug.version === null, fallback.debug.version);

  console.log('--- BADGE ---');
  console.log(badgeText(badge2) || '(нет)');
  console.log(process.exitCode ? 'ITOG: FAIL' : 'ITOG: OK');
  process.exit(process.exitCode || 0);
})();
