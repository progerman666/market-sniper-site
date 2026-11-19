# Маркет-Снайпер — карта селекторов и формула

Расширение MV3 для Chrome/Яндекс.Браузера: показывает продавцу Яндекс.Маркета чистую прибыль прямо на карточке товара.

## Структура проекта

| Файл | Назначение |
|---|---|
| `extension/manifest.json` | MV3-манифест: content_scripts = `rates.js`, `license.js`, `content.js`; host — `*://*.market.yandex.ru/*` |
| `extension/rates.js` | Справочник ставок (официальные тарифы Маркета) + дефолты, общий для content и popup |
| `extension/license.js` | Пробный период, проверка ключа (ECDSA P-256, офлайн), режимы доступа, цены |
| `extension/content.js` | Парсер карточки, расчёт прибыли, бейдж на странице, `chrome.runtime.onMessage` |
| `extension/popup.html` / `popup.js` | Таблица данных, настройки ставок, статус доступа и ввод ключа |
| `extension/background.js` | Service worker, резерв под версию 2.0 |
| `server/` | Cloudflare Worker: выдача и проверка лицензионных ключей (см. `server/README.md`) |
| `dist/` | Готовые zip для Edge Add-ons |
| `_scrape/` | dev-материалы: фикстуры, jsdom-тесты, скриншоты (в расширение не входит) |

**Важно:** подгружать в браузере нужно папку `extension\`, а не корень проекта. Chrome/Edge запрещают файлы и папки, начинающиеся с `_`, внутри расширения — именно поэтому `_scrape` вынесен из `extension`.

## Карта селекторов (проверено на живой странице 14.11.2026)

Страница товара бывает на двух путях, скрипт понимает оба:
`https://market.yandex.ru/product--<slug>/<productId>` и канонический `https://market.yandex.ru/card/<slug>/<productId>`. Внутри страницы Маркет сам редиректит на `/card/...` — если учитывать только `/product`, бейдж пропадает после первой же перерисовки (проверено в реальном Edge).

| Что | Селектор | Примечание |
|---|---|---|
| Блок цены (якорь для бейджа) | `[data-zone-name="price"]` | есть на карточке товара, в поиске отсутствует |
| Текущая цена | `[data-zone-name="price"] [data-auto="snippet-price-current"]` | внутри — `<span>`-ы: «104 677» + «₽» |
| Старая (зачёркнутая) цена | `[data-zone-name="price"] [data-auto="snippet-price-old"]` | опционально |
| Название товара | `[data-auto="productCardTitle"]` | `<h1>` |
| Карточка продавца | `[data-auto="shop-info-block"]` | блок «Магазин» под ценой (ShopInfoBlock) |
| Название магазина | `[data-auto="shop-info-block"] [data-auto="shop-info-title"]` | текст внутри `<span>` |
| Ссылка на магазин | `[data-auto="shop-info-block"] [data-auto="shop-info-link"]` | `/business--<slug>/<businessId>` |
| Число предложений | `[data-zone-name="morePrices"]` → `data-zone-data` | JSON: `{"numOffers":74,"url":"/offers/..."}` |
| Ссылка «все предложения» | `[data-auto="offersEntrypoint"]` | fallback, если JSON не распарсился |

Важно: `[data-zone-name="price"]` встречается и в сниппетах поиска, поэтому парсинг включается только когда `location.pathname` начинается с `/product`. Проверено тестом `test-search.js`.

Парсинг числа:

```js
parseFloat(text.replace(/[^\d.,]/g, '').replace(',', '.'))
// "2 892 ₽" -> 2892, "104 677 ₽" -> 104677, "1 234,50 ₽" -> 1234.5
```

## Словарь терминов (весь интерфейс — по-русски)

| В коде / на Маркете | В интерфейсе расширения |
|---|---|
| FBY | «Товар на складе Маркета» |
| FBS | «Свой склад, доставка Маркета» |
| DBS | «Свой склад и своя доставка» |
| Экспресс | «Быстрая доставка за 1–2 часа» |
| `commission` | «Маркет берёт, %» |
| `logistics` | «Доставка, ₽» |
| `ads` | «Реклама, ₽» |
| `profit` | «Чистая прибыль» |
| `margin` | «Остаётся от цены» |
| `offersCount` | «Предложений у товара» |

Аббревиатура остаётся только в скобках в выпадающем списке — для тех, кто привык к ней. В бейдже на странице аббревиатур нет вообще, схема подписана словами («свой склад, везёт Маркет»), полное объяснение — во всплывающей подсказке (`title`) и в попапе под списком.

## Формула

```
profit = price * (1 - commission) - logistics - ads
margen = profit / price * 100
```

- `commission` — доля (0.10 = 10%).
- `logistics` — ₽ за заказ (доставка + средняя миля + обработка).
- `ads` — ₽ рекламы на заказ.
- Дефолты MVP: `commission = 0.10`, `logistics = 100`, `ads = 0`.
- Округление прибыли — до рубля (`Math.round`).

## Официальные ставки Маркета (14.11.2026)

Источники: `.../introduction/rates/placement`, `.../rates/models/fby`, `.../rates/models/fbs`, `.../rates/models/dbs`.

**Размещение, % от указанной продавцом цены** (одинаково для FBY/FBS/Экспресс/DBS):

| Категория | Тариф |
|---|---|
| Все товары | 42% |
| Цветы | 32% |
| Книги | 43% |
| Ритуальные товары / Товары для животных | 50% |
| Бытовая техника | 51% |
| Компьютерная техника / Электроника | 51,5% |
| Авто, Аптека, Дача, Детские, Досуг, Оборудование, Одежда, Продукты, Товары для дома, Красота | 52% |
| Спорт и отдых, Строительство и ремонт | 53% |

**Логистика FBY/FBS:**
- доставка покупателю — 5% от цены, но не больше 1000 ₽;
- средняя миля — 92 ₽ за первый литр + 8 ₽ за каждый следующий (до 200 л), максимум 5500 ₽;
- недорогие товары (цена ≤ 300 ₽ и объём ≤ 5 л) — единый тариф 42% вместо размещения + доставки + средней мили.

**DBS:** доставку считает Маркет (публичного тарифа нет) → задаётся вручную.

Важно: 10% в дефолте — оптимистичная оценка из ТЗ. Реальный тариф размещения 32–53%, поэтому в попапе есть кнопка «Тариф категории», которая подставляет официальный процент и оценку логистики.

## Поведение на странице

- Бейдж `#ms-profit-badge` вставляется сразу после `[data-zone-name="price"]`.
- Показывается только на `/product...` и `/card/...`; на поиске и в каталоге не рисуется.
- Маркет — SPA: пересчёт по `MutationObserver` (debounce 400 мс) + страховочный `setInterval` 1.2 с по подписи `URL|цена|магазин|есть_бейдж`. Наличие бейджа в подписи обязательно: при перерисовке страница может снести наш блок, а цена и магазин останутся прежними.
- Название магазина вставляется через `textContent` (без innerHTML) — XSS исключён.
- `FailedHydrationError` в консоли Маркета — не наша ошибка, игнорируем.

## Лицензирование: 7 дней триала → базовый режим

- Первые 7 дней после установки — полный доступ (настройки, тарифы по категориям, реклама).
- Без ключа после триала: бейдж остаётся, но считается по базовым ставкам (Маркет 10%, доставка 100 ₽, реклама 0) и появляется строка «Пробный период закончился — включить полную версию». Настройки в попапе блокируются.
- Ключ: `MS1.<payload>.<подпись>`, payload = `{"v":1,"tier":"pro","exp":<unix>,"sub":"<заказ>"}`, подпись ECDSA P-256.
- Проверка подписи и срока — локально через WebCrypto, поэтому работает офлайн. Приватный ключ лежит только в воркере (`PRIVATE_KEY_B64`), в расширении — публичный (`license.js → MS_LICENSE.PUBLIC_KEY_B64`). Подделать ключ нельзя: тест `test-license.js` проверяет, что изменённый payload отклоняется.
- Выдача: `POST /api/license/issue` с заголовком `X-Admin-Secret` → `{ key, exp, id }`. Проверка/отзыв: `GET /api/license/check?key=…` + KV-запись `revoked:<id>`.
- Настройки при истечении не удаляются: после оплаты ключ вставляется в попапе, всё возвращается.
- `MS_LICENSE.PURCHASE_URL` — заглушка `https://sniper-market.ru/`, заменить на настоящий домен после делегирования в Cloudflare.
- Логика режимов: `_scrape/test/test-license.js` (16 проверок), гейт в интерфейсе — `test-content.js` (26) и `test-popup.js` (28).

## Проверка

### 1. Вручную в своём браузере (главный способ)

1. `edge://extensions` (или `chrome://extensions`) → включить «Режим разработчика» → «Загрузить распакованное» → выбрать **`D:\projects\market-sniper\extension`** (именно подпапку `extension`, не корень проекта).
2. Открыть любую карточку товара `market.yandex.ru` → под ценой должен появиться блок «Прибыль ≈ N ₽».
3. Кликнуть иконку расширения → «Собрать данные» → таблица с ценой, магазином, прибылью.
4. В попапе поменять комиссию/логистику → бейдж на странице обновляется сразу.
5. `F12` → Console: должно быть `[Маркет-Снайпер] content script готов`; `FailedHydrationError`/`FailedDeserializationError` — ошибки самого Маркета, игнорировать.

### 2. Автотесты на сохранённых страницах (jsdom, без браузера)

```powershell
cd D:\projects\market-sniper\_scrape\test
npm install jsdom
node test-content.js   # парсер, расчёт, бейдж, авто-восстановление (17 проверок)
node test-popup.js     # таблица попапа, пресет тарифа, сохранение настроек (15 проверок)
node test-search.js    # на поиске бейдж не рисуется и цена не парсится (3 проверки)
```

### 3. Физический тест в реальном Edge без запросов к Яндексу (headless + CDP)

```powershell
# 1) локальный сервер с сохранённой карточкой
cd D:\projects\market-sniper\_scrape\test
node serve-fixture.js 8080        # в отдельном окне

# 2) копия расширения с matches для localhost
#    (_scrape\test-ext, создаётся командой Copy-Item из корня проекта)

# 3) Edge с расширением и DevTools-портом
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu `
  --remote-debugging-port=9455 --user-data-dir="$env:TEMP\ms-edge-final" `
  --load-extension="D:\projects\market-sniper\_scrape\test-ext" `
  "http://localhost:8080/product--x/6307487765"

# 4) чтение состояния страницы через CDP
node check-page.js 9455
```

Результат последнего прогона: `path=/card/...`, `price=46 844 ₽`, `seller=chengzhongde`, `badge=Чистая прибыль ≈ 42 060 ₽ … магазин: chengzhongde · ещё 74 предложения`. Скриншоты: `_scrape/shot-badge-crop3.png` (бейдж), `_scrape/shot-popup.png` (попап).

Примечание: `--host-resolver-rules` Edge игнорирует, поэтому подмена `market.yandex.ru` на localhost не сработала — тестируем копией расширения с `matches: *://localhost/*`. Прямые запросы к Маркету из скриптов упираются в 403 (лимит по IP), в обычном браузере с их куками страница открывается нормально.

Важно про запуск: **обычный (не headless) Edge игнорирует `--load-extension`** — окно откроется, но расширения в нём не будет, и бейджа тоже. Флаг работает только в `--headless=new`, поэтому он годится для автотестов, а для ручной проверки расширение ставится через `edge://extensions` → «Режим разработчика» → «Загрузить распакованное» → `D:\projects\market-sniper\extension`.

## Ограничения MVP

- Список «Предложения магазинов» рендерится JS-ом, в статике его нет: сейчас берём число предложений и ссылку, сравнение конкурентов — платная версия (нужен перехват API/доработка селекторов).
- Комиссия и логистика задаются вручную (пресеты по категориям есть, по подкатегориям — платная версия).
- Место вставки бейджа привязано к `[data-zone-name="price"]` — если Маркет переименует зону, бейдж не появится (fallback: `[data-auto="snippet-price-current"]`).

## Публикация и монетизация

- Сначала Microsoft Edge Add-ons (бесплатно), затем Chrome Web Store (нужна иностранная карта).
- Free: одна формула, дефолтные ставки.
- Pro (299–499 ₽/мес, СБП через самозанятость): настройка FBY/FBS/DBS, учёт рекламы, история, сравнение с конкурентами.
- Лендинг: заголовок «Маркет-Снайпер — чистая прибыль на карточке Яндекс.Маркета», видео/скриншоты, «Скачать» и «Купить» (СБП), инструкция по установке. Базой может стать готовый лендинг в `D:\projects\ozon-finds-worker\docs` — переименовать и заменить контент.
- Иконка: прицел + график + стрелка вверх, тёмно-синий + золото. Готовые файлы: `icons/icon16.png` (только символ), `icons/icon48.png`, `icons/icon128.png` (с подписью «Снайпер-маркет»), подключены в `manifest.json` (`"icons"` и `"action.default_icon"`).

## Иконки и сборка

- Исходник: `C:\Users\dlypo\Downloads\MiniMax H3 Image-1.jpeg` (1024×1024).
- Генерация: `node _scrape\make-icons.js "<путь к исходнику>"`. Белый фон вокруг карточки становится прозрачным (alpha=0 при R,G,B > 236); для 16×16 вырезается область `x 40..880, y 0..770` (подпись начинается с y=804) и вписывается через `fit: contain` — без искажений пропорций.
- Превью: `_scrape/preview-full.png`, `_scrape/preview-symbol.png`, `_scrape/preview-16-zoom.png`.
- Сборка пакета: `dist\market-sniper-0.3.0.zip` — `manifest.json`, `background.js`, `content.js`, `rates.js`, `license.js`, `popup.html`, `popup.js`, `icons/*` (всё из папки `extension`). В zip не входят `_scrape`, `server`, `kwork`, `dist`, `*.md`, `publish-edge.ps1`.

## Релиз на Ru-Center (основной путь вместо Cloudflare)

Cloudflare из РФ периодически недоступен, поэтому сайт и API лицензий крутятся на обычном хостинге Ru-Center: статика + PHP. Отдельного сервера и Node не нужно.

```
site/                  ← этот каталог = public_html
  index.html buy.html privacy.html offer.html styles.css robots.txt .htaccess
  img/                 скриншоты расширения, иконка
  download/            market-sniper-0.3.0.zip для покупателей
  api/                 PHP-API лицензий (openssl, без внешних библиотек)
    plans.php          GET  цены — читает и лендинг, и расширение
    issue.php          POST выдача ключа (X-Admin-Secret)
    check.php          GET  проверка/отзыв ?key=MS1...
    admin.php          страница выдачи ключа после оплаты
    config.php         пароль, тарифы, путь к ключу (закрыт .htaccess + guard)
    keys/private.pem   приватный ключ подписи (закрыт .htaccess)
    data/              issued.log и revoked.json (закрыт .htaccess)
dist/site-rucenter.zip готовый архив для загрузки в public_html
```

Пошагово: `site/README.md`. Кратко: панель Ru-Center → Хостинг → Файловый менеджер → загрузить `site-rucenter.zip` в `public_html` → распаковать в корень (чтобы `index.html` и `api` лежали рядом) → PHP 8.0+ → открыть `/api/plans.php`.

Особенности PHP-подписи: `openssl_sign` отдаёт подпись ECDSA в DER, а браузер ждёт raw r‖s — в `helpers.php` есть конвертеры `ms_der_to_raw`/`ms_raw_to_der`. Без них ключи не проходили проверку в расширении (поймано тестом).

Проверки: `node _scrape\test\test-php-api.js` — 12 проверок (цены, отказ без пароля, выдача ключа, проверка ключа верификатором расширения, подделка, журнал, закрытый config.php). Локальный запуск: `php -S 127.0.0.1:8111 -t site` с переменной `MS_ADMIN_SECRET`.

Перед публикацией заменить: `hello@example.ru`, телефон СБП, ФИО/ИНН, банк (в `index.html`, `buy.html`, `privacy.html`, `offer.html`, `config.php`), `MS_PRICING.purchaseUrl` в `extension/license.js` → `https://<домен>/buy.html`, пересобрать zip расширения и положить в `site/download/`.

Быстрый способ сделать это одной командой: `.\set-domain.ps1 -Domain "<домен>" -Email "<почта>"` — правит `PURCHASE_URL` в `extension/license.js`, canonical в `index.html`, e-mail во всех страницах и пересобирает оба архива.

Выбранный путь запуска: **поддомен на существующем домене Ru-Center** (`sniper.<старый-домен>.ru`), потом покупка `sniper-market.ru` и переезд той же командой + 301-редирект со старого адреса. Инструкция — в `site/README.md`, раздел «Вариант поддомен».

## Деплой лендинга: GitHub Pages на поддомене gadget-nakhodki.ru

Домен `gadget-nakhodki.ru` живёт на GitHub Pages (DNS в Cloudflare, A-записи 185.199.108-111.153), поэтому платный хостинг не нужен.

- Репозиторий: `github.com/progerman666/market-sniper-site` (public, ветка `main`).
- Содержимое: `site/` без папки `api/` + файл `CNAME` = `sniper.gadget-nakhodki.ru`.
- GitHub Pages включён: source `main` / `/`, custom domain `sniper.gadget-nakhodki.ru`.
- Проверено: `https://progerman666.github.io/market-sniper-site/` отдаёт `301 → http://sniper.gadget-nakhodki.ru/`.
- Осталось: CNAME-запись в Cloudflare — `sniper → progerman666.github.io`, **Proxy off (DNS only)**. После этого GitHub выпускает сертификат, затем включить «Enforce HTTPS».

**Состояние на 14.11.2026 (готово):**
- DNS: `sniper.gadget-nakhodki.ru` CNAME → `progerman666.github.io`, DNS only. Корневые A-записи `gadget-nakhodki.ru` (185.199.108–111.153) не трогаем — на них живёт старый сайт.
- HTTPS: сертификат GitHub `approved` (домен `sniper.gadget-nakhodki.ru`, до 12.02.2027), `https_enforced: true`, `http → 301 https`.
- Перевыпуск сертификата прилипал: помогло удаление и возврат файла `CNAME` в репозитории (коммиты `c82bd95` и `06bc6e8`) — после этого сертификат выпустился за ~2 минуты.
- Реквизиты на сайте: СБП +7 923 493-26-88, Воробьев Евгений Александрович, ИНН 422194497805, Сбербанк; e-mail `goinslims@gmail.com` (заменён через `set-domain.ps1 -Email`; скрипт меняет любой e-mail регуляркой, а не конкретную заглушку).
- Проверено по HTTPS: главная (`<h1>`, canonical), `buy.html` (телефон/ИНН/банк), `download/market-sniper-0.3.0.zip` (200, 66 980 Б), `http → 301`.
- Ящик `goinslims@gmail.com` рабочий — отдельную почту на домене заводить не обязательно; если понадобится адрес `@gadget-nakhodki.ru`, включаем Cloudflare Email Routing на `hello@` и меняем адрес через `set-domain.ps1 -Email`.

Так как на Pages нет PHP, ключи выдаются офлайн:

```powershell
node tools\issue-key.js --plan month --order "СБП-0001"
node tools\issue-key.js --plan year  --order "buyer@mail.ru"
```

Скрипт подписывает ключ локально (ECDSA P-256, raw r‖s), печатает `MS1.…` и пишет запись в `server\issued.log`. Проверка: `node _scrape\test\test-issue.js` — 5 проверок, ключ принимается верификатором расширения.

Вариант с PHP-API (`site/api/`) остаётся рабочим для платного хостинга: если понадобится автоматическая выдача и отзыв ключей — заливаете `site/` целиком на Ru-Center и меняете только `PURCHASE_URL`.

## Упрощение установки и оплаты (14.11.2026)

**Установка.** Главное упрощение — каталог Edge Add-ons (установка в 2 клика вместо «распаковать и загрузить»). Подготовлено:
- `store/edge-listing.md` — название, краткое/подробное описание, обоснование разрешений, заметки для сертификации, поисковые термины, чек-лист отправки;
- `store/screenshots/shot1-badge.png`, `shot2-popup.png`, `shot3-trial.png` — 1280×800, генерируются `_scrape/make-store-shots.js`;
- в манифесте оставлено **одно разрешение `storage`** (убраны `activeTab`, `scripting`, `downloads`) — меньше вопросов на ревью; бейдж проверен после чистки в headless Edge;
- политика конфиденциальности для ревью: `https://sniper.gadget-nakhodki.ru/privacy.html`.

**Оплата.** `buy.html` переделан: блок с суммой и реквизитами, кнопки «Скопировать номер» и «Скопировать сумму», письмо с заполненной темой и телом, сумма подставляется по тарифу из `?plan=year`.
Пакетная выдача ключей для ручного режима: `node tools\issue-keys.js --plan month --count 20 --out keys-month.csv` (печатает список и пишет CSV, каждый ключ в `server\issued.log`).

**Автоматизация «Мой налог».** Автоматический чек НПД формирует только платёжный провайдер-партнёр ФНС при онлайн-оплате (нужен договор и модерация сайта). Официальный API «Мой налог» частному самозанятому недоступен (только партнёрам). План: подключить провайдера → `site/api/pay.php` создаёт платёж → `webhook.php` проверяет подпись, вызывает `ms_issue()`, отправляет письмо с ключом → провайдер сам отправляет чек в «Мой налог». Код API готов, нужен только аккаунт провайдера и его ключи.

## Блокировка регистрации в Partner Center (14.11.2026)

При регистрации в программе Microsoft Edge Partner Center вернул: «Microsoft runs on trust… your request was blocked», reference `715-123225`, correlation `6e8fb5e4-e685-4277-a694-4c420e4046b8`.

Это проверка Trust & Safety, а не ошибка формы. Порядок действий:
- апелляция с этими ID — готовый текст в `store/appeal-microsoft.md` (отправлять через support.microsoft.com → "Extensions New Support Request");
- повторять попытку только после ответа поддержки, с личным MSA (не организацией), без VPN, с домашнего IP, не создавая несколько аккаунтов подряд;
- если подтвердят региональное ограничение — каталог Edge недоступен, основной канал: ручная установка zip с сайта, вторые каналы — Chrome Web Store и Opera.

На сайте блок «Каталог Microsoft Edge» оставлен нейтральным («Скоро в каталоге»), основная кнопка — скачивание.

## Публикация в Edge

### 1. Аккаунт (бесплатно)

Microsoft-аккаунт → Partner Center → регистрация в программе Microsoft Edge. Оплаты нет (в отличие от Chrome Web Store). `ProductId` появляется после создания расширения: Partner Center → Microsoft Edge → ваше расширение, виден в URL `/products/<ProductId>`.

### 2. Первая публикация — только вручную

Partner Center → New extension → загрузить `dist\market-sniper-0.3.0.zip` (manifest.json в корне zip) → Availability (рынки, видимость) → Properties (категория «Инструменты для бизнеса») → Privacy (назначение, обоснование прав `storage`/`activeTab`/`scripting`/`downloads`, политика конфиденциальности — нужна, работаем с коммерческими данными) → Store listing (описание, скриншоты 1280×800; иконка берётся из пакета) → Certification notes → Submit. Проверка обычно занимает несколько рабочих дней.

### 3. Обновления — через API (v1.1, API key)

1. Partner Center → **Publish API** → Enable → скопировать **Client ID** и **API key**. Это и есть «взять API»: отдельного ключа у Edge нет, он выдаётся только в Partner Center после создания расширения. Azure AD / client secret нужен лишь для устаревшего v1 (access token).
2. Запуск: `.\publish-edge.ps1 -ProductId <id> -ClientId <id> -ApiKey <key> -PackagePath .\dist\market-sniper-0.3.0.zip -Notes "0.3.0"`
3. Что делает скрипт:
   - `POST {base}/v1/products/{productId}/submissions/draft/package` — заголовки `Authorization: ApiKey <key>`, `X-ClientID: <clientId>`, `Content-Type: application/zip`; ответ 202 + `Location` = operationId;
   - `GET {base}/v1/products/{productId}/submissions/draft/package/operations/{op}` — статус загрузки;
   - `POST {base}/v1/products/{productId}/submissions` с `{"notes":"..."}` — публикация черновика;
   - `GET {base}/v1/products/{productId}/submissions/operations/{op}` — статус проверки.
   - `base = https://api.addons.microsoftedge.microsoft.com`.

Ограничение: API обновляет только существующую подачу; первичную публикацию делает только Partner Center.

## Нужен ли кабинет продавца (для этого проекта)

- Для MVP — **не нужен**: расширение читает публичные страницы market.yandex.ru, авторизация не требуется.
- Кабинет продавца можно открыть **без ИП**, как самозанятый (НПД) — источник: `yandex.ru/support/marketplace/ru/introduction/self-employed`.
  - только товары **собственного производства**; перепродажа — нельзя;
  - нельзя: продукты питания, товары с обязательной сертификацией/маркировкой, уценка;
  - только продажа физлицам, модели **FBS / Экспресс / DBS** (FBY самозанятым недоступен);
  - 18+, гражданство РФ, кабинет привязывается к сервису «Мой налог».
- Partner API Маркета (`yandex.ru/dev/market/partner-api`) даёт **свои** товары/заказы/цены, а не предложения конкурентов. Для сравнения с конкурентами остаётся только DOM страницы `/offers/...` — это и есть работа для Pro-версии.

## Проверка готовности (14.11.2026)

Все тесты — 90 проверок, 0 провалов (запуск из `_scrape\test`, Node 26, PHP 8.5; `test-php-api.js` сам поднимает `php -S`):

| Скрипт | Проверок | Итог |
|---|---|---|
| `test-content.js` | 26 | OK |
| `test-search.js` | 3 | OK |
| `test-license.js` | 16 | OK |
| `test-popup.js` | 28 | OK |
| `test-issue.js` | 5 | OK |
| `test-php-api.js` | 12 | OK |

Сверено вручную:

- `dist\market-sniper-0.3.0.zip` побайтово совпадает со всеми 11 файлами `extension\` (хэш каждой записи равен хэшу исходника) и с копией в `site\download\`.
- Живой сайт `https://sniper.gadget-nakhodki.ru/` отдаёт 200; `index.html`, `buy.html`, `privacy.html`, `offer.html`, `styles.css` совпадают с `site\` посимвольно (разница только в переводе строк CRLF), опубликованный zip — тот же файл (`18B326D9…55DB3E`, 66 980 Б).
- Реквизиты на всех страницах реальные (СБП +7 923 493-26-88, ИНН, `goinslims@gmail.com`), заглушек `demo.ru` / `example.ru` / «ФИО, ИНН — заполнить» нет.
- `manifest.json` ссылается только на существующие файлы, локали `_locales\ru` на месте, синтаксис всех `extension\*.js` проходит `node --check`.

Архивы сайта в `dist\` были устаревшими (содержали `test@demo.ru` и «ФИО, ИНН — заполнить»). Пересобраны новым скриптом `tools\build-site-zips.ps1`:

- `dist\site-pages.zip` — `site\` без `api\` и README.md + `CNAME` = `sniper.gadget-nakhodki.ru` (для GitHub Pages);
- `dist\site-rucenter.zip` — весь `site\` без README.md (для `public_html` на Ru-Center).

Обе сборки проверены: каждая запись побайтово равна файлу в `site\`. `dist\rucenter-site.zip` — старый дубль с обратными слэшами и README, пользоваться им не нужно.

Особенности окружения и остатки:

- С этой машины `sniper.gadget-nakhodki.ru` не резолвится системным DNS (через `1.1.1.1` резолвится нормально), поэтому живой сайт проверялся так: `curl.exe -sI --resolve sniper.gadget-nakhodki.ru:443:185.199.108.153 https://sniper.gadget-nakhodki.ru/`.
- `site\img\sbp-qr.png` — QR-код СБП добавлен (см. раздел «QR-код СБП» ниже); `buy.html` подхватывает его сам через `qrImage.onload`, HTML править не нужно.
- Перед заливкой на платный хостинг: очистить `site\api\data\issued.log` (там тестовые выдачи `TEST-1`), задать `MS_ADMIN_SECRET` (без него пароль — заглушка `ЗАМЕНИТЕ_ЭТОТ_ПАРОЛЬ`), не выкладывать `site-rucenter.zip` публично — внутри `api\keys\private.pem`.
- Каталог Edge: регистрация в Partner Center заблокирована (reference `715-123225`), основной канал распространения — zip с сайта.


## QR-код СБП (страница оплаты)

Файл `site\img\sbp-qr.png` — 1024×1024 PNG, тихая зона 4 модуля, версия QR 5 (37 модулей), ECC level M. Оплата ведёт на номер СБП получателя; в QR зашита ссылка Сбера:

```
https://www.sberbank.ru/ru/choise_bank?requisiteNumber=79234932688&bankCode=100000000111
```

`buy.html` сам подставляет картинку вместо заглушки (`qrImage.onload`), поэтому HTML при замене QR править не нужно — достаточно положить новый файл с тем же именем и пересобрать архивы.

Как получен и как проверить/перегенерировать:

1. Исходник — скриншот QR из приложения банка (`Снимок экрана 2026-11-14 193119.png`, 398×351, QR занимает `x=56..307, y=50..301`).
2. Payload раскодирован библиотекой `jsqr`, картинка пересобрана заново библиотекой `qrcode` (не кроп скриншота — так модули ровные и тихая зона по стандарту).
3. Обратная проверка: `jsqr` читает готовый `sbp-qr.png` и возвращает тот же payload — значит, QR не «поплыл» при рендере.

Если понадобится перегенерировать с другим уровнем коррекции или размером, поставьте во временную папку `npm i jsqr pngjs qrcode` и повторите: декодировать исходник → `QRCode.toFile(path, payload, { errorCorrectionLevel: 'M', margin: 4, width: 1024 })` → снова декодировать результат.

Публикация:

- GitHub Pages: файл залит в `github.com/progerman666/market-sniper-site` (`img/sbp-qr.png`, commit `f5d17e8`), живой `https://sniper.gadget-nakhodki.ru/img/sbp-qr.png` отдаёт 200 и 7951 Б — совпадает с локальным файлом по SHA-256 (`3D90A16A…99BF50`).
- `dist\site-pages.zip` и `dist\site-rucenter.zip` пересобраны и содержат тот же `img/sbp-qr.png` (7951 Б).

## Метрика, SEO и Яндекс.Вебмастер (14.11.2026)

Сделано для роста кликов из поиска и измерения конверсий:

- `site/js/metrica.js` — счётчик Яндекс.Метрики `114252289` и цели: `download`, `buy`, `buy_month`, `buy_year`, `pay_online`, `mail_confirm`, `max_click`, `store_click`, `calc`, `faq_open`. Цели отправляются автоматически по кликам; кнопка «Рассчитать» размечена `data-goal="calc"` (второй вызов из `calc.js` убран — тест поймал двойную отправку).
- `site/js/calc.js` + `site/kalkulyator-pribyli.html` — новая SEO-страница «Калькулятор прибыли»: тарифы 32–53% (как в `extension/rates.js`), расчёт прибыли и маржи, таблица комиссий, FAQ, JSON-LD `WebApplication` + `FAQPage`.
- `site/index.html` — title/description под запросы «расчёт прибыли на Яндекс.Маркете», JSON-LD `SoftwareApplication` + `WebSite` + `FAQPage`, ссылки на калькулятор (меню, hero, тизер, футер), упоминание Метрики в ответе про данные.
- `site/buy.html`, `site/offer.html`, `site/privacy.html` — description, canonical, OG-теги, подключение Метрики; в политике раздел 3 переписан под Метрику (cookies, opt-out).
- `site/sitemap.xml`, `site/robots.txt` (`Sitemap:`), `site/404.html`, `theme-color`, абсолютный `og:image`.
- `tools/check-site.js` — проверка title/description/canonical/OG, H1, JSON-LD, Метрики, внутренних ссылок и sitemap. `_scrape/test/test-site-seo.js` — 15 проверок калькулятора и целей на jsdom. `_scrape/test/check-live.js` — проверка уже опубликованных страниц.
- `tools/build-site-zips.ps1` — в архивы теперь попадает папка `js\`.

Публикация (GitHub Pages, `progerman666/market-sniper-site`): коммиты `30fb82b`, `39a71c3`, `146d865`, `881859d`, `d832b09`, `53fddb5`. Проверено: `/`, `/kalkulyator-pribyli.html`, `/js/metrica.js`, `/js/calc.js`, `/sitemap.xml`, `/robots.txt`, `/404.html` отдают 200; JSON-LD парсится.

Осталось руками (нужен аккаунт Яндекса):

1. ~~Создать счётчик и вписать номер~~ — сделано 14.11.2026: счётчик `114252289`, `site/js/metrica.js` залит на Pages (коммит `8728423`), живой файл проверен.
2. Создать цели с идентификаторами из списка выше (тип «JavaScript-событие»).
3. Добавить сайт в Вебмастер, подтвердить права DNS TXT (Cloudflare) или meta-тегом, отправить `sitemap.xml`, задать регион и быстрые ссылки.

## Отказоустойчивость расширения (14.11.2026)

- `extension/content.js`: цепочка селекторов (`pick`), JSON-LD `Product` (цена/магазин/предложения), meta `product:price:amount`, запасной поиск магазина по `/business--`, число предложений из текста. В `collect()` добавлен блок `debug` (page, path, priceSource, sellerSource, offersSource, badge, version).
- Бейдж перенесён в Shadow DOM (`.ms-root`): стили страницы его не перебивают, восстановление после удаления сохранено.
- `extension/background.js`: забирает `https://sniper.gadget-nakhodki.ru/config/selectors.json` (кэш 12 ч в `chrome.storage.local`, при ошибке — последний рабочий конфиг) и отдаёт его content script по `GET_SELECTOR_CONFIG`.
- `extension/manifest.json`: в `host_permissions` добавлен домен сайта (нужен для запроса конфига).
- `extension/popup.html` / `popup.js`: поле «Цена вручную» с кнопкой «Считать» и диагностика при `no-price` (страница, версия, что делать).
- `site/config/selectors.json` — удалённый конфиг (задеплоен на Pages, коммит `dd519e8`).
- `tools/build-extension-zip.ps1` — пересборка пакета без `set-domain.ps1` (кладёт zip в `dist\` и копию в `site\download\`).
- Тесты: `test-content.js` (Shadow DOM + JSON-LD fallback), `test-popup.js` (ручной расчёт), `test-license.js`, `test-search.js` — все OK; `tools/check-site.js` проверяет `config/selectors.json`.

Пакет `dist\market-sniper-0.3.0.zip` пересобран (68,9 КБ) и побайтово совпадает с `extension\`. Осталось залить сам zip в GitHub Pages (`download/market-sniper-0.3.0.zip`) — это бинарный файл, через API он не заливался.

## Онлайн-оплата ЮKassa и автовыдача ключей (14.11.2026)

Раньше ключ выдавался вручную: клиент переводил по СБП, продавец запускал `tools/issue-key.js` и отправлял письмо.
Теперь есть полный автомат, ручной путь остался резервным (перевод по СБП, возвраты, повторная отправка).

**Что добавлено:**

- `site/api/pay.php` — создаёт платёж в ЮKassa (`POST /v3/payments`): Basic-авторизация shopId:secretKey,
  `Idempotence-Key`, чек с e-mail покупателя. Если у магазина не настроена фискализация, ЮKassa отклоняет
  чек — запрос автоматически повторяется без него (в журнал пишется `receipt_retry`). Возвращает
  `confirmation_url`; при POST обычной формы (не JSON) сразу редиректит 303.
- `site/api/webhook.php` — уведомление ЮKassa. Телу не доверяет: заново запрашивает платёж через API,
  проверяет `status=succeeded`, `paid`, валюту и сумму в копейках (подмена metadata/суммы не проходит).
  Выдаёт ключ через `ms_issue()`, пишет `api/data/payments/<id>.json`, отправляет письмо покупателю и копию
  администратору. Повторный webhook второй ключ не выдаёт (файл-захват + `mailSent`); на неизвестный платёж
  и отмену отвечает 200, чтобы ЮKassa не повторяла; на сеть/5xx — 502, тогда повтор будет.
- `site/api/helpers.php` — `ms_http_json` (cURL, fallback на поток), `ms_mail_send` (UTF-8, `transport=log`
  для тестов), `ms_payment_*` (идемпотентность), `ms_rate_limit` (10 платежей с IP в час), `ms_deliver_key`.
- `site/api/config.php` — блоки `yookassa` (shopId `4100119685733916`, secret из `MS_YOOKASSA_SECRET_KEY`,
  `return_url`, чек) и `mail` (`MS_MAIL_FROM`, `MS_MAIL_ADMIN`, `MS_MAIL_TRANSPORT`).
- `site/buy.html` — шаг 1 «Оплатить онлайн» (тариф + e-mail → `api/pay.php` → ЮKassa), шаг 2 — прежний перевод
  по СБП, если онлайн не подошёл; цель Метрики `pay_online`.
- `site/thanks.html` — страница возврата (noindex): что делать, если письмо не пришло, ссылка на архив.
- `tools/check-site.js` — страницы с `noindex` больше не требуют canonical/OG/JSON-LD и не обязаны попадать
  в sitemap (иначе `thanks.html` валил проверку).
- `tools/build-site-zips.ps1` — больше не кладёт в архив журналы и платежи из `api/data/` (кроме `.htaccess`).

**Проверено:** `node _scrape\test\test-yookassa.js` — 29 проверок (создание платежа, чек, Basic-авторизация,
webhook до/после оплаты, ключ принимается верификатором расширения, идемпотентность, `receipt_retry`,
подмена суммы, отмена, неизвестный платёж). Прежние `test-php-api.js`, `test-issue.js`, `test-license.js`,
`test-site-seo.js`, `tools/check-site.js` — OK.

**Осталось руками (нужен кабинет ЮKassa и PHP-хостинг):**

1. Выпустить secret key в ЮKassa и задать `MS_YOOKASSA_SECRET_KEY` на хостинге (не коммитить в файлы).
2. В ЮKassa → Интеграция → HTTP-уведомления: `https://<домен>/api/webhook.php`, события `payment.succeeded`
   и `payment.canceled`. Проверить кнопкой «Отправить тестовое уведомление» — должен прийти `200 OK`.
3. Залить `site/` (с папкой `api/`) на Ru-Center с PHP 8.0+; на GitHub Pages PHP нет — там кнопка онлайн-оплаты
   корректно откатывается на СБП.
4. Проверить письмо: `MS_MAIL_FROM` на своём домене + SPF/DKIM, иначе ключи уйдут в спам.
5. Прогнать тестовый платёж в тестовом магазине ЮKassa и убедиться, что ключ пришёл на почту.

## ЮMoney-кошелёк: почему «не находится API» и как теперь принимаем оплату (14.11.2026)

`4100119685733916` — номер **кошелька ЮMoney** (16 цифр, начинается на `41001`), а не shopId ЮKassa.
У кошелька нет API-ключей: `/v3/payments` — это отдельный продукт `yookassa.ru`
(кабинет → «Настройки» → «API-ключи», в части интерфейсов «Интеграция» → «Ключи API»; shopId вида `100500`).
Поэтому добавлен второй провайдер, которому ключи не нужны.

- `site/api/pay.php` — `provider=auto`: если задан `MS_YOOKASSA_SECRET_KEY` — ЮKassa, иначе (при
  `MS_YOOMONEY_SECRET`) — ЮMoney. Для ЮMoney создаётся метка `MS-<16 hex>`, заказ пишется в
  `api/data/payments/<метка>.json`, ссылка ведёт на `api/go.php?label=…`.
- `site/api/go.php` — форма `POST https://yoomoney.ru/quickpay/confirm` (receiver, quickpay-form=button,
  paymentType=AC, sum, label, successURL, targets) с автоотправкой. Сумма и метка берутся из записи
  заказа, а не из URL, поэтому подменить цену нельзя.
- `site/api/webhook.php` — определяет провайдера по телу запроса: форма с `notification_type` → ЮMoney,
  JSON с `event` → ЮKassa. Для ЮMoney проверяется `sign` = HMAC-SHA256 по отсортированным
  `key=rawurlencode(value)&…` (`sha1_hash` с мая 2026 больше не приходит), тип `p2p-incoming`/`card-incoming`,
  `codepro`/`unaccepted`, валюта 643 и сумма с учётом комиссии (порог `min_amount_ratio` = 0.95).
- Конфиг: `provider`, `yoomoney.receiver/secret/success_url/payment_type/min_amount_ratio`;
  `yookassa.shop_id` больше не подставляется по умолчанию — номер кошелька туда не подходит.
- Тест: `node _scrape\test\test-yoomoney.js` — 22 проверки (заказ, форма, подпись, ключ, повтор,
  заниженная сумма, codepro, неизвестная метка, 404 на устаревшую ссылку).

Осталось руками: в `yoomoney.ru` → Настройки → HTTP-уведомления указать `https://<домен>/api/webhook.php`,
придумать секрет → задать `MS_YOOMONEY_RECEIVER` и `MS_YOOMONEY_SECRET`. Чек НПД — вручную в «Мой налог».


## Рыночные данные и обратная задача цены — прототип (15.11.2026)

Разбор показал: текущий вывод расширения — арифметика на 3 действия (цена × (1 − ставка) − доставка),
которую продавец считает в уме. Плюс слово «чистая прибыль» без себестоимости подрывает доверие.
Проверено, что со страницы «Все предложения» можно брать цены конкурентов — это данные, которых
у продавца нет, и они оправдывают подписку (калькулятор — разовая покупка, рыночные данные — нет).

**Что добавлено (прототип, в продукт ещё не включено):**

- `_scrape/offers-stats.js` — `parseOfferPrices(doc)` + `marketStats(prices, currentPrice)` без зависимостей
  (переносятся в `content.js` как есть, там есть `DOMParser`). CLI считает сводку по сохранённой странице.
- `_scrape/test/test-offers.js` — 16 проверок на фикстуре `_scrape/offers.html`.
- `extension/rates.js` — общие функции (используются и `content.js`, и `popup.js`):
  `msNetProfit(price, settings)` (с себестоимостью), `msBreakEvenPrice(settings)`,
  `msTargetMarginPrice(settings, marginPercent)`, `msMarketStats(prices, currentPrice)`.
- `_scrape/test/test-rates.js` — 20 проверок (точка безубыточности, маржа, невозможные комбинации, квартили).
- `_scrape/make-badge.js` — рендер демо-бейджа через `sharp` (без браузера), числа считаются теми же
  функциями, что в расширении, поэтому картинка не расходится с продуктом.

**Результат на реальной странице** (`node _scrape\offers-stats.js`): 16 предложений из 74,
минимум 46 844 ₽, медиана 77 810 ₽, максимум 94 471 ₽, квартили 75 041–80 299 ₽.
Цена 46 844 ₽ — позиция 1 из 16, ниже медианы на 39,8%, потенциал +30 966 ₽ к цене → **+17 960 ₽ к прибыли с продажи**.

**Обратная задача** при ставке 42%, доставке 192 ₽ и закупке 25 000 ₽: без убытка — от 43 434 ₽,
для маржи 20% — 66 295 ₽ (проверено: на этой цене маржа ровно 20%).

**Лендинг:** `site/img/badge.png` перерисован (1560×800) — вместо комиссии 10% и маржи 89,8%
теперь реальные 42%, прибыль 1 978 ₽, «маржа 4,2% — риск», медиана рынка и минимальная цена.
Прежний файл сохранён в `_scrape/badge-old.png`. Источник — `_scrape/make-badge.js`.

**Тесты:** `test-offers.js` и `test-rates.js` — ITOG: OK; `test-content.js`, `test-popup.js`,
`test-search.js` после правки `rates.js` — ITOG: OK.

**Ограничения, которые надо учесть при переносе в продукт:**

- на странице предложений отрендерено 16 карточек из 74 (остальные подгружаются) — считать по тем, что пришли,
  и честно писать «по N предложениям»;
- карточки в списке ведут на разные productId (варианты/аналоги), поэтому медиана — рыночный ориентир,
  а не «цены 74 конкурентов на этот SKU»;
- продавца в разметке списка нет (`business--` в фикстуре 0 совпадений) — только цены;
- нужен кэш в `chrome.storage.local` по productId с TTL, иначе запрос на каждую перерисовку страницы.


## Рыночные данные в бейдже — перенос в продукт (15.11.2026)

Прототип (раздел выше) перенесён в расширение. Теперь бейдж показывает не только арифметику,
но и данные, которых у продавца нет: сколько стоит рынок и сколько он теряет на своей цене.

**`extension/content.js`:**

- `parseOfferPrices(doc)` — цены со страницы «Все предложения» (на фикстуре 16 карточек из 74).
  Контейнер предложения ищется вверх по дереву до ссылки `data-auto="snippet-link"`.
- Кэш `ms-market-cache` в `chrome.storage.local` по `productId`: TTL 6 часов, до 30 товаров,
  при неудаче запроса — пауза 10 минут (`marketFail`), чтобы не дёргать страницу на каждой перерисовке.
- `fetch(offersUrl, { credentials: 'same-origin' })` — адрес берётся из `data-zone-data` (поле `offersUrl`).
  Если цен меньше трёх, данные не принимаются: остаётся базовый расчёт.
- Бейдж: строка «Вы N-е из M по цене · медиана рынка X ₽» и «При цене медианы: +Y ₽ к прибыли с продажи».
  В режиме `expired` вместо потенциала — «Сколько вы теряете на этой цене — в полной версии».
- Красный флаг «Маржа X% — риск: скидка или возврат съедят прибыль» при марже от 0 до 10%.
- `calcProfit` теперь вызывает `msNetProfit` — себестоимость учитывается во всех расчётах.
- В ответ `COLLECT` добавлены `cost`, `breakEven`, `targetPrice` (маржа 20%), `market`, `settings.cost`.

**`extension/rates.js`:** `MS_DEFAULTS.cost = 0` (себестоимость, 0 — не задана), плюс общие
`msNetProfit`, `msBreakEvenPrice`, `msTargetMarginPrice`, `msMarketStats`.

**Тесты:** `_scrape/test/test-content.js` — добавлено 14 проверок: рынок подтянулся, медиана 77 810 ₽,
позиция 1 из 16, потенциал +15 019 ₽ (при ставке 51,5%), кэш по `productId`, повторный запрос не ходит
в сеть, себестоимость 24 000 ₽ даёт прибыль 3 070 ₽ и маржу 6,6% с красным флагом, точка безубыточности
41 552 ₽, цена для маржи 20% — 63 421 ₽, в `expired` рынок виден, а потенциал скрыт.

Прогон: `test-content`, `test-popup`, `test-search`, `test-rates`, `test-offers`, `test-license`,
`test-issue`, `test-php-api` — **ITOG: OK**.

**Ограничения (важно для текстов в интерфейсе):** медиана считается по отрендеренным карточкам
(16 из 74), и это ориентир по похожим предложениям, а не «цены всех продавцов этого SKU» —
в списке встречаются разные `productId`. Продавца в разметке списка нет.

**Осталось:** поле «Себестоимость, ₽» в попапе (пока `cost` задаётся только через storage),
поднять версию до 0.4.0 и пересобрать `dist/`, физический прогон в Edge.


## Версия 0.4.0: себестоимость, обратная задача цены, переименование (15.11.2026)

**Попап (`extension/popup.html`, `popup.js`):**

- новое поле «Себестоимость, ₽» (`id="cost"`), сохраняется в `ms-settings` вместе с остальными
  ставками; пустое поле = 0 = «не задана» (честнее, чем молчаливый ноль);
- в режиме `expired` поле блокируется вместе с остальными настройками (ставки всё равно базовые);
- таблица расчёта: строка «Прибыль с продажи» вместо «Чистая прибыль», добавлены
  «Себестоимость», «Без убытка» (`от N ₽`), «Для маржи 20%», «Медиана рынка» (N предложений),
  «Ваша цена на рынке» (N-я из M);
- ручной расчёт тоже считается через `msNetProfit`, то есть учитывает закупку;
- `CONTROL_IDS` пополнен `cost` — блокировка/разблокировка по доступу работает единообразно.

**Переименование.** «Чистая прибыль» → «Прибыль с продажи» во всём продукте: бейдж, попап,
`site/index.html` (title, description, og, JSON-LD, h1, alt, тексты карточек), `site/kalkulyator-pribyli.html`
(meta, JSON-LD, h2, лид), `store/edge-listing.md`. Причина: без налогов и с необязательной
себестоимостью термин был неточным, а селлер это замечает первым. Осталось только в озвучке
промо-ролика (`tools/voiceover-aitunnel.js`, фраза «Чистая прибыль — прямо на карточке») —
менять только вместе с перерендером видео.

**Версия 0.4.0 и сборка:**

- `extension/manifest.json` → `0.4.0`;
- `tools/build-extension-zip.ps1` больше не хранит версию в параметре по умолчанию, а читает её
  из `manifest.json` (раньше имя архива легко расходилось с манифестом);
- собран `dist\market-sniper-0.4.0.zip` (72,6 КБ) + копия в `site\download\`; в архиве 10 файлов,
  версия внутри — 0.4.0;
- ссылки на архив обновлены: `site/index.html` (5 вхождений), `site/kalkulyator-pribyli.html` (2),
  `site/404.html` (1), `site/thanks.html` (1), `store/edge-listing.md` (2), `site/README.md` (3).

**Листинг для ревью:** в «Обоснование разрешений» добавлен пункт про запрос `/offers/...` —
страница предложений того же товара на `market.yandex.ru`, результат кэшируется на 6 часов,
данные никуда не передаются. Без этого пункта ревьюер спрашивает про лишний запрос.

**Демо-бейдж:** `site/img/badge.png` перерисован с новой подписью (источник — `_scrape/make-badge.js`).

**Проверено:** `test-popup.js` (+6 проверок: строки таблицы, себестоимость 24 000 ₽ → прибыль 2 078 ₽,
без убытка 43 262 ₽, цена под маржу 20% — 66 032 ₽, сохранение `cost`), `test-content.js` (подпись бейджа),
весь набор из 8 файлов — **ITOG: OK**. `tools/check-site.js` — 0 ошибок, 3 предупреждения
(`privacy.html` без JSON-LD и т. п., были и раньше). Упоминаний «чистая прибыль» в `extension/`,
`site/`, `store/` не осталось.

**Осталось:** физический прогон в Edge, заливка `site/` на Ru-Center и `dist\market-sniper-0.4.0.zip`
в GitHub Pages, перерендер промо-ролика под новую формулировку.


## Актуальные скриншоты лендинга и листингов (15.11.2026)

**Проблема:** на лендинге оставались скриншоты старой версии — попап без себестоимости и без рыночных
строк, а в магазине первый кадр был собран из кропа, где комиссия Маркета 10% и маржа 89,8%.

**Что сделано:**

- `_scrape/make-popup-shot.js` — новый генератор скриншота попапа. Поднимает headless Edge
  с `--load-extension=extension\`, открывает `chrome-extension://<id>/popup.html`, подставляет
  данные через `fillForm()` / `renderTable()` и снимает PNG через CDP. Данные те же, что в демо-бейдже
  (ставка 42%, закупка 25 000 ₽, медиана рынка 77 810 ₽).
- `site/img/popup.png` заменён настоящим скриншотом нового попапа (760×1876, 2×).
- `_scrape/make-store-shots.js`:
  - первый кадр магазина теперь из `_scrape/shot-badge-real.png` (демо-бейдж), а не из старого кропа;
  - второй кадр обрезается до таблицы расчёта (`shot-popup-top.png`, верхние 975 px) и получает
    явную позицию `topOverride` — иначе высокий попап наезжал на подпись;
  - третий кадр пересобран из свежего `_scrape/site-index.png`.
- `_scrape/site-index.png` переснят headless Edge (`--screenshot --window-size=1440,1000`) с текущего
  `site/index.html` — в кадре уже «Прибыль с продажи» и новый бейдж.
- `store/screenshots/shot1-badge.png` (1053×540), `shot2-popup.png` (488×620), `shot3-trial.png` (1080×570)
  пересобраны.
- `dist\site-pages.zip` (508 КБ) и `dist\site-rucenter.zip` (530,9 КБ) пересобраны — в них новые картинки,
  новый текст и ссылки на `market-sniper-0.4.0.zip`.

**Ловушка, на которую потратил время:** в headless Edge цель CDP для расширения не появляется —
service worker ленивый, а брать первый `chrome-extension://` из `/json/list` нельзя, там встроенные
расширения Edge. Id распакованного расширения считается сам:
SHA-256 от **байтов пути в UTF-16LE**, первые 16 байт, каждый полубайт → буква `a`..`p`.
В скрипте перебираются варианты пути (как есть, с прямыми слэшами, со строчной буквой диска,
UTF-16LE и UTF-8) и берётся тот, по которому `popup.html` реально открывается.

**Если в браузере всё ещё «Чистая прибыль»:** расширение не перезагружено. `edge://extensions` →
карточка «Маркет-Снайпер» → «Обновить» (⟳), затем F5 на странице товара. Бейдж с рыночной медианой
без перезагрузки не появился бы вообще, поэтому такой скриншот = сборка между двумя правками.

## Версия 0.4.1: реалистичная ставка по умолчанию (15.11.2026)

**Проблема:** в `MS_DEFAULTS.commission` стояло `0.10`, и новый пользователь видел прибыль,
завышенную на треть цены. Он сравнивал её со своей реальной выплатой и решал, что инструмент врёт.
Именно из-за этого бейдж выглядел «бесполезным»: цифра не сходилась с реальностью.

**Что изменено:**

- `extension/rates.js` — `MS_DEFAULTS.commission = 0.42` (официальный тариф Маркета для категории
  «Все товары»). Теперь первый расчёт сразу правдоподобный.
- `extension/content.js`:
  - при первом запуске бейдж один раз показывает пояснение: «Ставка 42% — средняя по Маркету.
    Свою категорию можно выбрать в окне расширения». Флаг живёт в `chrome.storage.local` → `ms-hints`,
    повторно подсказка не появляется;
  - если ставка меньше 32% (кто-то выставил 10%), бейдж предупреждает жёлтым:
    «Тариф 10% ниже тарифа Маркета (32–53%) — прибыль завышена, проверьте ставку»;
  - в режиме `expired` обе подсказки не показываются — там уже есть промо полной версии.
- `extension/popup.js` — статус окончания триала: «Маркет 42% и доставка 100 ₽».
- `extension/_locales/ru/messages.json` — описание расширения: «Прибыль с продажи прямо на карточке
  товара: комиссия, доставка, реклама и закупка». Убрано последнее «чистая прибыль» и упоминание
  чужой торговой марки в описании (для ревью каталога).
- `site/index.html` — FAQ про окончание триала: «базовый расчёт по ставке 42% и доставке 100 ₽».

**Тесты:** `test-content.js` — добавлены две проверки (подсказка при первом запуске, предупреждение
о заниженной ставке), ожидания пересчитаны на 42% (прибыль 27 070 ₽ вместо 42 060);
`test-popup.js` — дефолт 42%, «Маркет забирает 42% — 19 674 ₽». Все восемь наборов — **ITOG: OK**.

**Выпуск:** `manifest.json` → 0.4.1, `dist\market-sniper-0.4.1.zip` (74 945 Б), копия в `site\download\`,
ссылки обновлены в шести файлах (0.4.0 → 0.4.1), `dist\site-pages.zip` и `dist\site-rucenter.zip`
пересобраны, задеплоено в GitHub Pages коммитом `1c2e094`.

**Проверено на живом сайте:** `download/market-sniper-0.4.1.zip` → 200, 74 945 Б; в главной ссылки
на 0.4.1, ссылок на 0.4.0 нет; FAQ отвечает «ставке 42%». Архив распакован и сверен: `manifest.json`
0.4.1, `rates.js` и `content.js` побайтово равны локальным.

**Осталось:** деплой на Ru-Center (нужны FTP-доступы) — без него онлайн-оплата не работает;
заявка в Chrome Web Store.



## Проверка сайта и платежей, секрет ЮKassa убран из репозитория (15.11.2026)

- Сайт поднимается локально: `cd site; $env:MS_ADMIN_SECRET='test-secret'; php -S 127.0.0.1:8111 -t .`
  (для проверки без реальных денег — `MS_PROVIDER=yoomoney`, `MS_YOOMONEY_SECRET=…`, `MS_MAIL_TRANSPORT=log`,
  `MS_DATA_DIR=<временный каталог>`).
- Проверен полный путь оплаты на поднятом сайте: `pay.php` → заказ `MS-…`, `go.php` с суммой из записи заказа,
  `webhook.php` с подписью → ключ `MS1.…`, письмо в `mail.log`, `check.php` → `valid:true`, повтор уведомления
  не выдаёт второй ключ, поддельная подпись → 403. ЮKassa — на моке (`node _scrape\test\test-yookassa.js`,
  29 проверок), ЮMoney — `node _scrape\test\test-yoomoney.js` (22 проверки), `test-php-api.js` — OK.
- `site/api/config.php`: боевой `live_…` секрет ЮKassa лежал в файле открытым текстом и попал в
  `dist\site-rucenter.zip`. Убрано: `secret_key` берётся только из `MS_YOOKASSA_SECRET_KEY`; без переменной
  `pay.php` отвечает 503 («Онлайн-оплата пока не подключена — оплатите по СБП»). Архивы `dist\site-*.zip`
  пересобраны (`tools\build-site-zips.ps1`), ключей в них нет.
- **Руками:** перевыпустить ключ ЮKassa в кабинете (старый считать скомпрометированным) и задать
  `MS_YOOKASSA_SECRET_KEY` в окружении хостинга, не в файлах.
- Прод: сайт **работает** на GitHub Pages (`progerman666.github.io`, кастомный домен `sniper.gadget-nakhodki.ru`).
  Напрямую с origin (185.199.110.153) все страницы отдают 200: `/`, `/buy.html`, `/thanks.html`,
  `/kalkulyator-pribyli.html`, `/privacy.html`, `/offer.html`, `/download/market-sniper-0.4.1.zip`,
  `/config/selectors.json`; `index.html` и `buy.html` по строкам совпадают с `site/` (версия 0.4.1).
- Проблема в DNS/Cloudflare: для `sniper` включено проксирование, но origin за прокси — заглушка хостинга
  «Не опубликован» (openresty, 91.189.114.23 = wcarp.hosting.nic.ru): по HTTP `/` отдаёт её, `/buy.html` — 404,
  по HTTPS — **525** (Cloudflare не устанавливает TLS с origin). Резолвер 1.1.1.1 ещё отдаёт старый CNAME
  на `progerman666.github.io`, поэтому у части клиентов сайт открывается.
- **Как починить (Cloudflare → DNS → sniper):** удалить `A 91.189.114.23`, добавить
  `CNAME sniper → progerman666.github.io`, Proxy status — **DNS only** (серое облако), TTL Auto.
  GitHub Pages уже настроен: репозиторий `progerman666/market-sniper-site`, в нём лежит `CNAME`
  с `sniper.gadget-nakhodki.ru`, сертификат для домена выпущен (HTTPS с origin отдаёт 200).
  `/CNAME` на сайте отдаёт 404 — это нормально, GitHub не публикует этот файл как статику.

- Онлайн-оплата на Pages невозможна: PHP там нет, `/api/plans.php` и `/api/pay.php` → 404, `buy.html`
  показывает ошибку и предлагает СБП. ЮKassa/ЮMoney работают только на PHP-хостинге (проверено локально).



## Оплата через Cloudflare Worker, сайт остаётся на GitHub Pages (15.11.2026)

- Платёжный путь перенесён в Worker `server/`: `POST /api/pay` (создание платежа ЮKassa с чеком и
  `Idempotence-Key`), `POST /api/webhook` (перепроверка платежа через API, сверка суммы в копейках,
  выдача ключа `MS1.…`, письмо), `GET /api/pay/status?id=…` (ключ для страницы «Спасибо»).
- Worker `market-sniper-license` задеплоен: KV `LICENSES` (`9e05744003014f6c8f25b44780a14468`),
  адрес `https://market-sniper-license.goinslims.workers.dev`, он прописан в `site/js/api.js`.
- `site/buy.html` создаёт платёж через Worker и запоминает номер в `localStorage`;
  `site/thanks.html` опрашивает `/api/pay/status` и показывает ключ (письмом он тоже уходит).
- Секрет `PRIVATE_KEY_B64` задан. `YOOKASSA_SECRET_KEY` и `RESEND_API_KEY` — руками:
  `npx wrangler secret put …`. Без ключа ЮKassa `pay` отвечает 503; без Resend оплата не ломается —
  ключ показывается на `thanks.html`.
- Свой домен `api.sniper.gadget-nakhodki.ru` не подошёл: бесплатный Universal SSL покрывает только
  `*.gadget-nakhodki.ru`, а это второй уровень поддомена — нужен платный сертификат.
- Проверено: `node _scrape\test\test-worker-pay.js` — 33 проверки, `ITOG: OK`;
  живой Worker: `/api/health` → `hasKv:true, hasKey:true, hasYooKassa:false`, `/api/plans` → 200,
  `/api/pay` без секрета → 503. `check-site.js` — 0 ошибок, `test-site-seo.js` — 15/15.
- Сайт обновлён в `progerman666/market-sniper-site` коммитом `19bb051`; на Pages `js/api.js` и
  новый `buy.html` отдаются (200). `dist/site-pages.zip` и `dist/site-rucenter.zip` пересобраны.
- Осталось руками: перевыпустить ключ ЮKassa и задать `YOOKASSA_SECRET_KEY`; при желании
  `RESEND_API_KEY`; прописать webhook `https://market-sniper-license.goinslims.workers.dev/api/webhook`
  в кабинете ЮKassa (`payment.succeeded`, `payment.canceled`); исправить DNS `sniper` в Cloudflare
  (CNAME `progerman666.github.io`, DNS only), иначе сайт у части посетителей отдаёт заглушку/525.


## SEO-аудит и доработки (15.11.2026)

**Сделано:**

- Новая страница `site/about.html` («О проекте»): кто делает, реквизиты самозанятого, контакты,
  оплата и возврат. Даёт E-E-A-T и точку доверия; добавлена в `sitemap.xml` и в футер главной.
- Главная: OG-размеры картинки (`og:image:width/height/alt`), `twitter:title/description/image`,
  `apple-touch-icon`, `preconnect` к `mc.yandex.ru`, `color-scheme`; в JSON-LD добавлены
  `Organization` (логотип, e-mail, ИНН, контакт), `softwareVersion`, `screenshot`,
  `priceValidUntil`, `availability`.
- Калькулятор и оплата: OG/Twitter/иконки/preconnect, `BreadcrumbList`; на `buy.html` — `WebPage`,
  `BreadcrumbList` и `Service` с двумя `Offer` (199 / 1990 ₽).
- `offer.html` и `privacy.html`: `WebPage` + `BreadcrumbList` (убраны предупреждения check-site).
- Картинки: `width/height` у всех `<img>` (нет скачков вёрстки), `fetchpriority="high"` у первого
  экрана, `loading="lazy"` у окна расширения.
- `robots.txt`: `Disallow: /thanks.html`, `Clean-param` для UTM/`yclid`.
- `sitemap.xml`: `lastmod` 2026-11-15, добавлен `about.html` (6 URL).
- **IndexNow**: ключ `site/b7f3c9e2a41d58c6f0e9a2b7d4c1e8f3.txt` + `tools/indexnow.js`
  (`node tools\indexnow.js` отправляет все URL из sitemap в Яндекс и api.indexnow.org).
- Проверено: `tools/check-site.js` — 0 ошибок, 0 предупреждений; `test-site-seo.js` — 15/15;
  на живом сайте `about.html` 200, ключ IndexNow 200, разметка на месте. Отправка IndexNow — `202`.
  Опубликовано коммитом `2af7e6a`; `dist/site-*.zip` пересобраны.

**Доступы, которые нужны (руками):**

| Что | Зачем | Где |
|---|---|---|
| Яндекс.Вебмастер | sitemap, переобход, быстрые ссылки, регион, диагностика | подтверждение уже стоит (`meta yandex-verification` + TXT) |
| Яндекс.Метрика (счётчик `114252289`) | проверить/создать цели: `download`, `buy`, `buy_month`, `buy_year`, `pay_online`, `mail_confirm`, `max_click`, `store_click`, `calc`, `faq_open`; связать с Вебмастером | metrika.yandex.ru |
| Google Search Console | индексация и запросы в Google | нужен `google-site-verification` (meta или DNS TXT) |
| Cloudflare (API-токен `Zone.DNS:Edit` + `Zone:Read`) | TXT для Google, запись `www`, кэш/правила, HSTS | dash.cloudflare.com → My Profile → API Tokens |
| PageSpeed Insights API key | регулярные замеры Core Web Vitals (без ключа квота 429) | console.cloud.google.com |
| Ru-Center | поддомен `www`, почта домена | панель хостинга |

**Осталось технически:** `www.sniper.gadget-nakhodki.ru` не резолвится (нет записи) — добавить
CNAME на `progerman666.github.io` (DNS only), иначе часть пользователей не попадёт на сайт.
Проксирование Cloudflare периодически даёт `525` — надёжнее держать `sniper` в режиме DNS only.


## DNS исправлен, сайт стабилен (15.11.2026)

- В Cloudflare запись `sniper` переведена на `CNAME → progerman666.github.io`, **Proxy status: DNS only**.
  Авторитетный ответ (DoH): CNAME + `185.199.108–111.153`. 8 из 8 запросов к `https://sniper.gadget-nakhodki.ru/`
  отдают `200`, ошибок `525` больше нет.
- Проверены страницы: `/` 200, `/about.html` 200, `/buy.html` 200, `/thanks.html` 200, `/robots.txt` 200,
  `/sitemap.xml` 200, ключ IndexNow `b7f3c9e2…txt` 200. Worker `api/plans` 200.
- Удалён лишний поддомен `api.sniper.gadget-nakhodki.ru` (Workers custom domain `6b7add52…`): он требовал
  платного сертификата (Universal SSL не покрывает второй уровень) и отдавал handshake failure.
  Сейчас `api.sniper` → NXDOMAIN, в `workers/domains` остался только `pc-diag.ru`.
- API оплаты живёт на `https://market-sniper-license.goinslims.workers.dev` (см. `site/js/api.js`),
  `hasYooKassa: true`, тестовый платёж создавался успешно.
- Осталось руками: добавить `www.sniper` → CNAME `progerman666.github.io` (DNS only), иначе `www` не резолвится;
  доступы в Вебмастер/Метрику/Search Console/PageSpeed — см. таблицу в разделе про SEO.


## Фикс вёрстки: скриншоты не растягиваются (15.11.2026)

- Причина: при добавлении `width`/`height` в атрибуты `<img>` (для CLS) в CSS не было `height: auto`.
  Браузер брал высоту из атрибута, и картинки (`badge.png` 1560×800, `popup.png` 768×2144) искажались.
- Исправлено в `site/styles.css`: `.hero-shot img { width: 100%; height: auto; }` и глобальное
  `img { max-width: 100%; height: auto; }` (логотип и QR-код не затронуты — у них своя специфичность).
  Опубликовано коммитом `32d92cf`.
- Проверено в headless Edge с эмуляцией мобильного viewport (390×844, CDP):
  `/`, `/buy.html`, `/kalkulyator-pribyli.html`, `/about.html` → `scrollWidth = clientWidth = 390`,
  элементов, выходящих за экран, нет. Десктопный и мобильный скриншоты — пропорции корректные.
- Если у пользователя старая картинка — это кэш: GitHub Pages отдаёт `Cache-Control: max-age=600`,
  помогает жёсткая перезагрузка (Ctrl+F5).


## Реклама в VK Рекламе: API, креативы и скрипт запуска (15.11.2026)

**Задача:** запустить платный трафик на `https://sniper.gadget-nakhodki.ru/` из кабинета
`ads.vk.ru/hq/dashboard/ad_plans`.

**Что выяснено про API (по https://ads.vk.ru/doc/api):**

- база `https://ads.vk.ru/api/v2/`, авторизация `Authorization: Bearer <access_token>`, OAuth2;
- токен выдаётся в кабинете «Настройки → Доступ к API» (`client_id` + `client_secret`), обмен на
  токен — `POST /api/v2/oauth2/token.json` с `grant_type=client_credentials`;
- ошибки токена: `auth_required` — токена нет; `invalid_token` — «Unknown access token» (VK удаляет
  токен, если его не обновляли месяц); `expired_token` — истёк, нужен `refresh_token`;
- ресурсы: `POST /urls.json` (ссылка → `id`), `POST /content/static.json` (multipart: `file` +
  `data={"width":…,"height":…}` → `id`), `POST /ad_plans.json` (кампания), `POST /ad_groups.json`
  (группа вместе с массивом `banners`), `GET /packages.json` (форматы и `package_id`),
  `GET /throttling.json` (лимиты);
- таргетинг по возрасту — перечисление конкретных возрастов в `targetings.age.age_list`, не диапазон.

**Что сделано:**

- `tools/make-vk-ads-creatives.ps1` — рисует два креатива из `site/img/badge.png` в цветах сайта
  (`#0b1f3a` / `#f5c451`): `promo/vk-ads/creative-1080x607.png` (две колонки: текст слева, скриншот
  справа) и `promo/vk-ads/creative-1080x1080.png` (текст сверху, скриншот снизу). Все .ps1 в
  проекте — UTF-8 **с BOM**, иначе PowerShell 5.1 ломает кириллицу (ловушка №5).
- `tools/vk-ads-campaign.json` — конфиг без секретов: названия, бюджеты (500 ₽/день и 10 000 ₽ всего),
  UTM-ссылка на лендинг, таргетинг 25–55 лет, три объявления (заголовок + текст).
- `tools/vk-ads-create.js` — команды `check | token | packages | preview | create`. Токен берётся из
  `VK_ADS_TOKEN`, `~/.vk-ads-token` или `--token` и в репозиторий не пишется. `create` по умолчанию
  создаёт кампанию в статусе `blocked` (черновик, списаний нет) и печатает id объектов.

**Проверено:** `node --check` и сквозной прогон `create` на локальном mock-сервере, повторяющем
контракт API (`VK_ADS_API=http://127.0.0.1:8787`): url_id → content_id (multipart, 64 КБ PNG) →
ad_plan_id → ad_group + 3 баннера, `exit=0`. Оба креатива просмотрены глазами — текст не обрезан.

**Блокер:** присланный access_token живой API не принимает — `401 invalid_token`
(«Unknown access token»; проверено и на `ads.vk.ru/api/v2`, и на `target.my.com/api/v2`, и с
заголовком `Bearer`, и без него — без заголовка ответ другой, `auth_required`). Нужен новый токен:
кабинет → Настройки → Доступ к API, либо
`node tools\vk-ads-create.js token --client-id … --client-secret … --save`.

**Осталось руками:** выбрать `package_id` под формат (`packages`), создать кампанию, дождаться
модерации объявлений и перевести статус в `active`; до включения показов проверить цели Метрики
`download` / `buy` — иначе оптимизация пойдёт «в пустоту».


## Получение токена VK Рекламы (15.11.2026)

- `tools/vk-ads-token.ps1` — обмен `client_id` + `client_secret` на `access_token`
  (`POST /api/v2/oauth2/token.json`, `grant_type=client_credentials`). Секрет вводится скрыто
  (`Read-Host -AsSecureString`) и никуда не пишется; токен сохраняется в `%USERPROFILE%\.vk-ads-token`
  (вне репозитория) с ACL только для текущего пользователя. Параметры: `-ClientId`, `-ClientSecret`,
  `-TokenFile`, `-TokenUrl`, `-NoSave`.
- Скрипт написан под PowerShell 5.1: без тернарного оператора и `?.` — иначе он не парсится
  (родственная ловушка №5 про BOM и кириллицу).
- Доступ к API у кабинета «маркет-снайпер» уже одобрен: в «Настройки → Общие → Доступ к API» видны
  ответственное лицо и `client_id`. Кнопка выдачи `client_secret` — там же; секрет показывается
  один раз и только 10 минут, при потере — писать на `ads_api@vk.team`.
- Проверено: неверные креды → `HTTP 401 (invalid_client)` + подсказка, `exit=1` (живой VK);
  на mock-сервере успешный путь → файл токена создан, а `node tools\vk-ads-create.js check`
  с этим токеном отвечает «Токен работает. Кампаний в кабинете: 7».


## Статья для Дзена (15.11.2026)

**Почему не «опубликовано»:** публичного API для записи в Дзен нет — публикация только через
Дзен-студию (руками) либо через «Дзен для медиа» (размеченная RSS-лента с сайта). Поэтому в
`promo/dzen/` лежит готовый к вставке материал, а не скрипт публикации.

**Что сделано:**

- `promo/dzen/article-01-pribyl-na-kartochke.md` — статья «Цена 46 844 ₽, а прибыль 1 978 ₽: как
  считать заработок на Маркете без таблиц»: метаданные (заголовок 95 символов, подзаголовок, теги,
  обложка), текст 5 420 знаков, точки вставки двух иллюстраций, UTM-ссылки и чек-лист публикации.
- `tools/dzen-article.js` — markdown → HTML для копирования в Дзен-студию (студия не понимает
  markdown: `##` и `**` вставляются мусором). Понимает заголовки, `ul`/`ol` с продолжениями строк,
  жирный, `code`, ссылки, `---` и метки `[ИЛЛЮСТРАЦИЯ N] \`путь\` — подпись: «…»`. Тело статьи
  берётся между первым и последним `---`, поэтому метаданные и чек-лист в HTML не попадают.
- `promo/dzen/article-01-pribyl-na-kartochke.html` — результат сборки.
- `promo/dzen/README.md` — порядок публикации в студии и правила, чтобы не попасть под ограничения.

**Цифры проверены расчётом** (`46 844 − 42% − 192 − 25 000`): прибыль 1 978 ₽, маржа 4,2%,
без убытка 43 434 ₽, для маржи 20% — 66 295 ₽. Это ровно то, что показывает демо-бейдж
`site/img/badge.png`, поэтому статья и скриншот не расходятся.

**Проверено:** `node --check` и прогон `node tools\dzen-article.js` → 8 подзаголовков, 2 иллюстрации,
2 ссылки, 11 абзацев, 4 961 знак без разметки. HTML отрендерен в headless Edge (`--screenshot`):
заголовки, списки, жирный и картинка с боевого сайта на месте, служебных блоков (метаданные,
чек-лист) в HTML нет.

**Осталось руками:** вставить текст в Дзен-студию (заголовок, подзаголовок, теги и обложку взять
из шапки `.md`), загрузить две картинки кнопкой «Изображение», опубликовать. Платное продвижение
статьи включать только после публикации; минимальный бюджет кампании в Дзене — 10 000 ₽.


## Скриншоты нормальной формы на главной (15.11.2026)

**Что было:** на `site/index.html` стоял полный скриншот попапа 768×2144 (пропорция 1:2.8) —
при ширине 380 px он превращался в узкую «простыню» высотой ~1070 px и выглядел вытянутым.
Вёрстка при этом была в порядке: `img { max-width: 100%; height: auto }` уже стоит, и замер через
CDP давал `ratioShown 0.36` против `ratioNatural 0.358`, то есть искажения пропорций не было.
Проблема была в самом скриншоте, а не в CSS.

**Что сделано:**

- `_scrape/make-popup-shot.js`: добавлен параметр `--clip-height N` — снимает только верхние N
  CSS-пикселей попапа через `Page.captureScreenshot.clip`. Внутри `width: 384`, `scale: 1`,
  потому что масштаб уже задан в `Emulation.setDeviceMetricsOverride` (`clip.scale` умножается
  на `deviceScaleFactor` — на этом сначала получилось 1520×2048 вместо 768×1024). В этом режиме
  ещё и прячется полоса прокрутки, чтобы не попадала в кадр.
- `site/img/popup.png` перегенерирован: **768×1024** (3:4), обрезка по границе строки
  «Ваша цена на рынке». Полная версия сохранена как `site/img/popup-full.png` (768×2144).
- `site/index.html`: у картинки `width="768" height="1024"`, под ней ссылка
  «Открыть окно расширения целиком» на `img/popup-full.png`.
- Опубликовано в Pages-репозиторий `progerman666/market-sniper-site` коммитом `c713cb3`.

**Проверено:** `node tools/check-site.js` — 0 ошибок, 0 предупреждений. CDP-замер уже на живом
сайте (390 px, mobile): `scrollWidth = 390`, элементов за экраном нет, `popup.png` natural
768×1024 → shown 350×466, `ratioShown 0.751` против `ratioNatural 0.75` (высота была 974 → стала
466). Живые файлы: `img/popup.png` 768×1024 (93 138 Б), `img/popup-full.png` 768×2144. Скриншоты
страницы 1280 и 390 просмотрены глазами — обрезки текста и «простыни» нет.

**Ловушка окружения:** Edge-скриншоты молча не записывались из-за `ENOSPC` — на диске `C:` не было
свободного места (профили headless-Edge в `%TEMP%` накопили ~244 МБ). Если снимок «не создаётся»,
первым делом проверять `Get-PSDrive C`, а не синтаксис `--screenshot`.


## VK Реклама: кампания опубликована (15.11.2026)

**Что сделано:** реклама запущена из этой сессии через API, без ручных кликов в кабинете.
Кампания активна и ждёт модерации VK (показы начнутся после одобрения).

| Объект | id | Параметры |
|---|---|---|
| План `ad_plan` | 41391498 | «Маркет-Снайпер — сайт, продажа расширения», лимит 500 ₽/день |
| Кампания | 167749714 | пакет `3232` = сайт + CPC + `site_conversions` |
| Группа | 167749717 | «Селлеры Яндекс.Маркета, 25–55», ставка 15 ₽ за клик, 25–55 лет, м/ж |
| Объявления | 251953346, 251953347, 251953348 | статус active, `moderation_status: pending` |

Ссылка: `https://sniper.gadget-nakhodki.ru/?utm_source=vk_ads&utm_medium=cpc&utm_campaign=market-sniper&utm_content=site`

**Лимиты:** у плана только дневной лимит 500 ₽ — API не даёт задать одновременно
`budget_limit_day` и `budget_limit` («Can't set both budget_limit and budget_limit_day»).
Общего лимита на кампанию (раньше в конфиге было 10 000 ₽) теперь нет: чтобы остановить
списания, ставить кампанию на паузу в кабинете.

**Схема API, обнаруженная опытным путём** (документация на `ads.vk.ru/doc/api` — SPA,
по прямым URL отдаёт 404, вытаскивал через `msedge --headless=new --dump-dom`):

- `POST /api/v2/ad_plans.json` теперь требует `campaigns: [{name, package_id, status}]`,
  а `objective` задаётся на уровне плана; `enable_utm` и `autobidding_mode: second_price`
  на этом уровне не принимаются (`unknown_resource_field` / `unallowed_value`).
- Кампания создаётся либо вложенно в план, либо отдельно: `POST /api/v2/campaigns.json`
  (`objective` обязателен).
- `POST /api/v2/ad_groups.json` — поле `campaign_id` неизвестно, группа цепляется через
  `ad_plan_id`; `price` — в рублях за единицу пакета (CPC — за клик, CPM/oCPM — за 1000 показов).
- Баннер без ролей не проходит: нужен `content: {icon_256x256, image_1080x607}` и
  `textblocks: {title_40_vkads, text_90, cta_sites_full}` (`cta` — код, не текст: `visitSite`).
  Роли и их обязательность берутся из `GET /api/v2/banner_patterns.json`; паттерн
  `513 multiformat_landscape_site_vkads` = мультиформат 16:9 для сайтов.
- Справочники: `/api/v2/packages.json` (у пакета `flags` содержит `no_create_campaigns` —
  такие пакеты создавать нельзя; из «сайтовых» годятся `3232` CPC и `3229`/`3858`/`4617` oCPM),
  `/api/v2/banner_formats.json`, `/api/v2/banner_patterns.json`.
- Обновление статуса — `POST /api/v2/{resource}/{id}.json` с `{"status":"active"}` → 204.
  `DELETE /ad_plans/{id}.json` отвечает 405, план удалить нельзя (группы и кампании — 204).

**Что изменено в коде:**

- `tools/vk-ads-create.js` переписан под новую схему: план с `campaigns[]`, баннеры с ролями,
  загрузка иконки, флаг `--price` (ставка), команды `activate --plan/--campaign/--group` и
  `status` (сводка кабинета: планы, ставки, модерация, коды показов).
- `tools/vk-ads-campaign.json`: `objective: site_conversions`, `campaign_name`, `icon`, `cta`,
  ставка по умолчанию 15 ₽ за клик вместо 45 (45 ₽ за клик при подписке 199 ₽/мес — минус).
- `promo/vk-ads/icon-256x256.png` — иконка для роли `icon_256x256`, апскейл `site/img/icon.png`
  128→256 (другого источника логотипа в репозитории нет).

**Проверено:** `node --check tools\vk-ads-create.js` — без ошибок; `create` прогнан сначала
в `blocked` (черновик), затем `activate`; кабинет отвечает: кампания и группа `active`,
три объявления `active` / `pending`; `GET /campaigns.json` — одна рабочая кампания,
`node tools\vk-ads-create.js check` видит кабинет.

**Блокер на стороне кабинета:** `GET /api/v2/banners.json?fields=…,vkads_status` отдаёт
`vkads_status: {major_status: "NOT_ACTIVE", status: "ON_MODERATION", codes: ["NO_MONEY"]}` —
**рекламный кабинет не пополнен**. Модерация идёт, но показов не будет, пока на балансе нет денег
(пополнение — `ads.vk.ru` → «Финансы»). Баланс через API не читается: в `/user.json` только
валюта USD/RUB и настройки, эндпоинтов `/account.json`, `/clients.json`,
`/transaction_groups.json` нет (404).

**Осталось руками:** пополнить кабинет (без этого показов не будет), дождаться модерации
(обычно до суток), после одобрения смотреть переходы с UTM `vk_ads` в Метрике и стоимость клика;
при необходимости менять ставку `--price` или паузить кампанию в кабинете. Проверять состояние —
`node tools\vk-ads-create.js status`. Пустые планы `41390365` (проба) и `41390711` (первая
неудачная попытка) остались в кабинете: удаление планов API не поддерживает, кампаний в них нет.


## Версия 0.4.2: понятные прочерки в попапе, синхронизация test-ext (15.11.2026)

**Проблема:** в собранном `0.4.1` строки «Медиана рынка», «Ваша цена на рынке» и «Предложений
у товара» показывали голый прочерк «—». Покупатель читает это как «платная функция», хотя рыночные
данные подпиской не закрыты: они приходят с карточки и со страницы «Все предложения».

**Что закрывает подписка (для справки):** только поля ставок (комиссия, доставка, реклама,
себестоимость, схема, категория) и строку «При цене медианы: +X ₽ к прибыли». Медиана, позиция
по цене и число предложений видны и после окончания триала — это зафиксировано проверкой
`test-content.js` «в expired рынок показан, потенциал скрыт».

**Что изменено:**

- `extension/popup.js` — вместо «—» понятные причины: «цены грузятся — откройте попап ещё раз»
  (рынок ещё не подтянулся), «нет блока предложений» (на карточке нет блока «Ещё предложения»
  или это ручной расчёт), «не распознано» (блок есть, число не разобралось).
- `extension/manifest.json` — `version` → `0.4.2`.
- `_scrape/test-ext/` синхронизирован с `extension/`: `content.js`, `popup.js`, `popup.html`,
  `rates.js`, `license.js`, `_locales/ru/messages.json`, иконки. Манифест переписан: `version` 0.4.2,
  `matches` и `host_permissions` остались на `*://localhost/*`; исправлена битая кодировка
  `default_title` («РњР°СЂРєРµС‚-РЎРЅР°Р№РїРµСЂ» → «Маркет-Снайпер»). `background.js` намеренно
  оставлен урезанным: удалённый `config/selectors.json` физический тест не запрашивает, а
  `loadSelectorConfig()` без ответа падает в дефолтные селекторы.
- Ссылки на архив обновлены: `site/404.html`, `site/about.html`, `site/index.html` (включая
  `softwareVersion`), `site/kalkulyator-pribyli.html`, `site/thanks.html`, `site/README.md`,
  `store/edge-listing.md`.

**Проверено:**

- `dist\market-sniper-0.4.2.zip` — 11 файлов, каждый побайтово равен файлу из `extension\`
  (SHA-256), `manifest.json` внутри — 0.4.2; копия в `site\download\`.
- `tools\build-site-zips.ps1` — `dist\site-pages.zip` (747,5 КБ) и `dist\site-rucenter.zip`
  (770,4 КБ) пересобраны.
- Тесты из `_scrape\test`: `test-content.js` (47), `test-popup.js` (41), `test-search.js` (3),
  `test-license.js` (16), `test-issue.js` (5), `test-rates.js` (19), `test-offers.js` (16) —
  все **ITOG: OK**, всего 147 проверок.

**Выложено на сайт:** GitHub Pages, репозиторий `progerman666/market-sniper-site`
(локальный клон — `_inbox/market-sniper-site`), коммиты `0d61a78` (5 страниц с новыми ссылками
и новый архив) и `53df751` (удалён `download/market-sniper-0.4.1.zip`: скачивал его только
владелец, а версия с прочерками только путает). Проверено на живом домене:
`download/market-sniper-0.4.2.zip` → 200, 75 036 Б, SHA-256 совпадает с
`dist\market-sniper-0.4.2.zip`; в `index.html` ссылки на 0.4.2, упоминаний 0.4.1 нет,
`softwareVersion` = 0.4.2; `download/market-sniper-0.4.1.zip` → **404**,
`download/market-sniper-0.3.0.zip` → 200 (старые прямые ссылки не тронуты). После удаления
архива `dist\site-pages.zip` и `dist\site-rucenter.zip` пересобраны: 674,5 КБ и 697,4 КБ.

**Осталось:** задеплоить на Ru-Center (`deploy-rucenter.ps1`, нужны FTP-доступы) и загрузить
`dist\market-sniper-0.4.2.zip` в Edge Add-ons.

