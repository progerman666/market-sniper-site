// content.js — parser da carta do Mercado Livre Brasil, cálculo de lucro e badge na página.
// Mundo isolado da extensão: DOM é compartilhado, variáveis da página não são visíveis (e vice-versa).
(function () {
  'use strict';

  // Mapa de seletores. Tenta por ordem caso o ML mude o HTML.
  var DEFAULT_SELECTORS = {
    priceZone: ['section.ui-pdp-price', 'div.ui-pdp-price'],
    priceCurrent: ['span.andes-money-amount__fraction', 'span.price-tag-fraction', '[data-testid="price-part"]'],
    priceOld: ['span.andes-money-amount__previous'],
    title: ['h1.ui-pdp-title', 'h1[data-testid="product-title"]', 'h1'],
    seller: ['div.ui-pdp-seller__header__title', 'span.ui-pdp-seller__header__title', '[data-testid="seller-name"]'],
    offersZone: ['section.ui-pdp-buybox', 'div.ui-pdp-buybox']
  };

  var SELECTORS = {};
  Object.keys(DEFAULT_SELECTORS).forEach(function (key) {
    SELECTORS[key] = DEFAULT_SELECTORS[key].slice();
  });

  function pick(selectors, root) {
    var scope = root || document;
    var list = Array.isArray(selectors) ? selectors : [selectors];
    for (var i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      try {
        var el = scope.querySelector(list[i]);
        if (el) return el;
      } catch (e) { /* seletor inválido — ignora */ }
    }
    return null;
  }

  var BADGE_ID = 'ml-profit-badge';
  var STORAGE_KEY = 'ml-settings';
  var DEFAULTS = (typeof ML_DEFAULTS !== 'undefined') ? ML_DEFAULTS : {
    commission: 0.14, fixedFee: 0, logistics: 0, ads: 0, cost: 0, icms: 0.12, country: 'BR', currency: 'BRL'
  };

  var settings = Object.assign({}, DEFAULTS);
  var access = { mode: 'trial', daysLeft: 0, expiresAt: null, purchaseUrl: '' };
  var lastSignature = '';
  var refreshTimer = null;

  function currentSettings() {
    if (access.mode === 'expired') return Object.assign({}, DEFAULTS);
    return settings;
  }

  // ---------- Parsing ----------

  function parsePrice(text) {
    if (!text) return null;
    var cleaned = String(text).replace(/[^\d,]/g, '').replace(',', '.');
    var value = parseFloat(cleaned);
    return isFinite(value) && value > 0 ? value : null;
  }

  function normText(text) {
    return text ? String(text).replace(/\s+/g, ' ').trim() : '';
  }

  function isProductPage() {
    var p = location.pathname;
    return (/MLB-\d+/.test(p)) || (/^\/p\/MLB/.test(p)) || (/produto\//.test(p));
  }

  function findJsonLdProduct(node, depth) {
    if (!node || depth > 4) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var found = findJsonLdProduct(node[i], depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    var types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.indexOf('Product') > -1) return node;
    if (node['@graph']) return findJsonLdProduct(node['@graph'], depth + 1);
    return null;
  }

  function getJsonLdProduct() {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var product = findJsonLdProduct(JSON.parse(scripts[i].textContent), 0);
        if (product) return product;
      } catch (e) { /* não é JSON nosso — ignora */ }
    }
    return null;
  }

  function getMetaPrice() {
    var meta = document.querySelector('meta[property="product:price:amount"]') ||
               document.querySelector('meta[itemprop="price"]') ||
               document.querySelector('meta[property="og:price:amount"]');
    if (!meta) return null;
    var value = parseFloat(String(meta.getAttribute('content') || '').replace(',', '.'));
    return isFinite(value) && value > 0 ? value : null;
  }

  function getJSONPrice() {
    var product = getJsonLdProduct();
    var offers = product && product.offers;
    if (!offers) return null;
    var offerList = Array.isArray(offers) ? offers : [offers];
    for (var i = 0; i < offerList.length; i++) {
      var value = parseFloat(String(offerList[i].price || offerList[i].lowPrice || '').replace(/\s/g, '').replace(',', '.'));
      if (isFinite(value) && value > 0) return value;
    }
    return null;
  }

  function getPriceEl() {
    if (!isProductPage()) return null;
    var zone = pick(SELECTORS.priceZone);
    var el = zone ? pick(SELECTORS.priceCurrent, zone) : null;
    if (!el) el = pick(SELECTORS.priceCurrent);
    return el;
  }

  function getPrice() {
    var el = getPriceEl();
    var fromDom = el ? parsePrice(el.textContent) : null;
    if (fromDom) return fromDom;
    var fromMeta = getMetaPrice();
    if (fromMeta) return fromMeta;
    var fromJson = getJSONPrice();
    if (fromJson) return fromJson;
    return null;
  }

  // ---------- Cálculo ----------

  function calcProfit(price, cfg) {
    var c = cfg || currentSettings();
    if (typeof mlNetProfit === 'function') return mlNetProfit(price, c);
    var commission = Number(c.commission) || 0;
    var logistics = Number(c.logistics) || 0;
    var ads = Number(c.ads) || 0;
    var cost = Number(c.cost) || 0;
    var icms = price * (Number(c.icms) || 0);
    return Math.round(price * (1 - commission) - logistics - ads - cost - icms);
  }

  function calcMargin(price, profit) {
    if (!price) return null;
    return Math.round((profit / price) * 1000) / 10;
  }

  function fmt(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(value));
  }

  function pct(value) {
    var n = Math.round((Number(value) || 0) * 1000) / 10;
    return String(n).replace('.', ',') + '%';
  }

  // ---------- Coleta de dados ----------

  function collect() {
    var price = getPrice();
    var cfg = currentSettings();
    var profit = price ? calcProfit(price, cfg) : null;
    var margin = price && profit !== null ? calcMargin(price, profit) : null;
    var seller = getSeller();
    var id = productId();

    return {
      price: price,
      profit: profit,
      margin: margin,
      title: normText(pick(SELECTORS.title) ? pick(SELECTORS.title).textContent : ''),
      seller: seller,
      productId: id,
      settings: {
        commission: cfg.commission,
        fixedFee: cfg.fixedFee,
        logistics: cfg.logistics,
        ads: cfg.ads,
        cost: Number(cfg.cost) || 0,
        icms: cfg.icms,
        country: cfg.country,
        currency: cfg.currency
      },
      access: access,
      status: price ? 'ok' : 'no-price',
      debug: {
        page: isProductPage() ? 'product' : 'other',
        path: String(location.pathname).slice(0, 80),
        productId: id,
        badge: !!document.getElementById(BADGE_ID),
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
    badge.setAttribute('data-ml', 'badge');
    badge.style.cssText = 'display:block;margin:8px 0 6px;max-width:100%';

    var shadow = badge.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent =
      ':host{display:block;margin:0}' +
      '.ml-root{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border-radius:12px;' +
      'background:linear-gradient(135deg,#0b1f3a,#17395f);color:#fff;' +
      'font:600 14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 2px 10px rgba(11,31,58,.25)}';
    var root = document.createElement('div');
    root.className = 'ml-root';
    shadow.appendChild(style);
    shadow.appendChild(root);

    anchor.parentNode.insertBefore(badge, anchor.nextSibling);
    return badge;
  }

  function renderBadge(data) {
    if (!isProductPage() || !data.price) { removeBadge(); return; }
    var badge = ensureBadge();
    if (!badge) return;
    var root = badge.querySelector('.ml-root') || badge;
    root.textContent = '';

    var active = currentSettings();
    var comissaoMoney = data.price * Number(active.commission || 0);
    var icmsMoney = data.price * Number(active.icms || 0);

    var main = document.createElement('span');
    main.style.cssText = 'font-size:16px;color:' + (data.profit >= 0 ? '#f5c451' : '#ff8a80');
    main.textContent = 'Lucro ≈ ' + fmt(data.profit) +
      (data.profit < 0 ? ' (prejuízo)' : '');
    root.appendChild(main);

    var line = document.createElement('span');
    line.style.cssText = 'font-size:12px;opacity:0.9';
    line.textContent = 'Comissão ≈ ' + fmt(comissaoMoney) +
      ' · ICMS/impostos ≈ ' + fmt(icmsMoney);
    root.appendChild(line);
  }

  function refresh() {
    var data = collect();
    renderBadge(data);
    lastSignature = signature();
  }

  function signature() {
    var priceEl = document.querySelector(SELECTORS.priceCurrent);
    var sellerEl = document.querySelector(SELECTORS.seller);
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

    setInterval(function () {
      var sig = signature();
      if (sig !== lastSignature) {
        lastSignature = sig;
        refresh();
      }
    }, 1200);
  }

  function scheduleRefresh(delay) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay);
  }
    return null;
  }

  function getSeller() {
    if (!isProductPage()) return { name: null, url: null };
    var block = pick(SELECTORS.seller);
    if (!block) return { name: null, url: null };
    var link = block.querySelector('a') || block;
    return {
      name: normText(block.textContent),
      url: link.getAttribute('href') || null
    };
  }

  function productId() {
    var m = String(location.pathname).match(/MLB-(\d+)/);
    if (m && m[1]) return m[1];
    var m2 = String(location.pathname).match(/(\d{9,})(?:\.html|\/|$)/);
    return m2 ? m2[1] : null;
  }
  // ---------- Acesso / licença ----------

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

  // ---------- Mensagens com popup ----------

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'COLLECT') {
      var data = collect();
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

  // ---------- Start ----------

  loadSettings()
    .then(loadAccess)
    .then(function () {
      lastSignature = signature();
      refresh();
      startWatching();
      console.log('[Ganancia ML] content script pronto, modo: ' + access.mode);
    });
})();