<?php
declare(strict_types=1);
// go.php — промежуточная страница оплаты на кошелёк ЮMoney.
// Сумма, метка и получатель берутся из записи платежа на сервере, а не из ссылки:
// подменить сумму в адресной строке нельзя.
require __DIR__ . '/helpers.php';

$label = trim((string) ($_GET['label'] ?? ''));
$record = preg_match('/^MS-[A-Za-z0-9]{6,48}$/', $label) ? ms_payment_load($label) : null;
$cfg = ms_config();
$ym = $cfg['yoomoney'];
$ready = $record
    && ($record['provider'] ?? '') === 'yoomoney'
    && ($record['status'] ?? '') === 'pending'
    && ms_yoomoney_ready();

header('X-Robots-Tag: noindex');
header('Cache-Control: no-store, max-age=0');

$fields = [];
if ($ready) {
    $fields = [
        'receiver' => (string) $ym['receiver'],
        'quickpay-form' => 'button',
        'paymentType' => (string) $ym['payment_type'],
        'sum' => ms_money((int) $record['amount']),
        'label' => $label,
        'successURL' => (string) $ym['success_url'],
        'targets' => 'Маркет-Снайпер — доступ на ' . (int) $record['days'] . ' дн.',
    ];
}

if (!$ready) {
    http_response_code(404);
}
?><!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Оплата — Маркет-Снайпер</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0b1f3a">
<link rel="icon" href="../img/icon.png">
<link rel="stylesheet" href="../styles.css">
</head>
<body>
<header>
  <div class="wrap header-inner">
    <a class="logo" href="../index.html"><img src="../img/icon.png" alt=""> Маркет-Снайпер</a>
  </div>
</header>

<main class="wrap doc">
<?php if ($ready): ?>
  <h1>Переходим к оплате</h1>
  <div class="note" style="margin:18px 0">
    Тариф: <b><?= htmlspecialchars(ms_plan_title((string) $record['plan']), ENT_QUOTES, 'UTF-8') ?></b>,
    к оплате <b><?= htmlspecialchars((string) $record['amount'], ENT_QUOTES, 'UTF-8') ?> ₽</b>.
    Ключ придёт на <b><?= htmlspecialchars((string) $record['email'], ENT_QUOTES, 'UTF-8') ?></b> сразу после оплаты.
  </div>

  <p>Если страница оплаты не открылась сама — нажмите кнопку.</p>

  <form id="pay-form" method="post" action="https://yoomoney.ru/quickpay/confirm">
    <?php foreach ($fields as $name => $value): ?>
      <input type="hidden" name="<?= htmlspecialchars($name, ENT_QUOTES, 'UTF-8') ?>" value="<?= htmlspecialchars($value, ENT_QUOTES, 'UTF-8') ?>">
    <?php endforeach; ?>
    <button class="btn btn-gold" type="submit">Перейти к оплате</button>
  </form>
  <noscript><p>Без JavaScript нажмите «Перейти к оплате» вручную.</p></noscript>

  <p style="margin-top:24px;font-size:13px;color:#6f87a6">
    Если что-то пошло не так — напишите на <a href="mailto:goinslims@gmail.com">goinslims@gmail.com</a>.
  </p>

  <script>document.getElementById('pay-form').submit();</script>
<?php else: ?>
  <h1>Заказ не найден</h1>
  <p>Ссылка на оплату устарела или уже использована. Создайте новый заказ на странице оплаты.</p>
  <p><a class="btn btn-gold" href="../buy.html">Вернуться к оплате</a></p>
<?php endif; ?>
</main>

<footer>
  <div class="wrap">© 2026 Маркет-Снайпер. Самозанятый: Воробьев Евгений Александрович, ИНН 422194497805.</div>
</footer>
</body>
</html>
