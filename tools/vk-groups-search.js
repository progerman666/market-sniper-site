// Поиск сообществ ВКонтакте через VK Ads API v2 (vk_groups.json).
// Токен и реквизиты — из файла D:\apivk.txt (или VK_ADS_CRED_FILE / --cred-file).
// Запуск: node tools\vk-groups-search.js ozon "яндекс маркет" маркетплейсы
//         node tools\vk-groups-search.js --probe        (подобрать формат фильтра)

const fs = require('fs');
const path = require('path');

const API = 'https://ads.vk.ru/api/v2';
const CRED_FILE = process.env.VK_ADS_CRED_FILE || 'D:\\apivk.txt';

function readCredValue(key) {
  let text;
  try {
    text = fs.readFileSync(CRED_FILE, 'utf8');
  } catch (err) {
    return null;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([^=:]+?)\s*[=:]\s*(.+)$/);
    if (!m) continue;
    if (m[1].trim().toLowerCase() === key.toLowerCase()) return m[2].trim();
  }
  return null;
}

function getToken() {
  if (process.env.VK_ADS_TOKEN) return process.env.VK_ADS_TOKEN.trim();
  const fromCred = readCredValue('access_token');
  if (fromCred) return fromCred;
  const tokenFile = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.vk-ads-token');
  try {
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch (err) {
    return null;
  }
}

async function get(url, token) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const token = getToken();
  if (!token) {
    console.error('Нет токена. Положите access_token в ' + CRED_FILE + ' или задайте VK_ADS_TOKEN.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const probe = args.includes('--probe');
  const queries = args.filter((a) => !a.startsWith('--'));

  if (probe) {
    const variants = [
      'vk_groups.json?q=ozon',
      'vk_groups.json?q=ozon&limit=5',
      'vk_groups.json?q=ozon&_limit=5',
      'vk_groups.json?q=' + encodeURIComponent('озон'),
    ];
    for (const v of variants) {
      const r = await get(API + '/' + v, token);
      console.log('=== ' + v + ' -> ' + r.status);
      console.log(r.text.slice(0, 400));
      console.log('');
    }
    return;
  }

  const list = queries.length ? queries : ['маркетплейсы', 'яндекс маркет', 'ozon', 'wildberries'];
  for (const q of list) {
    const url = API + '/vk_groups.json?q=' + encodeURIComponent(q);
    const r = await get(url, token);
    console.log('=== ' + q + ' -> HTTP ' + r.status);
    console.log(r.text.slice(0, 1200));
    console.log('');
  }
}

main().catch((err) => {
  console.error('Ошибка: ' + err.message);
  process.exit(1);
});
