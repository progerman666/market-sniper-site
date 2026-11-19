<?php
declare(strict_types=1);
// webhook.php — уведомление ЮKassa. Ключ выдаётся только после того, как мы сами
// перепроверили платёж через API: телу запроса не доверяем (подписи у ЮKassa нет).
require __DIR__ . '/helpers.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    ms_webhook_bad(405, 'need POST');
}

// ЮMoney-кошелёк присылает обычную форму с параметром notification_type и подписью sign.
if (!empty($_POST['notification_type'])) {
    ms_handle_yoomoney_notification($_POST);
    ms_webhook_ok();
}

$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) {
    ms_webhook_bad(400, 'bad json');
}

$event = (string) ($body['event'] ?? '');
$paymentId = (string) ($body['object']['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9_-]{4,64}$/', $paymentId)) {
    ms_webhook_bad(400, 'bad payment id');
}

$cfg = ms_config();

if (!ms_yookassa_ready()) {
    ms_log_line('payments.log', [
        'status' => 'webhook_no_keys',
        'payment_id' => $paymentId,
        'event' => $event,
        'created' => date('c'),
    ]);
    ms_webhook_bad(503, 'no api keys');
}

$res = ms_yookassa_request('GET', '/payments/' . rawurlencode($paymentId));

// Такого платежа у провайдера нет — отвечаем 200, чтобы он не повторял запрос.
if ($res['status'] === 404) {
    ms_log_line('payments.log', [
        'status' => 'unknown_payment',
        'payment_id' => $paymentId,
        'event' => $event,
        'created' => date('c'),
    ]);
    ms_webhook_ok();
}

// Сеть или 5xx — пусть ЮKassa повторит уведомление позже.
if ($res['status'] !== 200 || empty($res['data']['id'])) {
    ms_log_line('payments.log', [
        'status' => 'verify_failed',
        'payment_id' => $paymentId,
        'http' => $res['status'],
        'error' => $res['error'] ?: (string) ($res['data']['description'] ?? ''),
        'created' => date('c'),
    ]);
    ms_webhook_bad(502, 'verify failed');
}

$payment = $res['data'];
$state = (string) ($payment['status'] ?? '');

// Отмена: ключ не выдаём, но факт фиксируем.
if ($event === 'payment.canceled' || $state === 'canceled') {
    $saved = ms_payment_load($paymentId) ?: ['payment_id' => $paymentId];
    $saved['status'] = 'canceled';
    $saved['canceled_at'] = date('c');
    ms_payment_save($paymentId, $saved);
    ms_log_line('payments.log', [
        'status' => 'canceled',
        'payment_id' => $paymentId,
        'created' => date('c'),
    ]);
    ms_webhook_ok();
}

if ($state !== 'succeeded' || empty($payment['paid'])) {
    ms_log_line('payments.log', [
        'status' => 'not_paid',
        'payment_id' => $paymentId,
        'state' => $state,
        'created' => date('c'),
    ]);
    ms_webhook_ok();
}

$meta = is_array($payment['metadata'] ?? null) ? $payment['metadata'] : [];
$planName = isset($cfg['plans'][$meta['plan'] ?? '']) ? (string) $meta['plan'] : 'month';
$plan = $cfg['plans'][$planName];

$amount = is_array($payment['amount'] ?? null) ? $payment['amount'] : [];
$paidKopecks = ms_money_to_kopecks($amount['value'] ?? '0');
$expectedKopecks = (int) $plan['price'] * 100;
$currency = (string) ($amount['currency'] ?? '');

// Проверяем сумму: подменить metadata и заплатить 1 ₽ не получится.
if ($paidKopecks !== $expectedKopecks || $currency !== 'RUB') {
    ms_log_line('payments.log', [
        'status' => 'amount_mismatch',
        'payment_id' => $paymentId,
        'plan' => $planName,
        'paid' => $amount['value'] ?? null,
        'expected' => ms_money((int) $plan['price']),
        'created' => date('c'),
    ]);
    ms_mail_send(
        (string) $cfg['mail']['admin'],
        'Маркет-Снайпер: сумма платежа не совпала',
        "Платёж " . $paymentId . " прошёл, но сумма не совпала с тарифом.\n\n"
        . "Тариф: " . ms_plan_title($planName) . " (" . (int) $plan['price'] . " ₽)\n"
        . "Пришло: " . (string) ($amount['value'] ?? '?') . " " . $currency . "\n\n"
        . "Ключ автоматически не выдан. Проверьте платёж в личном кабинете ЮKassa.\n"
    );
    ms_webhook_ok();
}

$email = trim((string) ($meta['email'] ?? ''));
if ($email === '' && isset($payment['receipt']['customer']['email'])) {
    $email = trim((string) $payment['receipt']['customer']['email']);
}
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $email = '';
}

// Повторное уведомление: ключ уже есть — второй раз не выдаём, но письмо досылаем.
$existing = ms_payment_load($paymentId);
if ($existing && !empty($existing['key'])) {
    if (empty($existing['mailSent'])) {
        $existing['mailSent'] = ms_deliver_key($existing);
        ms_payment_save($paymentId, $existing);
    }
    ms_log_line('payments.log', [
        'status' => 'duplicate',
        'payment_id' => $paymentId,
        'created' => date('c'),
    ]);
    ms_webhook_ok();
}

// Параллельный запрос уже обрабатывает этот платёж — не мешаем.
if ($existing && ($existing['status'] ?? '') === 'processing' && (int) ($existing['startedTs'] ?? 0) > time() - 120) {
    ms_webhook_ok();
}

$claim = [
    'status' => 'processing',
    'payment_id' => $paymentId,
    'plan' => $planName,
    'days' => (int) $plan['days'],
    'amount' => (int) $plan['price'],
    'email' => $email,
    'startedTs' => time(),
    'started' => date('c'),
];
if (!ms_payment_claim($paymentId, $claim)) {
    // Файл уже есть: либо ключ выдан, либо параллельный запрос ещё работает.
    // Забираем платёж себе только если запись осталась от упавшей попытки (старше 2 минут).
    $again = ms_payment_load($paymentId) ?: [];
    if (!empty($again['key']) || (int) ($again['startedTs'] ?? 0) > time() - 120) {
        ms_webhook_ok();
    }
    ms_payment_save($paymentId, $claim);
}

$issued = ms_issue(['plan' => $planName, 'order' => ms_order_label($paymentId)]);

$record = [
    'status' => 'paid',
    'payment_id' => $paymentId,
    'plan' => $planName,
    'days' => $issued['days'],
    'amount' => (int) $plan['price'],
    'email' => $email,
    'key' => $issued['key'],
    'key_id' => $issued['id'],
    'exp' => $issued['exp'],
    'paid_at' => (string) ($payment['created_at'] ?? date('c')),
    'mailSent' => false,
];
$record['mailSent'] = ms_deliver_key($record);
ms_payment_save($paymentId, $record);

ms_log_line('payments.log', [
    'status' => 'paid',
    'payment_id' => $paymentId,
    'plan' => $planName,
    'amount' => (int) $plan['price'],
    'email' => $email,
    'key_id' => $issued['id'],
    'mail' => $record['mailSent'],
    'created' => date('c'),
]);

if (!$record['mailSent']) {
    ms_log_line('payments.log', [
        'status' => 'mail_failed',
        'payment_id' => $paymentId,
        'email' => $email,
        'created' => date('c'),
    ]);
}

ms_webhook_ok();

