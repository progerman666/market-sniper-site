// Разведка справочника сообществ VK Ads API v2 (endpoint /api/v2/vk_groups.json).
// Запуск: node tools/vk-groups-probe.js "запрос"
// Токен ищется там же, где его ищет vk-ads-create.js: --token, VK_ADS_TOKEN,
// файл реквизитов (D:\apivk.txt или %USERPROFILE%\.vk-ads-credentials).
// Скрипт только читает данные, ничего не создаёт и не меняет в кабинете.

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.vk-ads-token');
const CRED_FILE = process.env.VK_ADS_CRED_FILE || 'D:\\apivk.txt';
const BASE = 'https://ads.vk.ru/api/v2';

function readCredValue(file, key) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp('^\\s*' + key + '\\s*[=:]\\s*(.+)$', 'im');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function readToken() {
  const argIdx = process.argv.indexOf('--token');
  if (argIdx > -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1];
  if (process.env.VK_ADS_TOKEN) return process.env.VK_ADS_TOKEN.trim();
  for (const file of [CRED_FILE, TOKEN_FILE]) {
    const token = readCredValue(file, 'access_token');
    if (token) return token;
    if (fs.existsSync(file)) {
      const first = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
      if (first && !first.includes('=') && !first.includes(':')) return first;
    }
  }
  return null;
}

async function get(pathname, params) {
  const url = new URL(BASE + pathname);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  return { status: res.status, text };
}

const token = readToken();
if (!token) {
  console.error('Нет токена. Положите его в ' + CRED_FILE + ' или задайте VK_ADS_TOKEN.');
  process.exit(1);
}

const query = process.argv[2] || 'маркетплейсы';

(async () => {
  const attempts = [
    ['?q как параметр', 'vk_groups.json', { q: query, limit: 10 }],
    ['?q + fields', 'vk_groups.json', { q: query, limit: 10, fields: 'members_count,status' }],
    ['filter как JSON', 'vk_groups.json', { filter: JSON.stringify({ q: query }), limit: 10 }],
  ];

  for (const [label, pathname, params] of attempts) {
    const r = await get(pathname, params);
    console.log('=== ' + label + ' -> HTTP ' + r.status);
    console.log(r.text.slice(0, 900));
    console.log('');
  }
})();
