// license.js — пробный период и лицензионный ключ. Общий модуль для content.js и popup.js.
// Ключ = MS1.<base64url(payload)>.<base64url(подпись ECDSA P-256)>.
// В расширении лежит только ПУБЛИЧНЫЙ ключ: подделать ключ доступа нельзя.
// Приватный ключ живёт в Cloudflare Worker (secret PRIVATE_KEY_B64), см. server/.

var MS_LICENSE = {
  STORAGE_KEY: 'ms-license',
  TRIAL_DAYS: 7,
  PREFIX: 'MS1',
  PUBLIC_KEY_B64: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/UBXDzJpbtQXMPjCfa4YYkBsQKeBpRfem+omEtOSGOz0IjuT4DBslh0wgrCE5UE7/r29IJwXE4pmPJqJPor5xQ==',
  PURCHASE_URL: 'https://sniper.gadget-nakhodki.ru/buy.html',
  DAY_MS: 86400000
};

// Цены. Стартуем с минимальной, поднимаем по мере роста установок и рейтинга.
// Меняется в двух местах: здесь (что видит продавец) и в server/src/index.js (что выдаётся).
var MS_PRICING = {
  month: 199,
  year: 1990,
  currency: '₽'
};

function msPriceLabel(plan) {
  var value = (plan === 'year') ? MS_PRICING.year : MS_PRICING.month;
  var formatted = new Intl.NumberFormat('ru-RU').format(value);
  if (plan === 'year') return formatted + ' ' + MS_PRICING.currency + ' в год';
  return formatted + ' ' + MS_PRICING.currency + '/мес';
}

function msB64ToBytes(b64) {
  var binary = atob(b64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function msB64UrlToBytes(value) {
  var b64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return msB64ToBytes(b64);
}

function msPlural(count, one, few, many) {
  var n = Math.abs(Math.round(Number(count) || 0));
  var mod10 = n % 10;
  var mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function msFormatDate(timestamp) {
  if (!timestamp) return '—';
  var d = new Date(timestamp);
  var dd = ('0' + d.getDate()).slice(-2);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  return dd + '.' + mm + '.' + d.getFullYear();
}

function msReadLicense() {
  return new Promise(function (resolve) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get(MS_LICENSE.STORAGE_KEY, function (res) {
        resolve((res && res[MS_LICENSE.STORAGE_KEY]) || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function msWriteLicense(data) {
  return new Promise(function (resolve) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve(false);
        return;
      }
      var payload = {};
      payload[MS_LICENSE.STORAGE_KEY] = data;
      chrome.storage.local.set(payload, function () { resolve(true); });
    } catch (e) {
      resolve(false);
    }
  });
}

// Проверка подписи и срока действия ключа.
async function msVerifyLicenseKey(rawKey) {
  try {
    var key = String(rawKey || '').trim();
    var parts = key.split('.');
    if (parts.length !== 3 || parts[0] !== MS_LICENSE.PREFIX) {
      return { ok: false, error: 'Ключ не похож на ключ Маркет-Снайпера' };
    }

    var cryptoApi = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : null;
    if (!cryptoApi) return { ok: false, error: 'Браузер не умеет проверять ключи' };

    var payloadBytes = msB64UrlToBytes(parts[1]);
    var signature = msB64UrlToBytes(parts[2]);

    var publicKey = await cryptoApi.subtle.importKey(
      'spki',
      msB64ToBytes(MS_LICENSE.PUBLIC_KEY_B64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    var valid = await cryptoApi.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      publicKey,
      signature,
      payloadBytes
    );

    if (!valid) return { ok: false, error: 'Ключ не настоящий или повреждён' };

    var payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!payload || typeof payload.exp !== 'number') {
      return { ok: false, error: 'В ключе нет срока действия' };
    }
    if (payload.exp * 1000 < Date.now()) {
      return { ok: false, error: 'Срок действия ключа закончился', exp: payload.exp };
    }
    return { ok: true, exp: payload.exp, tier: payload.tier || 'pro' };
  } catch (e) {
    return { ok: false, error: 'Не удалось проверить ключ: ' + (e && e.message) };
  }
}

// Текущий режим: pro (есть ключ) / trial (первые 7 дней) / expired (только базовый расчёт).
async function msGetAccess() {
  var now = Date.now();
  var stored = await msReadLicense();

  if (!stored) {
    stored = { trialStart: now, key: null };
    await msWriteLicense(stored);
  }
  if (!stored.trialStart) stored.trialStart = now;

  var access = {
    mode: 'trial',
    tier: null,
    trialStart: stored.trialStart,
    daysLeft: 0,
    expiresAt: null,
    key: stored.key || null,
    keyError: null,
    purchaseUrl: MS_LICENSE.PURCHASE_URL
  };

  if (stored.key) {
    var check = await msVerifyLicenseKey(stored.key);
    if (check.ok) {
      access.mode = 'pro';
      access.tier = check.tier;
      access.expiresAt = check.exp * 1000;
      access.daysLeft = Math.max(0, Math.ceil((access.expiresAt - now) / MS_LICENSE.DAY_MS));
      return access;
    }
    access.keyError = check.error;
  }

  var trialEnd = stored.trialStart + MS_LICENSE.TRIAL_DAYS * MS_LICENSE.DAY_MS;
  access.expiresAt = trialEnd;
  if (now < trialEnd) {
    access.mode = 'trial';
    access.daysLeft = Math.max(1, Math.ceil((trialEnd - now) / MS_LICENSE.DAY_MS));
  } else {
    access.mode = 'expired';
    access.daysLeft = 0;
  }
  return access;
}

// Сохраняет ключ, если он валиден. Возвращает результат проверки.
async function msActivateKey(rawKey) {
  var check = await msVerifyLicenseKey(rawKey);
  if (!check.ok) return check;

  var stored = (await msReadLicense()) || { trialStart: Date.now(), key: null };
  stored.key = String(rawKey).trim();
  await msWriteLicense(stored);
  return check;
}

async function msForgetKey() {
  var stored = (await msReadLicense()) || { trialStart: Date.now() };
  stored.key = null;
  await msWriteLicense(stored);
}
