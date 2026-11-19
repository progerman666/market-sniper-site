// vk-ads-create.js — запуск рекламы «Маркет-Снайпер» в VK Рекламе через API v2.
//
// Что делает: заводит рекламируемую ссылку, загружает креатив и иконку 256×256, создаёт
// план с кампанией (ad_plan → campaigns[]), группу (ad_group) и объявления (banners)
// по конфигу tools\vk-ads-campaign.json.
// Документация: https://ads.vk.ru/doc/api — ресурсы AdPlans, AdGroups, Banners, Content, Urls.
//
// Схема, проверенная на живом API 15.11.2026:
//   POST /ad_plans.json        {name, objective, budget_limit_day|budget_limit, campaigns:[{name, package_id}]}
//   POST /ad_groups.json       {name, ad_plan_id, package_id, price, mixing, banners[], targetings}
//   баннер                     {urls:{primary}, content:{icon_256x256, image_1080x607}, textblocks:{…}}
// Пакет 3232 — «сайт, CPC, site_conversions»; годится ставка 1…1200 ₽ за клик.
//
// Токен в репозитории не хранится. Порядок поиска:
//   1) --token <значение>
//   2) переменная окружения VK_ADS_TOKEN
//   3) файл токена: --token-file <путь> / VK_ADS_TOKEN_FILE / %USERPROFILE%\.vk-ads-token
//   4) файл реквизитов: --cred-file <путь> / VK_ADS_CRED_FILE / %USERPROFILE%\.vk-ads-credentials / D:\apivk.txt
//      Строки вида «Client ID = …», «Client secret = …», «access_token = …». Секрет из файла
//      обменивается на токен командой token --save, токен дописывается в тот же файл.
//
// Команды:
//   check     — проверить токен (один GET, ничего не меняет)
//   token     — обменять client_id/client_secret на access_token (OAuth2 client_credentials)
//   packages  — показать доступные пакеты (форматы), чтобы выбрать package_id
//   preview   — напечатать тела запросов, не обращаясь к API
//   create    — создать кампанию; по умолчанию status=blocked, то есть деньги не тратятся
//   activate  — перевести готовый черновик в active (--plan id / --campaign id / --group id)
//   status    — сводка кабинета: планы, группы, объявления, модерация и коды показов
//
// Примеры:
//   node tools\vk-ads-create.js check
//   node tools\vk-ads-create.js packages --filter сайт
//   node tools\vk-ads-create.js preview --package 3232 --price 15
//   node tools\vk-ads-create.js create --package 3232 --image promo\vk-ads\creative-1080x607.png
//   node tools\vk-ads-create.js activate --plan 41391498 --campaign 167749714 --group 167749717
//   node tools\vk-ads-create.js create --package 3232 --status active --budget-day 500 --price 15
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'vk-ads-campaign.json');
const API = (process.env.VK_ADS_API || 'https://ads.vk.ru/api/v2').replace(/\/+$/, '');
const CABINET = 'https://ads.vk.ru/hq/dashboard/ad_plans';
const TOKEN_FILE = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.vk-ads-token');
const CRED_FILE_DEFAULT = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.vk-ads-credentials');
// Личный файл реквизитов вне репозитория; путь переопределяется --cred-file или VK_ADS_CRED_FILE.
const CRED_FILE_FALLBACK = 'D:\\apivk.txt';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) { return fallback; }
  const value = process.argv[i + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function has(name) {
  return process.argv.includes('--' + name);
}

// Ключ строки приводим к нижнему регистру без пробелов и разделителей:
// «Client ID», «client_id», «VK ID» → clientid.
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[\s_\-.]/g, '');
}

// Файл реквизитов: строки «ключ = значение» или «ключ: значение», # — комментарий.
function parseCredFile(file) {
  const result = { clientId: '', clientSecret: '', accessToken: '' };
  if (!file || !fs.existsSync(file)) { return result; }
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) { return; }
    const match = trimmed.match(/^([^:=]+?)\s*[=:]\s*(.+)$/);
    if (!match) { return; }
    const key = normalizeKey(match[1]);
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (key === 'clientid' || key === 'vkid' || key === 'appid') { result.clientId = value; }
    else if (key === 'clientsecret' || key === 'secret') { result.clientSecret = value; }
    else if (key === 'accesstoken' || key === 'token' || key === 'vktoken' || key === 'apikey') { result.accessToken = value; }
  });
  return result;
}

function credFilePath() {
  const explicit = arg('cred-file', process.env.VK_ADS_CRED_FILE || '');
  if (explicit) { return explicit; }
  if (fs.existsSync(CRED_FILE_DEFAULT)) { return CRED_FILE_DEFAULT; }
  if (fs.existsSync(CRED_FILE_FALLBACK)) { return CRED_FILE_FALLBACK; }
  return '';
}

// Одна строка — сырой токен; строки «ключ = значение» — файл реквизитов.
function readTokenFile(file) {
  if (!file || !fs.existsSync(file)) { return ''; }
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) { return ''; }
  const cred = parseCredFile(file);
  if (cred.accessToken) { return cred.accessToken; }
  if (/^[A-Za-z][A-Za-z0-9 _-]*\s*[=:]/m.test(text)) { return ''; }
  return text;
}

function readToken() {
  const fromArg = arg('token', '');
  if (fromArg) { return fromArg; }
  if (process.env.VK_ADS_TOKEN) { return process.env.VK_ADS_TOKEN.trim(); }
  const tokenFile = arg('token-file', process.env.VK_ADS_TOKEN_FILE || '');
  const fromFile = readTokenFile(tokenFile || TOKEN_FILE);
  if (fromFile) { return fromFile; }
  const cred = parseCredFile(credFilePath());
  if (cred.accessToken) { return cred.accessToken; }
  return '';
}

// Дописывает access_token в файл реквизитов, не затирая Client ID и Client secret.
function saveTokenToCredFile(file, token) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = text.split(/\r?\n/).filter((line, index, arr) => !(line === '' && index === arr.length - 1));
  let replaced = false;
  const out = lines.map((line) => {
    const match = line.match(/^([^:=]+?)\s*[=:]/);
    if (!match) { return line; }
    const key = normalizeKey(match[1]);
    if (key === 'accesstoken' || key === 'token' || key === 'vktoken') {
      replaced = true;
      return 'access_token = ' + token;
    }
    return line;
  });
  if (!replaced) { out.push('access_token = ' + token); }
  fs.writeFileSync(file, out.join('\r\n') + '\r\n', 'utf8');
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) { throw new Error('Нет конфига: ' + CONFIG_PATH); }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Подсказка по кодам ошибок авторизации — из документации «Авторизация в API».
function tokenHint(code) {
  const hints = {
    invalid_token: 'Токен не существует. VK удаляет access_token, если его не обновляли месяц — выпустите новый (Настройки → Доступ к API) или обменяйте client_id/client_secret командой token.',
    expired_token: 'Срок действия токена истёк — получите новый.',
    invalid_client: 'Неверные client_id/client_secret либо OAuth-клиент заблокирован.',
    invalid_user: 'Пользователь, для которого выписан токен, заблокирован.',
    revoked_token: 'Доступ отозван — нужен новый токен.',
    auth_required: 'Токен не передан: задайте VK_ADS_TOKEN, файл реквизитов или файл ~\.vk-ads-token или --token.'
  };
  return hints[code] || '';
}

async function api(method, resource, body) {
  const token = readToken();
  if (!token) {
    const credFile = credFilePath();
    const place = credFile ? 'добавьте access_token в ' + credFile : 'положите токен в ' + TOKEN_FILE;
    throw new Error('Нет токена. Задайте VK_ADS_TOKEN, ' + place +
      ' или обменяйте реквизиты на токен: node tools\\vk-ads-create.js token --save');
  }
  const options = { method, headers: { Authorization: 'Bearer ' + token } };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(API + resource, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

  if (!response.ok) {
    const code = data && data.error ? data.error.code : '';
    let details = data;
    if (data && data.error) {
      details = data.error.fields || data.error.message || data.error;
    }
    const printed = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
    const error = new Error(method + ' ' + resource + ' → HTTP ' + response.status + (printed ? '\n' + printed : ''));
    error.status = response.status;
    error.code = code;
    error.hint = tokenHint(code);
    throw error;
  }
  return data;
}

// Размер PNG из заголовка IHDR — API требует width/height исходного креатива.
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Креатив должен быть PNG');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}


// ---------- Тела запросов ----------

function buildPlan(config, opts, ids) {
  const plan = config.ad_plan || {};
  const objective = opts.objective || plan.objective;
  if (!objective) {
    throw new Error('Не задана цель кампании: пропишите ad_plan.objective в tools\\vk-ads-campaign.json (для сайта — site_conversions) или передайте --objective.');
  }
  const body = {
    name: plan.name,
    status: opts.status,
    objective: objective,
    // Кампания живёт внутри плана: пакет формата задаётся здесь, группа ссылается на ad_plan_id.
    campaigns: [{
      name: plan.campaign_name || plan.name,
      package_id: ids.packageId === undefined ? '<package_id>' : ids.packageId,
      status: opts.status
    }]
  };
  // Лимиты взаимоисключающие: API отвечает «Can't set both budget_limit and budget_limit_day».
  const budgetDay = opts.budgetDay || plan.budget_limit_day;
  const budget = opts.budget || plan.budget_limit;
  if (budgetDay) { body.budget_limit_day = budgetDay; }
  else if (budget) { body.budget_limit = budget; }
  if (plan.date_start) { body.date_start = plan.date_start; }
  if (plan.date_end) { body.date_end = plan.date_end; }
  return body;
}

// Таргетинг по возрасту в API — перечисление конкретных возрастов, поэтому разворачиваем диапазон.
function buildTargetings(group) {
  const targetings = {};
  const min = Number(group.age_min || 0);
  const max = Number(group.age_max || 0);
  if (min && max && max >= min) {
    const ages = [];
    for (let age = min; age <= max; age++) { ages.push(age); }
    targetings.age = { age_list: ages };
  }
  if (Array.isArray(group.sex) && group.sex.length) { targetings.sex = group.sex; }
  return targetings;
}

function buildGroup(config, opts, ids) {
  const group = config.ad_group || {};
  const id = (value, placeholder) => (value === undefined ? placeholder : value);
  const body = {
    name: group.name,
    status: opts.status,
    package_id: ids.packageId,
    ad_plan_id: id(ids.planId, '<plan_id>'),
    // Ставка в валюте кабинета за единицу пакета: для CPC — за клик, для CPM/oCPM — за 1000 показов.
    price: opts.price || group.price,
    mixing: group.mixing || 'fastest',
    // Роли контента и текстовых блоков заданы паттернами пакета
    // «мультиформат для сайтов»: image_1080x607 + icon_256x256 + title_40_vkads + text_90 + cta_sites_full.
    banners: (config.banners || []).map((banner) => ({
      name: banner.name,
      urls: { primary: { id: id(ids.urlId, '<url_id>') } },
      content: {
        icon_256x256: { id: id(ids.iconId, '<icon_id>') },
        image_1080x607: { id: id(ids.imageId, '<image_id>') }
      },
      textblocks: {
        title_40_vkads: { text: banner.title },
        text_90: { text: banner.text },
        cta_sites_full: { text: config.cta || 'visitSite' }
      }
    })),
    targetings: buildTargetings(group)
  };
  if (opts.budgetDay || group.budget_limit_day) { body.budget_limit_day = opts.budgetDay || group.budget_limit_day; }
  if (opts.budget || group.budget_limit) { body.budget_limit = opts.budget || group.budget_limit; }
  if (opts.objective || group.objective) { body.objective = opts.objective || group.objective; }
  return body;
}

function buildUrlBody(config) {
  return { url: config.landing_url || config.site };
}

// Длина текстов зависит от формата; предупреждаем заранее, чтобы не ловить 400 после модерации.
function checkTexts(config) {
  let problems = 0;
  (config.banners || []).forEach((banner) => {
    if (!banner.title) {
      console.log('  WARN  Нет title у объявления: ' + banner.name);
      problems++;
    } else if (banner.title.length > 40) {
      console.log('  WARN  title длиннее 40 символов (' + banner.title.length + '): ' + banner.title);
      problems++;
    }
    if (!banner.text) {
      console.log('  WARN  Нет text у объявления: ' + banner.name);
      problems++;
    } else if (banner.text.length > 90) {
      console.log('  WARN  text длиннее 90 символов (' + banner.text.length + '): ' + banner.text);
      problems++;
    }
  });
  return problems;
}

// ---------- Команды ----------

async function cmdCheck() {
  const data = await api('GET', '/ad_plans.json?limit=1');
  console.log('Токен работает. Кампаний в кабинете: ' + data.count + '.');
  console.log('Кабинет: ' + CABINET);
}

// Обмен client_id/client_secret на access_token: POST /api/v2/oauth2/token.json (OAuth2 client_credentials).
async function cmdToken() {
  const credFile = credFilePath();
  const cred = parseCredFile(credFile);
  const clientId = arg('client-id', process.env.VK_ADS_CLIENT_ID || cred.clientId || '');
  const clientSecret = arg('client-secret', process.env.VK_ADS_CLIENT_SECRET || cred.clientSecret || '');
  if (!clientId || !clientSecret) {
    throw new Error('Нужны client_id и client_secret (--client-id/--client-secret, переменные VK_ADS_CLIENT_ID/VK_ADS_CLIENT_SECRET или файл реквизитов). Взять их: кабинет → Настройки → Доступ к API.');
  }
  if (credFile && cred.clientId) {
    console.log('Реквизиты взяты из ' + credFile + ' (Client ID ' + cred.clientId.length + ' симв.).');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });
  const response = await fetch(API + '/oauth2/token.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error('POST /oauth2/token.json → HTTP ' + response.status + '\n' + text);
  }
  const data = JSON.parse(text);
  const masked = String(data.access_token || '');
  console.log('access_token: ' + (has('print-token') ? masked : '<скрыт, ' + masked.length + ' симв.; покажите флагом --print-token>'));
  console.log('Срок жизни: ' + data.expires_in + ' сек., scope: ' + (data.scope || '—'));
  if (has('save')) {
    if (credFile) {
      saveTokenToCredFile(credFile, data.access_token);
      console.log('Токен дописан строкой access_token в ' + credFile + ' (файл вне репозитория).');
    } else {
      fs.writeFileSync(TOKEN_FILE, data.access_token, 'utf8');
      console.log('Токен сохранён в ' + TOKEN_FILE + ' (файл вне репозитория).');
    }
  } else {
    console.log('Сохранить токен: повторите команду с флагом --save');
  }
}

// Черновик → запуск: план, кампания и группа переводятся в active, объявления уходят на модерацию.
async function cmdActivate() {
  const targets = [
    ['план', 'ad_plans', Number(arg('plan', 0))],
    ['кампания', 'campaigns', Number(arg('campaign', 0))],
    ['группа', 'ad_groups', Number(arg('group', 0))]
  ].filter((item) => item[2]);
  if (!targets.length) {
    throw new Error('Укажите --plan <id>, --campaign <id> или --group <id>.');
  }
  for (const [label, resource, id] of targets) {
    await api('POST', '/' + resource + '/' + id + '.json', { status: 'active' });
    console.log(label + ' ' + id + ' → active');
  }
  if (arg('group', '')) {
    const group = await api('GET', '/ad_groups/' + Number(arg('group', 0)) + '.json?fields=id,banners');
    const bannerIds = (group.banners || []).map((banner) => banner.id);
    if (bannerIds.length) { console.log('объявления: ' + bannerIds.join(', ')); }
  }
  console.log('Дальше — модерация VK; показы начнутся после одобрения. Кабинет: ' + CABINET);
}

// Сводка по кабинету: планы с кампаниями, группы и объявления — статусы, модерация, деньги.
async function cmdStatus() {
  const plans = await api('GET', '/ad_plans.json?limit=20&fields=id,name,status,budget_limit_day,campaigns');
  console.log('Планы и кампании:');
  (plans.items || []).forEach((plan) => {
    console.log('  план ' + plan.id + '  ' + plan.status + '  ' + plan.name + '  лимит/день: ' + (plan.budget_limit_day || '—'));
    (plan.campaigns || []).forEach((campaign) => {
      console.log('    кампания ' + campaign.id + '  пакет ' + campaign.package_id + '  ' + campaign.name);
    });
  });

  // /ad_groups.json отдаёт и кампании, и группы — печатаем всё, что не удалено.
  const groups = await api('GET', '/ad_groups.json?limit=20&fields=id,name,status,price,budget_limit_day');
  console.log('Кампании и группы (ставка в рублях за единицу пакета):');
  (groups.items || [])
    .filter((group) => group.status !== 'deleted')
    .forEach((group) => {
      console.log('  ' + group.id + '  ' + group.status + '  ставка ' + group.price + '  ' + group.name);
    });

  const banners = await api('GET', '/banners.json?limit=20&fields=id,name,status,moderation_status,vkads_status');
  console.log('Объявления:');
  (banners.items || []).forEach((banner) => {
    const ads = banner.vkads_status || {};
    console.log('  ' + banner.id + '  ' + banner.status + '  модерация: ' + banner.moderation_status +
      '  показы: ' + (ads.status || '—') + ((ads.codes || []).length ? ' (' + ads.codes.join(', ') + ')' : ''));
  });
  console.log('');
  console.log('Кабинет: ' + CABINET);
  console.log('Код NO_MONEY в «показы» = кабинет не пополнен, показов не будет до оплаты.');
}

async function cmdPackages() {
  const filter = String(arg('filter', '')).toLowerCase();
  const limit = Number(arg('limit', 50));
  const data = await api('GET', '/packages.json?limit=' + limit + '&fields=id,name,status,objective,price,description');
  const items = (data.items || []).filter((item) => {
    if (!filter) { return true; }
    return (String(item.name) + ' ' + String(item.description)).toLowerCase().includes(filter);
  });
  if (!items.length) {
    console.log('Ничего не найдено: смените --filter или поднимите --limit (максимум 50 за запрос).');
    return;
  }
  console.log('ID\tНазвание\tЦели\tЦена');
  items.forEach((item) => {
    console.log([item.id, item.name, (item.objective || []).join(',') || '—', item.price].join('\t'));
  });
  console.log('');
  console.log('Понравившийся id подставьте в --package <id>.');
}


function cmdPreview(config, opts) {
  const packageId = Number(arg('package', 0)) || '<package_id>';
  console.log('1) POST /api/v2/urls.json');
  console.log(JSON.stringify(buildUrlBody(config), null, 2));
  console.log('');
  console.log('2) POST /api/v2/ad_plans.json  (план + кампания с package_id)');
  console.log(JSON.stringify(buildPlan(config, opts, { packageId }), null, 2));
  console.log('');
  console.log('3) POST /api/v2/ad_groups.json  (ad_plan_id из шага 2)');
  console.log(JSON.stringify(buildGroup(config, opts, { packageId }), null, 2));
  console.log('');
  console.log('4) POST /api/v2/content/static.json (multipart): file=<png>, data={"width":…,"height":…}');
  console.log('');
  const problems = checkTexts(config);
  console.log(problems ? ('Предупреждений: ' + problems) : 'Тексты в порядке.');
}

async function cmdCreate(config, opts) {
  const packageId = Number(arg('package', 0));
  if (!packageId) {
    throw new Error('Укажите --package <id>. Список форматов: node tools\\vk-ads-create.js packages --filter сайт');
  }
  const imagePath = path.resolve(root, arg('image', 'promo\\vk-ads\\creative-1080x607.png'));
  if (!fs.existsSync(imagePath)) {
    throw new Error('Нет креатива: ' + imagePath + '\nСоберите его: .\\tools\\make-vk-ads-creatives.ps1');
  }
  const image = fs.readFileSync(imagePath);
  const size = pngSize(image);
  const iconPath = path.resolve(root, arg('icon', config.icon || path.join('promo', 'vk-ads', 'icon-256x256.png')));
  if (!fs.existsSync(iconPath)) {
    throw new Error('Нет иконки 256×256: ' + iconPath + ' (её можно сделать из site/img/icon.png)');
  }
  const icon = fs.readFileSync(iconPath);
  const iconSize = pngSize(icon);
  if (iconSize.width !== 256 || iconSize.height !== 256) {
    throw new Error('Иконка должна быть 256×256, а ' + path.basename(iconPath) + ' — ' + iconSize.width + '×' + iconSize.height + '.');
  }

  checkTexts(config);
  if (opts.status === 'active') {
    console.log('Внимание: кампания создаётся активной — показы пойдут после модерации и начнутся списания.');
  }

  console.log('1/5 Рекламируемая ссылка…');
  const url = await api('POST', '/urls.json', buildUrlBody(config));
  console.log('    url_id=' + url.id);

  console.log('2/5 Креатив ' + path.basename(imagePath) + ' ' + size.width + '×' + size.height + '…');
  const form = new FormData();
  form.append('data', JSON.stringify({ width: size.width, height: size.height }));
  form.append('file', new File([image], path.basename(imagePath), { type: 'image/png' }));
  const content = await api('POST', '/content/static.json', form);
  console.log('    image_id=' + content.id);

  console.log('3/5 Иконка ' + path.basename(iconPath) + ' ' + iconSize.width + '×' + iconSize.height + '…');
  const iconForm = new FormData();
  iconForm.append('data', JSON.stringify({ width: iconSize.width, height: iconSize.height }));
  iconForm.append('file', new File([icon], path.basename(iconPath), { type: 'image/png' }));
  const iconContent = await api('POST', '/content/static.json', iconForm);
  console.log('    icon_id=' + iconContent.id);

  console.log('4/5 План и кампания…');
  const plan = await api('POST', '/ad_plans.json', buildPlan(config, opts, { packageId }));
  const campaignId = ((plan.campaigns || [])[0] || {}).id;
  console.log('    ad_plan_id=' + plan.id + (campaignId ? '  campaign_id=' + campaignId : ''));

  console.log('5/5 Группа и объявления…');
  const group = await api('POST', '/ad_groups.json', buildGroup(config, opts, {
    packageId,
    planId: plan.id,
    urlId: url.id,
    imageId: content.id,
    iconId: iconContent.id
  }));
  const bannerIds = (group.banners || []).map((banner) => banner.id);

  console.log('');
  console.log('Готово.');
  console.log('  план (ad_plan):     ' + plan.id + '  «' + config.ad_plan.name + '»');
  console.log('  кампания:           ' + (campaignId || '—'));
  console.log('  группа (ad_group):  ' + group.id);
  console.log('  объявления:         ' + (bannerIds.join(', ') || '—'));
  console.log('  статус:             ' + opts.status + (opts.status === 'blocked' ? ' (черновик: показов и списаний нет)' : ''));
  console.log('  кабинет:            ' + CABINET);
}


(async () => {
  const command = (process.argv[2] || '').toLowerCase();
  const needsConfig = command === 'preview' || command === 'create';
  const config = needsConfig ? loadConfig() : null;
  const opts = {
    status: arg('status', (config && config.ad_plan && config.ad_plan.status) || 'blocked'),
    budgetDay: arg('budget-day', ''),
    budget: arg('budget', ''),
    price: arg('price', ''),
    objective: arg('objective', '')
  };

  try {
    if (command === 'check') { await cmdCheck(); return; }
    if (command === 'token') { await cmdToken(); return; }
    if (command === 'packages') { await cmdPackages(); return; }
    if (command === 'activate') { await cmdActivate(); return; }
    if (command === 'status') { await cmdStatus(); return; }
    if (command === 'preview') { cmdPreview(config, opts); return; }
    if (command === 'create') {
      if (has('dry-run')) { cmdPreview(config, opts); return; }
      await cmdCreate(config, opts);
      return;
    }
    console.log('Команды: check | token | packages | preview | create | activate | status');
    console.log('Описание — в шапке файла tools\\vk-ads-create.js');
    const credFile = credFilePath();
    console.log('Файл реквизитов: ' + (credFile || 'не найден (--cred-file / VK_ADS_CRED_FILE)'));
    console.log('Файл токена: ' + TOKEN_FILE);
  } catch (error) {
    console.error('');
    console.error('Ошибка: ' + error.message);
    if (error.hint) { console.error('Подсказка: ' + error.hint); }
    process.exitCode = 1;
  }
})();

