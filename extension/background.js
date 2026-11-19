// background.js — service worker: удалённый конфиг селекторов и резерв под версию 2.0.
console.log('[Маркет-Снайпер] background worker запущен');

var CONFIG_URL = 'https://sniper.gadget-nakhodki.ru/config/selectors.json';
var CACHE_KEY = 'ms-selector-config';
var CACHE_TTL = 12 * 60 * 60 * 1000; // 12 часов

function readCache() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.local.get(CACHE_KEY, function (res) {
        resolve((res && res[CACHE_KEY]) || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function writeCache(value) {
  return new Promise(function (resolve) {
    try {
      var payload = {};
      payload[CACHE_KEY] = value;
      chrome.storage.local.set(payload, function () { resolve(); });
    } catch (e) {
      resolve();
    }
  });
}

function fetchConfig() {
  return fetch(CONFIG_URL, { cache: 'no-store' }).then(function (response) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  });
}

// Возвращает { config, updatedAt }. Свежий кэш отдаём без запроса,
// при ошибке сети — последний рабочий конфиг.
function getSelectorConfig(force) {
  return readCache().then(function (cached) {
    var fresh = cached && cached.updatedAt && (Date.now() - cached.updatedAt < CACHE_TTL);
    if (!force && fresh) return cached;

    return fetchConfig().then(function (config) {
      var value = { config: config, updatedAt: Date.now() };
      return writeCache(value).then(function () { return value; });
    }).catch(function () {
      return cached || null;
    });
  });
}

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (!msg || msg.type !== 'GET_SELECTOR_CONFIG') return;
  getSelectorConfig(!!msg.force).then(function (value) {
    sendResponse(value || null);
  }, function () {
    sendResponse(null);
  });
  return true;
});
