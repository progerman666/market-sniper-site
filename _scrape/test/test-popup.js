// Тест popup.html + popup.js + rates.js в jsdom (без Chrome).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const html = fs.readFileSync(path.join(ext, 'popup.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'chrome-extension://ms/popup.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});

const win = dom.window;
const doc = win.document;

const stored = {};
const sent = [];

win.chrome = {
  storage: {
    local: {
      get: (key, cb) => {
        const res = stored[key] ? { [key]: stored[key] } : {};
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (payload, cb) => {
        Object.assign(stored, payload);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  },
  tabs: {
    query: () => Promise.resolve([{ id: 7 }]),
    sendMessage: (tabId, msg) => {
      sent.push(msg);
      if (msg.type === 'COLLECT') {
        return Promise.resolve({
          status: 'ok',
          url: 'https://market.yandex.ru/product/6307487765',
          title: 'Смартфон Apple iPhone 15 256 ГБ',
          price: 46844,
          oldPrice: 104677,
          discount: 55,
          seller: 'chengzhongde',
          sellerUrl: 'https://market.yandex.ru/business--chengzhongde/216944481',
          offersCount: 74,
          offersUrl: 'https://market.yandex.ru/offers/x',
          profit: 27070,
          margin: 57.8,
          access: { mode: 'trial', daysLeft: 5, expiresAt: Date.now() + 5 * 86400000, keyError: null },
          settings: { commission: 0.42, logistics: 100, ads: 0, model: 'FBS', category: 'Все товары' }
        });
      }
      return Promise.resolve({ status: 'ok' });
    }
  }
};

// jsdom не умеет crypto.subtle — подкладываем Node WebCrypto ДО запуска скриптов
const { webcrypto } = require('crypto');
try {
  Object.defineProperty(win, 'crypto', { value: webcrypto, configurable: true });
} catch (e) {
  console.log('не удалось подменить crypto:', e.message);
}

win.eval(fs.readFileSync(path.join(ext, 'rates.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(ext, 'license.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(ext, 'popup.js'), 'utf8'));

function b64u(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signKey(payload) {
  const privB64 = fs.readFileSync(path.join(root, 'server', 'keys', 'dev-private.txt'), 'utf8').trim();
  const key = await webcrypto.subtle.importKey(
    'pkcs8', Buffer.from(privB64, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const data = Buffer.from(JSON.stringify(payload));
  const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data));
  return 'MS1.' + b64u(data) + '.' + b64u(sig);
}

function check(name, condition, extra) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!condition) process.exitCode = 1;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(100);

  check('категории заполнены', doc.querySelectorAll('#category option').length === 20,
    doc.querySelectorAll('#category option').length);
  check('схемы работы по-русски', doc.querySelectorAll('#model option').length === 4 &&
    doc.querySelector('#model option').textContent.indexOf('Товар на складе Маркета') > -1,
    doc.querySelector('#model option').textContent);
  check('подсказка по схеме показана', doc.getElementById('scheme-hint').textContent.indexOf('Простыми словами') > -1,
    doc.getElementById('scheme-hint').textContent.slice(0, 50));
  check('комиссия по умолчанию 42%', doc.getElementById('commission').value === '42',
    doc.getElementById('commission').value);
  check('логистика по умолчанию 100', doc.getElementById('logistics').value === '100');
  check('подсказка про тариф', doc.getElementById('hint').textContent.indexOf('42%') > -1,
    doc.getElementById('hint').textContent.slice(0, 60));

  doc.getElementById('collect').click();
  await wait(100);

  const rows = doc.querySelectorAll('#data tr');
  check('таблица построена', rows.length >= 12, rows.length);
  const text = doc.getElementById('data').textContent.replace(/\u00A0/g, ' ');
  check('в таблице цена', text.indexOf('46') > -1, text.slice(0, 80));
  check('в таблице магазин', text.indexOf('chengzhongde') > -1);
  check('в таблице прибыль', text.indexOf('42') > -1);
  check('в таблице нет аббревиатур FBY/FBS',
    text.indexOf('FBS') === -1 && text.indexOf('FBY') === -1, text.slice(0, 120));
  check('в таблице «Маркет забирает» с суммой', text.indexOf('Маркет забирает') > -1 && text.indexOf('19 674') > -1);
  check('строка «Прибыль с продажи»', text.indexOf('Прибыль с продажи') > -1, text.slice(0, 120));
  check('строка «Без убытка»', text.indexOf('Без убытка') > -1);
  check('строка «Для маржи 20%»', text.indexOf('Для маржи 20%') > -1);
  check('строка «Медиана рынка» без данных', text.indexOf('Медиана рынка') > -1 && text.indexOf('предл.') === -1);
  check('прибыль зелёная', !!doc.querySelector('#data td.profit'));
  check('COLLECT отправлен', sent.some((m) => m.type === 'COLLECT'));

  doc.getElementById('apply-category').click();
  await wait(500);

  check('тариф категории подставлен (42%)', doc.getElementById('commission').value === '42',
    doc.getElementById('commission').value);
  check('логистика пересчитана (1000+92)', doc.getElementById('logistics').value === '1092',
    doc.getElementById('logistics').value);
  check('настройки сохранены', !!stored['ms-settings'] && stored['ms-settings'].commission === 0.42,
    JSON.stringify(stored['ms-settings']));
  check('попап уведомил страницу', sent.some((m) => m.type === 'SETTINGS_UPDATED'));

  // --- доступ: триал / окончание / активация ключа ---
  check('статус: пробный период', doc.getElementById('status').textContent.indexOf('Пробный период') > -1,
    doc.getElementById('status').textContent);
  check('в таблице строка «Доступ»', doc.getElementById('data').textContent.indexOf('пробный период') > -1);
  check('в триале настройки доступны', doc.getElementById('commission').disabled === false);

  stored['ms-license'] = { trialStart: Date.now() - 8 * 86400000, key: null };
  await win.refreshAccess();
  check('статус: пробный закончился', doc.getElementById('status').textContent.indexOf('закончился') > -1,
    doc.getElementById('status').textContent);
  check('настройки заблокированы', doc.getElementById('commission').disabled === true &&
    doc.getElementById('apply-category').disabled === true);

  const licenseKey = await signKey({ v: 1, tier: 'pro', exp: Math.floor(Date.now() / 1000) + 30 * 86400 });
  doc.getElementById('license-key').value = licenseKey;
  doc.getElementById('activate').click();
  await wait(400);
  check('ключ активирован', doc.getElementById('status').textContent.indexOf('Полная версия активна') > -1,
    doc.getElementById('status').textContent);
  check('настройки разблокированы', doc.getElementById('commission').disabled === false);
  check('ключ сохранён в хранилище', !!stored['ms-license'] && !!stored['ms-license'].key);

  const savedKey = stored['ms-license'].key;
  doc.getElementById('license-key').value = 'MS1.abc.def';
  doc.getElementById('activate').click();
  await wait(400);
  check('мусорный ключ не затирает лицензию', stored['ms-license'].key === savedKey);
  check('показана ошибка по ключу', doc.getElementById('license-msg').textContent.length > 0,
    doc.getElementById('license-msg').textContent);

  // --- себестоимость и обратная задача цены (на ручном расчёте) ---
  doc.getElementById('cost').value = '24000';
  doc.getElementById('manual-price').value = '46844';
  doc.getElementById('manual-calc').click();
  await wait(100);
  const costText = doc.getElementById('data').textContent.replace(/\u00A0/g, ' ');

  // 46 844 × 0,58 − 1 092 (доставка категории) − 24 000 = 2 077,5
  check('себестоимость в таблице', costText.indexOf('24 000') > -1, costText.slice(0, 200));
  check('прибыль после закупки', costText.indexOf('2 078') > -1, costText.slice(0, 220));
  check('без убытка: 25 092 / 0,58', costText.indexOf('43 262') > -1, costText.slice(0, 260));
  check('цена для маржи 20%: 25 092 / 0,38', costText.indexOf('66 032') > -1, costText.slice(0, 260));

  doc.getElementById('cost').dispatchEvent(new win.Event('input'));
  await wait(400);
  check('себестоимость сохраняется в настройках',
    !!stored['ms-settings'] && stored['ms-settings'].cost === 24000,
    JSON.stringify(stored['ms-settings']));

  // --- ручной расчёт, если страница не прочиталась ---
  doc.getElementById('manual-price').value = '1000';
  doc.getElementById('manual-calc').click();
  const manualText = doc.getElementById('data').textContent.replace(/\u00A0/g, ' ');
  check('ручной расчёт: заголовок', manualText.indexOf('Ручной расчёт') > -1, manualText.slice(0, 60));
  check('ручной расчёт: цена 1 000', manualText.indexOf('1 000') > -1, manualText.slice(0, 120));
  check('ручной расчёт: убыток подсвечен', !!doc.querySelector('#data td.loss'), manualText.slice(0, 160));
  check('ручной расчёт: подсказка показана', doc.getElementById('out').textContent.indexOf('Считаю по вашей цене') > -1,
    doc.getElementById('out').textContent);

  console.log(process.exitCode ? 'ITOG: FAIL' : 'ITOG: OK');
  process.exit(process.exitCode || 0);
})();
