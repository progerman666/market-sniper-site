# market-sniper-license

Воркер выдаёт и проверяет ключи доступа «Маркет-Снайпера».

- Формат ключа: `MS1.<payload>.<подпись ECDSA P-256>`; payload = `{"v":1,"tier":"pro","exp":<unix>,"sub":"<номер заказа>"}`.
- Приватный ключ подписи живёт только здесь (secret `PRIVATE_KEY_B64`), в расширении — только публичный. Подделать ключ нельзя.
- СБП/оплату принимаете на лендинге (самозанятость, чек через «Мой налог»), после оплаты вызываете `/api/license/issue` и отдаёте ключ покупателю письмом.

## Первичная настройка

```powershell
cd D:\projects\market-sniper\server
npm install

# 1. Ключ подписи (тот, что сгенерирован для этого проекта)
#    server\keys\dev-private.txt -> содержимое кладём в secret, файл в git не попадает
npx wrangler secret put PRIVATE_KEY_B64

# 2. Пароль администратора для выдачи ключей
npx wrangler secret put ADMIN_SECRET

# 3. Деплой (сразу получите адрес вида https://market-sniper-license.<account>.workers.dev)
npx wrangler deploy
```

Публичный ключ уже вшит в `license.js` (`MS_LICENSE.PUBLIC_KEY_B64`). Если перегенерируете пару — замените и там, и в secret, иначе старые ключи перестанут проверяться.

## Онлайн-оплата ЮKassa (сайт на GitHub Pages)

Сайт статический, PHP там нет, поэтому платёжный путь живёт в этом же Worker:

| Эндпоинт | Что делает |
|---|---|
| `POST /api/pay` | создаёт платёж в ЮKassa (Basic-авторизация, чек, `Idempotence-Key`), пишет заказ в KV, возвращает `confirmation_url` |
| `POST /api/webhook` | уведомление ЮKassa: перепроверяет платёж через API, сверяет сумму в копейках, выдаёт ключ, отправляет письмо |
| `GET /api/pay/status?id=…` | статус заказа и ключ для страницы `thanks.html` |

Настройка:

```powershell
cd D:\projects\market-sniper\server

# 1. Хранилище заказов и ключей (идемпотентность webhook)
npx wrangler kv namespace create LICENSES
#    id вписать в wrangler.jsonc → kv_namespaces

# 2. Секреты (в файлы не попадают)
npx wrangler secret put PRIVATE_KEY_B64      # ключ подписи лицензий
npx wrangler secret put YOOKASSA_SECRET_KEY  # перевыпущенный ключ ЮKassa
npx wrangler secret put RESEND_API_KEY       # письма с ключом (необязательно)

# 3. Деплой
npx wrangler deploy
```

Адрес Worker (`https://market-sniper-license.<account>.workers.dev`) прописывается в
`site/js/api.js` → `window.MS_API`. Свой домен вида `api.sniper.gadget-nakhodki.ru` на бесплатном
плане не подойдёт: Universal SSL Cloudflare покрывает только `*.gadget-nakhodki.ru`, а `api.sniper.…`
— второй уровень поддомена.

В ЮKassa → Интеграция → HTTP-уведомления укажите
`https://market-sniper-license.<account>.workers.dev/api/webhook`, события `payment.succeeded`
и `payment.canceled`.

Без `RESEND_API_KEY` оплата не ломается: ключ сохраняется в KV и показывается покупателю на
`thanks.html` (по номеру платежа из `localStorage`). С ключом Resend письмо уходит автоматически.

Проверка без реальных денег: `node _scrape\test\test-worker-pay.js` — мок ЮKassa, Resend и KV,
33 проверки (создание платежа, чек, `receipt_retry`, webhook до/после оплаты, ключ, идемпотентность,
подмена суммы, отмена, неизвестный платёж, статус, лимит попыток).

## Выдача ключа (после оплаты)


```powershell
$body = @{ days = 30; tier = 'pro'; order = 'SBП-000123' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://market-sniper-license.<account>.workers.dev/api/license/issue' `
  -Headers @{ 'Content-Type' = 'application/json'; 'X-Admin-Secret' = '<ADMIN_SECRET>' } -Body $body
```

Ответ: `{ key, exp, tier, id, days }` — `key` отправляете покупателю.

## Проверка/отзыв

```powershell
# проверка ключа
Invoke-RestMethod -Uri ('https://<worker>/api/license/check?key=' + $key)

# отзыв (после включения KV): ключ перестанет проходить проверку на сервере
npx wrangler kv key put --binding=LICENSES ("revoked:" + $id) "1"
```

Проверка на сервере нужна только для отзыва: расширение проверяет подпись и срок локально, поэтому работает офлайн.

## Свой домен (Ru-Center → Cloudflare)

1. В Ru-Center: домен → «Управление зоной» → сменить NS на выданные Cloudflare (`xxx.ns.cloudflare.com`).
2. В Cloudflare: Add site → вставить домен → план Free → дождаться статуса Active (обычно 15 минут — 24 часа).
3. Workers → market-sniper-license → Settings → Domains & Routes → Add custom domain → `api.<ваш-домен>`.
4. В `license.js` ничего менять не нужно (ключи проверяются офлайн); адрес нужен только для отзыва и выдачи.

Почта/чеки покупателям: Ru-Center даёт почту на домене, либо используйте Яндекс 360 (бесплатный тариф для домена).
