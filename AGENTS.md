# AGENTS.md — правила работы в проекте «Маркет-Снайпер»

Краткий контекст для AI-агента. Читать перед любой задачей. Файл — UTF-8.

## Что это

Расширение Chrome/Edge (MV3) для продавцов Яндекс.Маркета: на карточке товара
считает и показывает чистую прибыль (ставка Маркета, логистика, реклама).
Плюс лицензирование ключами (Cloudflare Worker) и сайт/лендинг/промо.

## Карта репозитория

| Путь | Что там | Трогать можно? |
|---|---|---|
| `extension/` | **единственное**, что грузится в браузер: `manifest.json`, `rates.js`, `license.js`, `content.js`, `popup.html`, `popup.js`, `background.js` | да |
| `_scrape/` | dev-материалы: HTML-фикстуры, скриншоты, `test/` с jsdom-тестами | да, в сборку не входит |
| `server/` | Cloudflare Worker (лицензии), `src/index.js`, `wrangler.jsonc`, `keys/` | да |
| `site/`, `landing/`, `store/`, `kwork/`, `promo/` | сайт, лендинг, материалы для магазинов расширений, промо | да |
| `tools/` | node/ps1-скрипты: сборка zip, выдача ключей, TTS, проверка сайта | да |
| `dist/` | готовые zip-сборки для Edge Add-ons | только сборкой |
| `notes.md` | карта селекторов Яндекс.Маркета, словарь терминов, формула | обновлять при изменении парсинга |

## Технологии и стиль

- Чистый JavaScript (ES2020+), **без сборки, без npm-зависимостей в `extension/`**.
  Никаких бандлеров, транспиляции и фреймворков — только файлы, которые грузит браузер.
- `manifest_version: 3`, content_scripts: `rates.js` → `license.js` → `content.js` (порядок важен).
- `server/` — ESM (`"type": "module"`), Cloudflare Worker, wrangler.
- `_scrape/test/` — CommonJS + jsdom, тесты запускаются напрямую `node test-*.js`.
- Весь пользовательский интерфейс, комментарии, коммиты и тексты — **по-русски**.
  В коде — `camelCase`, идентификаторы английские, как в существующих файлах.
- Деньги/проценты в UI — с пробелом-разделителем тысяч и знаком `₽` (см. `content.js`).
- Не добавлять `console.log` в релизные ветки кода; для отладки — за флагом/локально.

## Команды

```powershell
# тесты парсера и popup (jsdom)
cd D:\projects\market-sniper\_scrape\test
npm install jsdom      # один раз
node test-content.js
node test-popup.js
node test-search.js
node test-license.js
node test-issue.js
node test-rates.js      # обратная задача цены + рыночные сводки
node test-offers.js     # парсер страницы «Все предложения»

# прототип рыночных данных на сохранённой странице
node _scrape\offers-stats.js
node _scrape\offers-stats.js _scrape\offers.html --price 46844 --commission 42

# рендер демо-бейджа для лендинга
node _scrape\make-badge.js

# реклама в VK Рекламе: креативы и запуск кампании через API v2
.\tools\make-vk-ads-creatives.ps1
.\tools\vk-ads-token.ps1 -ClientId <client_id>     # client_secret вводится скрыто, токен → %USERPROFILE%\.vk-ads-token
node tools\vk-ads-create.js token --save             # client_id+secret из файла реквизитов → access_token
node tools\vk-ads-create.js check                    # жив ли токен (VK_ADS_TOKEN / файл реквизитов)
node tools\vk-ads-create.js packages --filter сайт   # выбрать package_id формата
node tools\vk-ads-create.js preview --package <id>   # тела запросов без отправки
node tools\vk-ads-create.js create --package <id>    # создаёт кампанию в статусе blocked

# статья для Дзена: markdown → HTML для вставки в Дзен-студию
node tools\dzen-article.js

# физический тест в headless Edge без запросов к Яндексу
cd D:\projects\market-sniper\_scrape\test
node serve-fixture.js 8080
# во втором окне:
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu `
  --remote-debugging-port=9455 --user-data-dir="$env:TEMP\ms-edge-final" `
  --load-extension="D:\projects\market-sniper\_scrape\test-ext" `
  "http://localhost:8080/product--x/6307487765"
node D:\projects\market-sniper\_scrape\test\check-page.js 9455

# сборка zip для Edge Add-ons
powershell -File D:\projects\market-sniper\tools\build-extension-zip.ps1

# сервер лицензий
cd D:\projects\market-sniper\server
npm run dev      # wrangler dev
npm run deploy
```

## Ловушки, на которых уже спотыкались

1. В браузере грузится **папка `extension\`**, а не корень проекта.
2. Chrome/Edge запрещают файлы и папки с `_` в начале внутри расширения —
   поэтому `_scrape` вынесен из `extension`.
3. Яндекс редиректит `/product--<slug>/<id>` → `/card/<slug>/<id>`.
   Парсинг должен работать на **обоих** путях, иначе бейдж исчезает после перерисовки.
4. `[data-zone-name="price"]` есть и в сниппетах поиска — парсить только когда
   `location.pathname` начинается с `/product` или `/card`.
5. PowerShell 5.1 читает UTF-8 файлы как ANSI (кириллица превращается в «РњР°СЂРєРµС‚»).
   Для чтения — `Get-Content -Encoding UTF8` или инструмент чтения файлов,
   для записи — `Set-Content -Encoding UTF8`.
6. `extension/manifest.json` — источник правды по `matches` и версии; при релизе
   поднимать `version` и пересобирать zip в `dist/`.
7. Секреты (`server/keys/`, `*.log`, токены TTS) в репозиторий и в UI не попадают.

## Как проверять результат

Любое изменение в `content.js` / `popup.js` / `rates.js` считается готовым только если:

1. прогнаны соответствующие `node test-*.js` из `_scrape/test` и они зелёные;
2. если менялся парсинг — обновлён `notes.md` (селекторы) и, при необходимости, фикстуры;
3. в отчёте указано, что именно запускалось и с каким выводом.

## Формат ответа агента

- Сначала короткий план (что и зачем), потом правки, потом результат проверки.
- Ссылки на файлы — с абсолютными путями и номерами строк.
- Если требование неоднозначно — задать один точный вопрос, а не угадывать.
