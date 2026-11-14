// metrica.js — Яндекс.Метрика и цели для сайта «Маркет-Снайпер».
//
// Как подключить:
//   1. metrika.yandex.ru → «Добавить счётчик» → тип «Сайт»,
//      домен sniper.gadget-nakhodki.ru. «Вебвизор» и «Карту скроллинга» — по желанию.
//   2. Номер счётчика впишите в MS_METRIKA_ID ниже.
//   3. Пересоберите архивы сайта: .\tools\build-site-zips.ps1 и обновите файлы на хостинге.
//
// Если MS_METRIKA_ID = 0, скрипт ничего не загружает и не отправляет — сайт работает как раньше.
//
// Цели — создайте их в Метрике с теми же идентификаторами:
//   download      — клик по ссылке на архив расширения
//   buy           — переход на страницу оплаты
//   buy_month     — переход на оплату за месяц
//   buy_year      — переход на оплату за год
//   pay_online    — клик по кнопке онлайн-оплаты (api/pay.php)
//   mail_confirm  — клик по «Отправить подтверждение»
//   max_click     — переход в MAX
//   store_click   — переход в каталог Edge
//   calc          — расчёт в калькуляторе прибыли
//   faq_open      — раскрытие вопроса в FAQ

var MS_METRIKA_ID = 114252289;

(function () {
  'use strict';

  if (!MS_METRIKA_ID) { return; }

  // Загрузчик счётчика — стандартный фрагмент Метрики, вынесенный из разметки.
  (function (m, e, t, r, i, k, a) {
    m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    for (var j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) { return; }
    }
    k = e.createElement(t);
    a = e.getElementsByTagName(t)[0];
    k.async = 1;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');

  window.ym(MS_METRIKA_ID, 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: false
  });

  // Единая точка отправки цели: msGoal('download') или msGoal('buy', { plan: 'year' }).
  window.msGoal = function (goal, params) {
    if (!goal || typeof window.ym !== 'function') { return; }
    if (params) { window.ym(MS_METRIKA_ID, 'reachGoal', goal, params); }
    else { window.ym(MS_METRIKA_ID, 'reachGoal', goal); }
  };

  // Автоматические цели по кликам — разметку страниц править не нужно.
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest('a, button') : null;
    if (!el) { return; }

    var goal = el.getAttribute('data-goal');
    var href = el.getAttribute('href') || '';

    if (!goal) {
      if (/download\/[^?]+\.zip/i.test(href)) { goal = 'download'; }
      else if (/buy\.html/i.test(href)) {
        if (/plan=year/i.test(href)) { goal = 'buy_year'; }
        else if (/plan=month/i.test(href)) { goal = 'buy_month'; }
        else { goal = 'buy'; }
      }
      else if (href.indexOf('mailto:') === 0) { goal = 'mail_confirm'; }
      else if (href.indexOf('https://web.max.ru') === 0) { goal = 'max_click'; }
      else if (href.indexOf('microsoftedge.microsoft.com') !== -1) { goal = 'store_click'; }
    }

    if (goal) { window.msGoal(goal); }
  });

  // Раскрытие вопроса в FAQ: событие toggle не всплывает — слушаем на фазе перехвата.
  document.addEventListener('toggle', function (event) {
    var el = event.target;
    if (el && el.tagName === 'DETAILS' && el.open) { window.msGoal('faq_open'); }
  }, true);
})();
