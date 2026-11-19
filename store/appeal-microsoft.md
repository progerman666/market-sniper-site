# Апелляция в поддержку Microsoft (блок регистрации в Partner Center)

Отправлять через форму поддержки Edge-расширений:
https://support.microsoft.com → «Extensions New Support Request»
(либо через https://partner.microsoft.com/support, если он открывается под вашим аккаунтом)

## Что указать в форме

- **Reference number:** 715-123225
- **Correlation ID:** 6e8fb5e4-e685-4277-a694-4c420e4046b8
- **Тема:** Registration for Microsoft Edge program blocked by trust check
- **Категория:** Partner Center → Account / Registration

## Текст обращения (английский, можно копировать целиком)

```
Hello,

I am trying to register as an individual developer for the Microsoft Edge program
in Partner Center in order to publish a browser extension, but my registration
request was blocked by the trust and safety check.

Reference number: 715-123225
Correlation ID: 6e8fb5e4-e685-4277-a694-4c420e4046b8

What I was doing:
- Signing up for the Microsoft Edge program at Partner Center with a personal
  Microsoft account (individual developer, not a company).
- No VPN or proxy is used; I connect from a home ISP in Russia.
- The account is new, this is my first registration attempt.

What I plan to publish:
- Extension name: Market Sniper (Маркет-Снайпер)
- Purpose: shows the seller's net profit on a Yandex Market product page
  (price minus marketplace commission, delivery and ads). Read-only: the
  extension parses public data from the product page, stores settings locally
  (chrome.storage), and does not collect or transmit personal data.
- Permissions requested: "storage" only; host permission for market.yandex.ru.
- Product website: https://sniper.gadget-nakhodki.ru/
- Privacy policy: https://sniper.gadget-nakhodki.ru/privacy.html
- Contact e-mail: goinslims@gmail.com

Could you please review the block and either unblock the registration or let me
know which requirements I need to meet? If registration from my region is
restricted for this program, please confirm it so I can plan distribution
accordingly.

Thank you.
```

## Перед повторной попыткой (если разблокируют)

1. Выйти из всех аккаунтов Partner Center → войти **личным** Microsoft-аккаунтом (outlook.com) или через GitHub.
2. Отключить VPN/прокси, использовать домашний интернет (IP не должен быть из дата-центра).
3. Не создавать несколько аккаунтов подряд — частые попытки усиливают блок.
4. Страну указывать честно, данные (имя, телефон) — как в банке.
5. Если аккаунт создавали как «организацию» — лучше новый личный, с нуля.

## Что делать параллельно (не ждать поддержки)

1. **Ручная установка** — уже работает: `https://sniper.gadget-nakhodki.ru/download/market-sniper-0.3.0.zip` + инструкция на сайте.
2. **Chrome Web Store** — тот же MV3-пакет, но нужен аккаунт разработчика ($5, иностранная карта).
3. **Opera Add-ons** — бесплатная регистрация, принимает Chromium-расширения; аудитория меньше, но как второй канал подходит.
4. Продвижение там, где сидят продавцы: чаты/форумы продавцов Маркета, Kwork, статьи на своём сайте.

## Если подтвердят региональное ограничение

Значит Edge-каталог для РФ закрыт на уровне политики. Тогда основной канал — собственная дистрибуция (zip) + Chrome/Opera, а Edge остаётся «если/когда откроют». Продукт от этого не страдает: расширение работает в Edge при ручной установке без каталога.
