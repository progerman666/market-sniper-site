// content.js — парсер карточки Яндекс.Маркета, расчёт прибыли с продажи и бейдж на странице.
// Изолированный мир расширения: DOM общий, переменные страницы не видны (и наоборот).
(function () {
  'use strict';

  // Карта селекторов. data-auto / data-zone-name стабильнее классов ds-text_*.
  // Каждый ключ — массив: при смене вёрстки пробуем по порядку.
  // Значения можно переопределить файлом config/selectors.json на сайте (см. loadSelectorConfig).
  var DEFAULT_SELECTORS = {
    priceZone: ['[data-zone-name="price"]'],
    priceCurrent: ['[data-auto="snippet-price-current"]', '[data-auto="price-current"]', '[data-auto="price-value"]'],
    priceOld: ['[data-auto="snippet-price-old"]', '[data-auto="price-old"]'],
    title: ['[data-auto="productCardTitle"]', 'h1'],
    shopBlock: ['[data-auto="shop-info-block"]'],
    shopTitle: ['[data-auto="shop-info-title"]'],
    shopLink: ['[data-auto="shop-info-link"]'],
    offersZone: ['[data-zone-name="morePrices"]'],
    offersLink: ['[data-auto="offersEntrypoint"]']
  };

  var SELECTORS = {};
  Object.keys(DEFAULT_SELECTORS).forEach(function (key) {
    SELECTORS[key] = DEFAULT_SELECTORS[key].slice();
  });

  // Первый найденный элемент по списку селекторов (строка тоже допустима).
  function pick(selectors, root) {
    var scope = root || document;
    var list = Array.isArray(selectors) ? selectors : [selectors];
    for (var i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      try {
        var el = scope.querySelector(list[i]);
        if (el) return el;
      } catch (e) { /* битый селектор из конфига — пропускаем */ }
    }
    return null;
  }

  function applySelectorConfig(config) {
    if (!config || typeof config !== 'object') return;
    Object.keys(DEFAULT_SELECTORS).forEach(function (key) {
      var value = config[key];
      if (!value) return;
      var list = Array.isArray(value) ? value : [value];
      list = list.filter(function (item) { return typeof item === 'string' && item.trim(); });
      if (list.length) SELECTORS[key] = list;
    });
  }

  var BADGE_ID = 'ms-profit-badge';
  var STORAGE_KEY = 'ms-settings';
  var DEFAULTS = (typeof MS_DEFAULTS !== 'undefined') ? MS_DEFAULTS : {
    commission: 0.10, logistics: 100, ads: 0, model: 'FBS', category: 'Все товары'
  };

  var settings = Object.assign({}, DEFAULTS);
  var access = { mode: 'trial', daysLeft: 0, expiresAt: null, purchaseUrl: '' };
  var lastSignature = '';
  var refreshTimer = null;

  // В урезанном режиме (пробный период закончился) считаем только по базовым ставкам.
  function currentSettings() {
    if (access.mode === 'expired') return Object.assign({}, DEFAULTS);
    return settings;
  }

  // ---------- Парсинг ----------

  // "2 892 ₽" / "104 677" / "1 234,50 ₽" -> число
  function parsePrice(text) {
    if (!text) return null;
    var cleaned = String(text).replace(/[^\d.,]/g, '').replace(',', '.');
    var value = parseFloat(cleaned);
    return isFinite(value) && value > 0 ? value : null;
  }

  function normText(text) {
    return text ? String(text).replace(/\s+/g, ' ').trim() : '';
  }

  function isProductPage() {
    // Карточка Маркета живёт на двух путях: /product--<slug>/<id> и /card/<slug>/<id> (canonical).
    var p = location.pathname;
    return p.indexOf('/product') === 0 || p.indexOf('/card/') === 0;
  }

  // ---------- Резервные источники данных ----------

  var lastPriceSource = null;
  var lastSellerSource = null;
  var lastOffersSource = null;
  var jsonLdCache = null;
  var jsonLdLoaded = false;

  function findProductNode(node, depth) {
    if (!node || depth > 4) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var found = findProductNode(node[i], depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof node !== 'object') return null;

    var types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.indexOf('Product') > -1) return node;
    if (node['@graph']) return findProductNode(node['@graph'], depth + 1);
    return null;
  }

  // JSON-LD карточки: name/offers/seller — переживает смену классов и data-auto.
  function getJsonLdProduct() {
    if (jsonLdLoaded) return jsonLdCache;
    jsonLdLoaded = true;
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var product = findProductNode(JSON.parse(scripts[i].textContent), 0);
        if (product) { jsonLdCache = product; return jsonLdCache; }
      } catch (e) { /* не наш JSON — пропускаем */ }
    }
    jsonLdCache = null;
    return null;
  }

  function jsonLdOffers(product) {
    var offers = product && product.offers;
    if (!offers) return [];
    return Array.isArray(offers) ? offers : [offers];
  }

  function getMetaPrice() {
    var meta = pick(['meta[property="product:price:amount"]', 'meta[itemprop="price"]', 'meta[property="og:price:amount"]']);
    if (!meta) return null;
    var value = parseFloat(String(meta.getAttribute('content') || '').replace(',', '.'));
    return isFinite(value) && value > 0 ? value : null;
  }

  function getJSONPrice() {
    var offers = jsonLdOffers(getJsonLdProduct());
    for (var i = 0; i < offers.length; i++) {
      var value = parseFloat(String(offers[i].price || offers[i].lowPrice || '').replace(/\s/g, '').replace(',', '.'));
      if (isFinite(value) && value > 0) return value;
    }
    return null;
  }

  function getPriceEl() {
    // data-zone-name="price" есть и в сниппетах поиска — парсим только карточку товара.
    if (!isProductPage()) return null;
    var zone = pick(SELECTORS.priceZone);
    var el = zone ? pick(SELECTORS.priceCurrent, zone) : null;
    if (!el) el = pick(SELECTORS.priceCurrent);
    return el;
  }

  function getPrice() {
    lastPriceSource = null;
    var el = getPriceEl();
    var fromDom = el ? parsePrice(el.textContent) : null;
    if (fromDom) { lastPriceSource = 'dom'; return fromDom; }

    var fromMeta = getMetaPrice();
    if (fromMeta) { lastPriceSource = 'meta'; return fromMeta; }

    var fromJson = getJSONPrice();
    if (fromJson) { lastPriceSource = 'json-ld'; return fromJson; }

    return null;
  }

  function getOldPrice() {
    if (!isProductPage()) return null;
    var zone = pick(SELECTORS.priceZone);
    var el = zone ? pick(SELECTORS.priceOld, zone) : null;
    if (!el) el = pick(SELECTORS.priceOld);
    return el ? parsePrice(el.textContent) : null;
  }

  function getSeller() {
    lastSellerSource = null;
    if (!isProductPage()) return { name: null, url: null };

    var block = pick(SELECTORS.shopBlock);
    var titleEl = block ? pick(SELECTORS.shopTitle, block) : null;
    var linkEl = block ? pick(SELECTORS.shopLink, block) : null;
    if (titleEl || linkEl) {
      lastSellerSource = 'dom';
      return {
        name: titleEl ? normText(titleEl.textContent) : null,
        url: linkEl && linkEl.href ? linkEl.href : null
      };
    }

    // Запасной путь: любая ссылка на витрину магазина.
    var businessLink = pick(['a[href*="/business--"]']);
    if (businessLink) {
      lastSellerSource = 'link';
      return { name: normText(businessLink.textContent) || null, url: businessLink.href };
    }

    var offers = jsonLdOffers(getJsonLdProduct());
    for (var i = 0; i < offers.length; i++) {
      var seller = offers[i].seller;
      var name = seller && (typeof seller === 'string' ? seller : seller.name);
      if (name) {
        lastSellerSource = 'json-ld';
        return { name: normText(name), url: null };
      }
    }

    return { name: null, url: null };
  }

  // Блок "Ещё предложения": data-zone-data = {"numOffers":74,"url":"/offers/..."}
  function getOffers() {
    lastOffersSource = null;
    var zone = pick(SELECTORS.offersZone);
    if (zone) {
      try {
        var raw = zone.getAttribute('data-zone-data');
        if (raw) {
          var data = JSON.parse(raw);
          lastOffersSource = 'zone-data';
          return {
            count: typeof data.numOffers === 'number' ? data.numOffers : null,
            url: data.url ? new URL(data.url, location.origin).href : offersUrlFromPath()
          };
        }
      } catch (e) { /* битый JSON — не критично */ }
    }

    var link = pick(SELECTORS.offersLink);
    if (link) {
      lastOffersSource = 'link';
      // «Ещё 74 предложения» — число берём из ближайшего текста ссылки.
      var text = normText((link.parentNode && link.parentNode.textContent) || link.textContent || '');
      var match = text.match(/(\d[\d\s]*)\s+предложени/i);
      return {
        count: match ? Number(match[1].replace(/\s/g, '')) : null,
        url: link.href || offersUrlFromPath()
      };
    }

    var offers = jsonLdOffers(getJsonLdProduct());
    if (offers.length > 1) {
      lastOffersSource = 'json-ld';
      return { count: offers.length, url: offersUrlFromPath() };
    }

    // Блока на карточке нет (новый макет или единственное предложение), но страница
    // «Все предложения» доступна по прямому адресу — собираем ссылку сами.
    var fallback = offersUrlFromPath();
    if (fallback) {
      lastOffersSource = 'path';
      return { count: null, url: fallback };
    }

    return { count: null, url: null };
  }

  // ---------- Рыночные данные: цены со страницы «Все предложения» ----------
  // Продавец видит только свою карточку и не знает, сколько стоит рынок.
  // Запрос идёт на тот же домен (host_permissions уже покрывает market.yandex.ru),
  // результат кэшируется в chrome.storage.local по productId на 6 часов.

  var MARKET_KEY = 'ms-market-cache';
  var MARKET_TTL = 6 * 60 * 60 * 1000;      // сутки не нужны: цены живут быстрее
  var MARKET_RETRY = 10 * 60 * 1000;        // после неудачи не долбим страницу 10 минут
  var MARKET_LIMIT = 30;                    // сколько товаров держим в кэше

  var marketCache = {};
  var marketPending = {};
  var marketFail = {};

  // Подсказку про ставку показываем один раз: иначе она мозолит глаза тем, кто уже всё настроил.
  var HINTS_KEY = 'ms-hints';
  var hints = {};

  function loadHints() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
          resolve();
          return;
        }
        chrome.storage.local.get(HINTS_KEY, function (res) {
          hints = (res && res[HINTS_KEY]) || {};
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  function markHint(name) {
    if (hints[name]) return;
    hints[name] = true;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var payload = {};
        payload[HINTS_KEY] = hints;
        chrome.storage.local.set(payload);
      }
    } catch (e) { /* подсказка — не критично */ }
  }

  // Карточка живёт на трёх видах адреса: /product--<slug>/<id>, /card/<slug>/<id>
  // и новый /card/<slug>/0?productId=<id> (проверено 15.11.2026: Яндекс редиректит
  // на путь с нулём, а настоящий id уходит в query — раньше кэш рынка складывался под "0").
  function productId() {
    var fromQuery = null;
    try {
      fromQuery = new URLSearchParams(location.search).get('productId');
    } catch (e) { /* очень старый браузер — читаем только путь */ }
    if (fromQuery && /^\d+$/.test(fromQuery) && fromQuery !== '0') return fromQuery;

    var m = String(location.pathname).match(/\/(?:product--[^/]*|card\/[^/]*|product)\/(\d+)/);
    if (m && m[1] !== '0') return m[1];

    // Последний шанс: длинный числовой id где-то в пути.
    var digits = String(location.pathname).match(/\/(\d{4,})(?:\/|$)/);
    return digits ? digits[1] : null;
  }

  // Прямой адрес страницы «Все предложения»: /offers/<slug>/<id>.
  // Нужен, когда на карточке нет блока «Ещё предложения»: Яндекс отдаёт такую
  // страницу с теми же data-auto="snippet-price-current" (проверено 15.11.2026 —
  // 16 цен, медиана 76 523 ₽ на живом товаре).
  function offersUrlFromPath() {
    var id = productId();
    if (!id) return null;
    var m = String(location.pathname).match(/\/(?:product--([^/]+)|card\/([^/]+)|product\/([^/]+))\/\d+/);
    var slug = m ? (m[1] || m[2] || m[3] || '') : '';
    if (!slug) return null;
    return location.origin + '/offers/' + slug + '/' + id;
  }

  // Цены всех предложений на странице. Контейнер предложения ищем вверх по дереву:
  // внутри него есть ссылка data-auto="snippet-link" (проверено на живой странице 14.11.2026).
  function parseOfferPrices(doc) {
    var nodes = doc.querySelectorAll('[data-auto="snippet-price-current"]');
    var prices = [];
    var seen = {};

    for (var i = 0; i < nodes.length; i++) {
      var price = parsePrice(nodes[i].textContent);
      if (!price) continue;

      var node = nodes[i];
      var depth = 0;
      while (node && depth < 14 && !(node.querySelector && node.querySelector('[data-auto="snippet-link"]'))) {
        node = node.parentElement;
        depth++;
      }

      var link = node ? node.querySelector('[data-auto="snippet-link"]') : null;
      var href = link ? String(link.getAttribute('href') || '') : '';
      var idMatch = href.match(/\/card\/[^/]+\/(\d+)/);
      var id = idMatch ? idMatch[1] : 'p' + price;

      // Один товар может встретиться дважды (дубль блока) — считаем один раз.
      if (seen[id]) continue;
      seen[id] = true;
      prices.push(price);
    }

    return prices;
  }

  function loadMarketCache() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
          resolve();
          return;
        }
        chrome.storage.local.get(MARKET_KEY, function (res) {
          marketCache = (res && res[MARKET_KEY]) || {};
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  function saveMarketCache() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      var ids = Object.keys(marketCache);
      if (ids.length > MARKET_LIMIT) {
        ids.sort(function (a, b) { return (marketCache[a].ts || 0) - (marketCache[b].ts || 0); });
        while (ids.length > MARKET_LIMIT) delete marketCache[ids.shift()];
      }
      var payload = {};
      payload[MARKET_KEY] = marketCache;
      chrome.storage.local.set(payload);
    } catch (e) { /* кэш — не критично, работаем без него */ }
  }

  // Сводка по рынку из кэша. null — данных нет (или они протухли), тогда работает базовый расчёт.
  function marketFor(price) {
    if (typeof msMarketStats !== 'function') return null;
    var id = productId();
    if (!id) return null;
    var entry = marketCache[id];
    if (!entry || !entry.prices || entry.prices.length < 3) return null;
    if (Date.now() - (entry.ts || 0) > MARKET_TTL) return null;
    return msMarketStats(entry.prices, price);
  }

  function fetchMarket(url, id) {
    if (!url || !id || marketPending[id] || typeof fetch !== 'function') return;
    if (marketFail[id] && Date.now() - marketFail[id] < MARKET_RETRY) return;

    marketPending[id] = true;
    fetch(url, { credentials: 'same-origin' })
      .then(function (response) {
        return response && response.ok ? response.text() : '';
      })
      .then(function (html) {
        if (!html) { marketFail[id] = Date.now(); return; }
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var prices = parseOfferPrices(doc);
        // Меньше трёх цен — усреднять нечего, оставляем базовый расчёт и не кэшируем мусор.
        if (prices.length < 3) { marketFail[id] = Date.now(); return; }
        marketCache[id] = { ts: Date.now(), prices: prices, url: url };
        saveMarketCache();
        lastSignature = '';
        refresh();
      })
      .catch(function () {
        // Антибот, офлайн, смена вёрстки — молча живём без рыночных данных.
        marketFail[id] = Date.now();
      })
      .then(function () { delete marketPending[id]; });
  }

  // Просим рынок, если свежих данных нет. Вызывается и бейджем, и попапом:
  // попап не должен ждать, пока бейдж успеет отрисоваться.
  function requestMarket(data) {
    if (!data || !data.offersUrl) return;
    var id = productId();
    if (!id) return;
    var cached = marketCache[id];
    if (!cached || Date.now() - (cached.ts || 0) > MARKET_TTL) {
      fetchMarket(data.offersUrl, id);
    }
  }

  // ---------- Расчёт ----------

  // profit = price * (1 - commission) - logistics - ads - cost
  // Считаем общей функцией из rates.js, чтобы бейдж и попап не расходились.
  function calcProfit(price, cfg) {
    var c = cfg || currentSettings();
    if (typeof msNetProfit === 'function') return msNetProfit(price, c);
    var commission = Number(c.commission) || 0;
    var logistics = Number(c.logistics) || 0;
    var ads = Number(c.ads) || 0;
    return Math.round(price * (1 - commission) - logistics - ads);
  }

  function calcMargin(price, profit) {
    if (!price) return null;
    return Math.round((profit / price) * 1000) / 10; // % с одним знаком
  }

  function fmt(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value));
  }

  function pct(value) {
    var n = Math.round((Number(value) || 0) * 1000) / 10;
    return String(n).replace('.', ',') + '%';
  }

  // Русские склонения: 1 предложение, 2 предложения, 5 предложений.
  function plural(count, one, few, many) {
    var n = Math.abs(Math.round(Number(count) || 0));
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  function collect() {
    var price = getPrice();
    var oldPrice = getOldPrice();
    var seller = getSeller();
    var offers = getOffers();
    var titleEl = document.querySelector(SELECTORS.title);
    var profit = price ? calcProfit(price) : null;
    var active = currentSettings();
    var market = marketFor(price);

    return {
      status: price ? 'ok' : 'no-price',
      url: location.href,
      title: titleEl ? normText(titleEl.textContent) : document.title,
      price: price,
      oldPrice: oldPrice,
      discount: (price && oldPrice && oldPrice > price)
        ? Math.round((1 - price / oldPrice) * 100) : null,
      seller: seller.name,
      sellerUrl: seller.url,
      offersCount: offers.count,
      offersUrl: offers.url,
      profit: profit,
      margin: price ? calcMargin(price, profit) : null,
      cost: Number(active.cost) || 0,
      breakEven: (typeof msBreakEvenPrice === 'function') ? msBreakEvenPrice(active) : null,
      targetPrice: (typeof msTargetMarginPrice === 'function') ? msTargetMarginPrice(active, 20) : null,
      market: market,
      access: {
        mode: access.mode,
        daysLeft: access.daysLeft,
        expiresAt: access.expiresAt,
        keyError: access.keyError || null
      },
      settings: {
        commission: active.commission,
        logistics: active.logistics,
        ads: active.ads,
        cost: Number(active.cost) || 0,
        model: active.model,
        category: active.category
      },
      debug: {
        page: isProductPage() ? 'product' : 'other',
        path: String(location.pathname).slice(0, 80),
        priceSource: lastPriceSource,
        sellerSource: lastSellerSource,
        offersSource: lastOffersSource,
        offersCount: offers.count,
        productId: productId(),
        marketCount: market ? market.count : 0,
        badge: !!document.getElementById(BADGE_ID),
        titleSource: typeof SELECTORS.title !== 'undefined' ? 'config' : null,
        version: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
          ? chrome.runtime.getManifest().version : null
      }
    };
  }

  // ---------- UI ----------

  function removeBadge() {
    var badge = document.getElementById(BADGE_ID);
    if (badge) badge.remove();
  }

  function badgeRoot(badge) {
    if (!badge) return null;
    if (badge.shadowRoot) return badge.shadowRoot.querySelector('.ms-root') || badge.shadowRoot;
    return badge;
  }

  // Бейдж живёт в Shadow DOM: стили страницы его не перебивают и не прячут.
  function ensureBadge() {
    var badge = document.getElementById(BADGE_ID);
    if (badge && badge.shadowRoot) return badge;

    if (badge && !badge.shadowRoot) {
      badge.remove();
      badge = null;
    }

    var anchor = pick(SELECTORS.priceZone);
    if (!anchor || !anchor.parentNode) return null;

    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.setAttribute('data-ms', 'badge');
    badge.style.cssText = 'display:block;margin:8px 0 6px;max-width:100%';

    var shadow = badge.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent =
      ':host{display:block;margin:0}' +
      '.ms-root{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border-radius:12px;' +
      'background:linear-gradient(135deg,#0b1f3a,#17395f);color:#fff;' +
      'font:600 14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 2px 10px rgba(11,31,58,.25)}';
    var root = document.createElement('div');
    root.className = 'ms-root';
    shadow.appendChild(style);
    shadow.appendChild(root);

    anchor.parentNode.insertBefore(badge, anchor.nextSibling);
    return badge;
  }

  function renderBadge(data) {
    if (!isProductPage() || !data.price) { removeBadge(); return; }
    var badge = ensureBadge();
    if (!badge) return;

    var root = badgeRoot(badge);
    if (!root) return;
    root.textContent = '';

    var active = currentSettings();
    var commission = Number(active.commission) || 0;
    var commissionMoney = data.price * commission;
    var modelShort = (typeof msModelShort === 'function') ? msModelShort(active.model) : String(active.model || '');
    var modelFull = (typeof msModelFull === 'function') ? msModelFull(active.model) : '';

    var main = document.createElement('span');
    main.style.cssText = 'font-size:16px;color:' + (data.profit >= 0 ? '#f5c451' : '#ff8a80');
    main.textContent = 'Прибыль с продажи ≈ ' + fmt(data.profit) + ' ₽' +
      (data.profit < 0 ? ' (уходите в минус)' : '');
    root.appendChild(main);

    var sub = document.createElement('span');
    sub.style.cssText = 'font-size:11px;font-weight:400;color:#c9d6e8';
    sub.textContent = 'Маркет ' + fmt(commissionMoney) + ' ₽ (' + pct(commission) + ')' +
      ' · доставка ' + fmt(active.logistics) + ' ₽' +
      ' · реклама ' + fmt(active.ads) + ' ₽';
    root.appendChild(sub);

    var facts = [];
    if (data.margin !== null) facts.push('Остаётся ' + String(data.margin).replace('.', ',') + '% цены');
    if (modelShort) facts.push('схема: ' + modelShort);

    if (facts.length) {
      var line = document.createElement('span');
      line.style.cssText = 'font-size:11px;font-weight:400;color:#9fb3cc';
      line.textContent = facts.join(' · ');
      root.appendChild(line);
    }

    var shopFacts = [];
    if (data.seller) shopFacts.push('магазин: ' + data.seller);
    if (data.offersCount) {
      shopFacts.push('ещё ' + data.offersCount + ' ' +
        plural(data.offersCount, 'предложение', 'предложения', 'предложений'));
    }

    if (shopFacts.length) {
      var shopLine = document.createElement('span');
      shopLine.style.cssText = 'font-size:11px;font-weight:400;color:#9fb3cc';
      shopLine.textContent = shopFacts.join(' · ');
      root.appendChild(shopLine);
    }

    // Риск: маржа ниже 10% — скидка или возврат съедят прибыль.
    if (data.margin !== null && data.margin > 0 && data.margin < 10) {
      var risk = document.createElement('span');
      risk.style.cssText = 'font-size:11px;font-weight:700;color:#ff8a80';
      risk.textContent = 'Маржа ' + String(data.margin).replace('.', ',') + '% — риск: скидка или возврат съедят прибыль';
      root.appendChild(risk);
    }

    // Ставка ниже официального тарифа — прибыль завышена. Это главная причина «инструмент врёт».
    var rate = Number(active.commission) || 0;
    if (access.mode !== 'expired' && rate > 0 && rate < 0.32) {
      var lowRate = document.createElement('span');
      lowRate.style.cssText = 'font-size:11px;font-weight:700;color:#ffb84d';
      lowRate.textContent = 'Тариф ' + pct(rate) + ' ниже тарифа Маркета (32–53%) — прибыль завышена, проверьте ставку';
      root.appendChild(lowRate);
    } else if (access.mode !== 'expired' && !hints.tariff) {
      // Первый запуск: объясняем, откуда взялась ставка, чтобы цифра не выглядела «из воздуха».
      var tariffHint = document.createElement('span');
      tariffHint.style.cssText = 'font-size:11px;font-weight:400;color:#9fb3cc';
      tariffHint.textContent = 'Ставка ' + pct(rate) + ' — средняя по Маркету. Свою категорию можно выбрать в окне расширения.';
      root.appendChild(tariffHint);
      markHint('tariff');
    }

    // Рынок: то, что продавец не видит со своей карточки.
    var market = data.market;
    if (market && market.count >= 3) {
      var marketLine = document.createElement('span');
      marketLine.style.cssText = 'font-size:11px;font-weight:400;color:#c9d6e8';
      marketLine.textContent = 'Вы ' + market.position + '-е из ' + market.count + ' по цене' +
        ' · медиана рынка ' + fmt(market.median) + ' ₽';
      root.appendChild(marketLine);

      if (access.mode === 'expired') {
        var locked = document.createElement('span');
        locked.style.cssText = 'font-size:11px;font-weight:600;color:#f5c451';
        locked.textContent = 'Сколько вы теряете на этой цене — в полной версии';
        root.appendChild(locked);
      } else if (market.median > data.price) {
        // Разница до медианы за вычетом комиссии Маркета — деньги «на столе».
        var gap = market.median - data.price;
        var extra = Math.round(gap * (1 - (Number(active.commission) || 0)));
        if (extra > 0) {
          var potential = document.createElement('span');
          potential.style.cssText = 'font-size:11px;font-weight:600;color:#7ee2a8';
          potential.textContent = 'При цене медианы: +' + fmt(extra) + ' ₽ к прибыли с продажи';
          root.appendChild(potential);
        }
      }
    }

    badge.title = 'Как считаем: цена минус комиссия Маркета, минус доставка, минус реклама.' +
      (data.cost ? ' Себестоимость: ' + fmt(data.cost) + ' ₽.' : '') +
      (modelFull ? ' Схема работы: ' + modelFull + '.' : '');

    // Пробный период закончился: базовый расчёт остаётся, но зовём в полную версию.
    if (access.mode === 'expired' && typeof MS_LICENSE !== 'undefined') {
      var promo = document.createElement('a');
      promo.href = MS_LICENSE.PURCHASE_URL;
      promo.target = '_blank';
      promo.rel = 'noopener';
      promo.style.cssText = 'font-size:11px;font-weight:600;color:#f5c451;text-decoration:underline';
      promo.textContent = 'Пробный период закончился — полная версия за ' +
        ((typeof msPriceLabel === 'function') ? msPriceLabel('month') : '199 ₽/мес');
      root.appendChild(promo);
    }

    // Свежих рыночных данных нет — подтягиваем страницу предложений в фоне.
    // Если запрос не пройдёт (антибот, офлайн), бейдж остаётся на базовом расчёте.
    requestMarket(data);
  }

  function refresh() {
    jsonLdLoaded = false;
    jsonLdCache = null;
    try {
      renderBadge(collect());
    } catch (e) {
      console.warn('[Маркет-Снайпер] не удалось обновить бейдж:', e && e.message);
    }
  }

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay || 400);
  }

  // ---------- SPA-навигация ----------

  // Лёгкая подпись состояния: меняется — пересчитываем (Маркет подменяет DOM без перезагрузки).
  // Наличие бейджа в подписи важно: при перерисовке страница может снести наш блок,
  // а цена и магазин останутся теми же.
  function signature() {
    var priceEl = getPriceEl();
    var sellerEl = document.querySelector(SELECTORS.shopBlock + ' ' + SELECTORS.shopTitle);
    return location.pathname + '|' + (priceEl ? priceEl.textContent : '') +
      '|' + (sellerEl ? sellerEl.textContent : '') +
      '|' + (document.getElementById(BADGE_ID) ? '1' : '0') +
      '|' + access.mode;
  }

  function startWatching() {
    var observer = new MutationObserver(function () {
      if (signature() !== lastSignature) scheduleRefresh(400);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Страховка: часть блоков дорисовывается без мутаций в наблюдаемом поддереве.
    setInterval(function () {
      var sig = signature();
      if (sig !== lastSignature) {
        lastSignature = sig;
        refresh();
      }
    }, 1200);
  }

  // ---------- Удалённый конфиг селекторов ----------

  // Данные, а не код: можно поправить вёрстку без перевыпуска расширения.
  // Запрос идёт через background, чтобы не зависеть от CORS страницы Маркета.
  function loadSelectorConfig() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          resolve();
          return;
        }
        chrome.runtime.sendMessage({ type: 'GET_SELECTOR_CONFIG' }, function (res) {
          if (chrome.runtime.lastError) { resolve(); return; }
          applySelectorConfig(res && res.config);
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  // ---------- Настройки ----------

  function loadSettings() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
          resolve(settings);
          return;
        }
        chrome.storage.local.get(STORAGE_KEY, function (res) {
          var stored = (res && res[STORAGE_KEY]) || {};
          settings = Object.assign({}, DEFAULTS, stored);
          resolve(settings);
        });
      } catch (e) {
        resolve(settings);
      }
    });
  }

  function loadAccess() {
    if (typeof msGetAccess !== 'function') return Promise.resolve(access);
    return msGetAccess().then(function (state) {
      access = state;
      return access;
    }, function () {
      return access;
    });
  }

  // ---------- Обмен с попапом ----------

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'COLLECT') {
      var data = collect();
      // Попап может открыться раньше, чем отработает бейдж, — запускаем загрузку рынка и отсюда.
      requestMarket(data);
      sendResponse(data);
      return true;
    }

    if (msg.type === 'SETTINGS_UPDATED') {
      loadSettings().then(loadAccess).then(function () {
        lastSignature = '';
        refresh();
        sendResponse(collect());
      });
      return true;
    }
  });

  // ---------- Старт ----------

  loadSelectorConfig()
    .then(loadSettings)
    .then(loadAccess)
    .then(loadHints)
    .then(loadMarketCache)
    .then(function () {
      lastSignature = signature();
      refresh();
      startWatching();
      console.log('[Маркет-Снайпер] content script готов, режим: ' + access.mode);
    });
})();