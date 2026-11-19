<?php
declare(strict_types=1);
require __DIR__ . '/helpers.php';

$cfg = ms_config();
$error = '';
$issued = null;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $secret = (string) ($_POST['secret'] ?? '');
    if (!hash_equals((string) $cfg['admin_secret'], $secret)) {
        $error = 'Неверный пароль';
    } else {
        $issued = ms_issue([
            'plan' => (string) ($_POST['plan'] ?? 'month'),
            'order' => trim((string) ($_POST['order'] ?? '')),
        ]);
    }
}

$planNames = ['month' => 'Месяц — 199 ₽', 'year' => 'Год — 1 990 ₽'];
?><!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Выдача ключей — Маркет-Снайпер</title>
<style>
    body { margin:0; padding:32px 16px; background:#0b1f3a; color:#e2e8f0;
           font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
    .box { max-width:640px; margin:0 auto; background:#122b4a; border:1px solid #24456d;
           border-radius:16px; padding:24px; }
    h1 { margin:0 0 16px; font-size:20px; color:#fff; }
    label { display:block; margin:12px 0 4px; font-size:13px; color:#9fb3cc; }
    input, select { width:100%; padding:10px; border-radius:8px; border:1px solid #2c517d;
                    background:#0b1f3a; color:#fff; font-size:14px; }
    button { margin-top:18px; width:100%; padding:12px; border:0; border-radius:10px;
             background:#f5c451; color:#0b1f3a; font-weight:700; font-size:15px; cursor:pointer; }
    .key { margin-top:16px; padding:12px; background:#0b1f3a; border:1px dashed #3d6597;
           border-radius:10px; font-family:ui-monospace,Consolas,monospace; font-size:12px;
           word-break:break-all; }
    .err { margin-top:12px; color:#ff8a80; font-size:13px; }
    .ok { margin-top:12px; color:#7ee2a8; font-size:13px; }
    a { color:#f5c451; }
</style>
</head>
<body>
<div class="box">
    <h1>Выдача ключа после оплаты</h1>

    <p style="font-size:13px;color:#9fb3cc;margin:0 0 8px">
        Онлайн-оплата выдаёт ключи автоматически (<code>api/webhook.php</code>). Эта страница нужна
        для переводов по СБП, возвратов и повторной выдачи.
    </p>

    <?php if ($error): ?>
        <div class="err"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>

    <?php if ($issued): ?>
        <div class="ok">Ключ выдан. Оплата: <?= (int) $issued['price'] ?> ₽, срок до
            <?= htmlspecialchars(date('d.m.Y', (int) $issued['exp']), ENT_QUOTES, 'UTF-8') ?>.</div>
        <div class="key" id="key"><?= htmlspecialchars($issued['key'], ENT_QUOTES, 'UTF-8') ?></div>
        <p style="font-size:13px;color:#9fb3cc">Скопируйте ключ и отправьте покупателю письмом. Чек пробейте в «Мой налог».</p>
    <?php endif; ?>

    <form method="post">
        <label>Пароль администратора</label>
        <input type="password" name="secret" required autocomplete="current-password">

        <label>Тариф</label>
        <select name="plan">
            <?php foreach ($planNames as $code => $title): ?>
                <option value="<?= htmlspecialchars($code, ENT_QUOTES, 'UTF-8') ?>">
                    <?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?>
                </option>
            <?php endforeach; ?>
        </select>

        <label>Номер заказа / почта покупателя</label>
        <input type="text" name="order" placeholder="СБП-0001 или buyer@mail.ru">

        <button type="submit">Выдать ключ</button>
    </form>

    <p style="font-size:12px;color:#6f87a6;margin-top:18px">
        Журнал выдачи: <code>api/data/issued.log</code>. Отозвать ключ — добавить его id в
        <code>api/data/revoked.json</code>.
    </p>
</div>
</body>
</html>
