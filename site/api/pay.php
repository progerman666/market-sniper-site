<?php
declare(strict_types=1);
// pay.php — создаёт платёж в ЮKassa и отдаёт ссылку на страницу оплаты.
// Ключ выдаётся не здесь, а в webhook.php после подтверждения оплаты провайдером.
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    ms_json_out([]);
}
if ($method !== 'POST') {
    ms_json_out(['ok' => false, 'error' => 'нужен POST'], 405);
}

$cfg = ms_config();
$yk = $cfg['yookassa'];
$body = ms_body();
$isJson = stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== false;
$wantRedirect = $isJson === false || !empty($body['redirect']);

$planName = isset($cfg['plans'][$body['plan'] ?? '']) ? (string) $body['plan'] : 'month';
$plan = $cfg['plans'][$planName];
$email = trim((string) ($body['email'] ?? ''));

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    ms_json_out(['ok' => false, 'error' => 'Укажите e-mail — на него придёт ключ'], 400);
}

$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0');
if (!ms_rate_limit('pay-' . $ip, (int) $cfg['pay_rate_limit'])) {
    ms_json_out(['ok' => false, 'error' => 'Слишком много попыток оплаты. Подождите час или напишите нам.'], 429);
}

$provider = ms_provider();

if ($provider === '') {
    ms_log_line('payments.log', ['status' => 'not_configured', 'plan' => $planName, 'created' => date('c')]);
    ms_json_out(['ok' => false, 'error' => 'Онлайн-оплата пока не подключена — оплатите по СБП'], 503);
}

// ЮMoney-кошелёк: API-ключи не нужны, форма быстрой оплаты открывается на нашей
// странице api/go.php, а подтверждение приходит в webhook.php с подписью.
if ($provider === 'yoomoney') {
    $label = ms_payment_label();
    ms_payment_save($label, [
        'status' => 'pending',
        'provider' => 'yoomoney',
        'payment_id' => $label,
        'plan' => $planName,
        'days' => (int) $plan['days'],
        'amount' => (int) $plan['price'],
        'email' => $email,
        'created' => date('c'),
        'ip' => $ip,
    ]);
    ms_log_line('payments.log', [
        'status' => 'created',
        'provider' => 'yoomoney',
        'payment_id' => $label,
        'plan' => $planName,
        'amount' => (int) $plan['price'],
        'email' => $email,
        'created' => date('c'),
    ]);

    $confirmation = $cfg['site_url'] . '/api/go.php?label=' . rawurlencode($label);

    if ($wantRedirect) {
        header('Location: ' . $confirmation, true, 303);
        exit;
    }

    ms_json_out([
        'ok' => true,
        'provider' => 'yoomoney',
        'payment_id' => $label,
        'confirmation_url' => $confirmation,
        'plan' => $planName,
        'days' => (int) $plan['days'],
        'amount' => (int) $plan['price'],
    ]);
}

if (!ms_yookassa_ready()) {
    ms_log_line('payments.log', ['status' => 'not_configured', 'provider' => 'yookassa', 'plan' => $planName, 'created' => date('c')]);
    ms_json_out(['ok' => false, 'error' => 'Онлайн-оплата пока не подключена — оплатите по СБП'], 503);
}

$title = ms_plan_title($planName);
$amount = ['value' => ms_money((int) $plan['price']), 'currency' => 'RUB'];
$description = 'Маркет-Снайпер — доступ на ' . (int) $plan['days'] . ' дн., тариф «' . $title . '»';

$payload = [
    'amount' => $amount,
    'capture' => true,
    'confirmation' => ['type' => 'redirect', 'return_url' => $yk['return_url']],
    'description' => $description,
    'metadata' => [
        'plan' => $planName,
        'days' => (int) $plan['days'],
        'email' => $email,
        'source' => 'site',
    ],
];

if (!empty($yk['send_receipt'])) {
    $payload['receipt'] = [
        'customer' => ['email' => $email],
        'items' => [[
            'description' => $description,
            'quantity' => '1.00',
            'amount' => $amount,
            'vat_code' => (int) $yk['vat_code'],
            'payment_subject' => $yk['payment_subject'],
            'payment_mode' => $yk['payment_mode'],
        ]],
    ];
}

$res = ms_yookassa_request('POST', '/payments', $payload, ms_uuid());
$data = $res['data'];

// Если у магазина не настроена фискализация, ЮKassa отклонит чек — повторяем без него.
if ($res['status'] >= 400 && isset($payload['receipt']) && ms_is_receipt_error($data)) {
    ms_log_line('payments.log', [
        'status' => 'receipt_retry',
        'http' => $res['status'],
        'error' => $data['description'] ?? '',
        'created' => date('c'),
    ]);
    unset($payload['receipt']);
    $res = ms_yookassa_request('POST', '/payments', $payload, ms_uuid());
    $data = $res['data'];
}

$paymentId = (string) ($data['id'] ?? '');
$confirmation = (string) ($data['confirmation']['confirmation_url'] ?? '');

if ($paymentId === '' || $confirmation === '') {
    ms_log_line('payments.log', [
        'status' => 'create_failed',
        'http' => $res['status'],
        'error' => $res['error'] ?: (string) ($data['description'] ?? ''),
        'plan' => $planName,
        'email' => $email,
        'created' => date('c'),
    ]);
    ms_json_out(['ok' => false, 'error' => 'Платёжный сервис не принял запрос. Попробуйте ещё раз или оплатите по СБП'], 502);
}

ms_payment_save($paymentId, [
    'status' => 'pending',
    'payment_id' => $paymentId,
    'plan' => $planName,
    'days' => (int) $plan['days'],
    'amount' => (int) $plan['price'],
    'email' => $email,
    'created' => date('c'),
    'ip' => $ip,
]);

ms_log_line('payments.log', [
    'status' => 'created',
    'payment_id' => $paymentId,
    'plan' => $planName,
    'amount' => (int) $plan['price'],
    'email' => $email,
    'created' => date('c'),
]);

// Форма без JS: сразу редирект на страницу оплаты.
if ($wantRedirect) {
    header('Location: ' . $confirmation, true, 303);
    exit;
}

ms_json_out([
    'ok' => true,
    'payment_id' => $paymentId,
    'confirmation_url' => $confirmation,
    'plan' => $planName,
    'days' => (int) $plan['days'],
    'amount' => (int) $plan['price'],
]);
