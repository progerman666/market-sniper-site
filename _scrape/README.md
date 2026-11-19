# _scrape — dev-материалы (в расширение не входят)

Само расширение лежит в `..\extension` — именно эту папку загружают в Edge. В `_scrape` есть файлы с `_` в имени, а Chrome/Edge запрещают такие имена внутри расширения.

- `https___market_yandex_ru_product_6307487765.html` — сохранённая карточка товара (фикстура).
- `search.html` — сохранённая страница поиска (фикстура).
- `placement.md` — официальная таблица тарифов размещения (1.6 МБ, источник пресетов в `rates.js`).
- `test/` — jsdom-тесты `content.js` и `popup.js`.

## Запуск тестов

```powershell
cd D:\projects\market-sniper\_scrape\test
npm install jsdom
node test-content.js
node test-popup.js
node test-search.js
```

`test/node_modules` можно удалить — тесты переустановят jsdom командой `npm install jsdom`.

## Физический тест в реальном Edge (без запросов к Яндексу)

```powershell
# окно 1: локальный сервер с сохранённой карточкой
cd D:\projects\market-sniper\_scrape\test
node serve-fixture.js 8080

# окно 2: Edge с расширением + чтение DOM через DevTools-протокол
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu `
  --remote-debugging-port=9455 --user-data-dir="$env:TEMP\ms-edge-final" `
  --load-extension="D:\projects\market-sniper\_scrape\test-ext" `
  "http://localhost:8080/product--x/6307487765"
node D:\projects\market-sniper\_scrape\test\check-page.js 9455
```

`test-ext` — копия расширения, у которой в манифесте `matches` заменены на `*://localhost/*`
(создаётся из корня проекта копированием файлов и правкой одного поля).

Результат эталонного прогона: `path=/card/...`, `price=46 844 ₽`, `seller=chengzhongde`,
`badge=Прибыль ≈ 42 060 ₽ … магазин: chengzhongde · предложений: 74`.
Скриншот с бейджем: `_scrape/shot-badge.png`.


## Как сняты фикстуры

```powershell
$ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
Invoke-WebRequest -Uri 'https://market.yandex.ru/product/<id>' -UserAgent $ua -Headers @{'Accept-Language'='ru-RU,ru;q=0.9'} -TimeoutSec 60
```

Сервер отдаёт цены и карточку магазина уже в HTML (JS не обязателен), поэтому фикстуры полноценные.
