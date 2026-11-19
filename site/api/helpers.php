<?php
declare(strict_types=1);

// Общие функции: конфиг, JSON-ответы, подпись ключей, лог выдачи.
function ms_config(): array
{
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . '/config.php';
    }
    return $config;
}

function ms_json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Admin-Secret');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ms_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    if (is_array($data)) {
        return $data;
    }
    return $_POST ?: [];
}

function ms_b64url(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

// PHP/OpenSSL отдаёт подпись ECDSA в DER, а браузер (WebCrypto) ждёт «сырые» r||s (64 байта).
function ms_der_to_raw(string $der): string
{
    if (strlen($der) < 8 || ord($der[0]) !== 0x30) {
        return $der;
    }

    $offset = 2;
    if ((ord($der[1]) & 0x80) !== 0) {
        $offset = 2 + (ord($der[1]) & 0x7f);
    }

    $out = '';
    for ($i = 0; $i < 2; $i++) {
        if (!isset($der[$offset]) || ord($der[$offset]) !== 0x02) {
            return $der;
        }
        $len = ord($der[$offset + 1]);
        $value = substr($der, $offset + 2, $len);
        $offset += 2 + $len;

        $value = ltrim($value, "\x00");
        $value = str_pad($value, 32, "\x00", STR_PAD_LEFT);
        $out .= $value;
    }

    return strlen($out) === 64 ? $out : $der;
}

function ms_raw_to_der(string $raw): string
{
    if (strlen($raw) !== 64) {
        return $raw;
    }

    $r = ltrim(substr($raw, 0, 32), "\x00");
    $s = ltrim(substr($raw, 32, 32), "\x00");
    $r = $r === '' ? "\x00" : $r;
    $s = $s === '' ? "\x00" : $s;
    if (ord($r[0]) & 0x80) {
        $r = "\x00" . $r;
    }
    if (ord($s[0]) & 0x80) {
        $s = "\x00" . $s;
    }

    $sequence = "\x02" . chr(strlen($r)) . $r . "\x02" . chr(strlen($s)) . $s;
    return "\x30" . chr(strlen($sequence)) . $sequence;
}

// Ключ = MS1.<base64url(payload)>.<base64url(подпись ECDSA P-256)>
function ms_sign(array $payload): string
{
    $cfg = ms_config();
    $pem = @file_get_contents($cfg['private_key_path']);
    if (!$pem) {
        ms_json_out(['error' => 'на сервере нет приватного ключа'], 500);
    }

    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!openssl_sign($json, $signature, $pem, OPENSSL_ALGO_SHA256)) {
        ms_json_out(['error' => 'не удалось подписать ключ'], 500);
    }

    return 'MS1.' . ms_b64url($json) . '.' . ms_b64url(ms_der_to_raw($signature));
}

function ms_key_id(string $token): string
{
    return substr(hash('sha256', $token), 0, 32);
}

function ms_data_dir(): string
{
    $cfg = ms_config();
    $dir = $cfg['data_dir'];
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function ms_is_revoked(string $id): bool
{
    $file = ms_data_dir() . '/revoked.json';
    if (!is_file($file)) {
        return false;
    }
    $list = json_decode((string) @file_get_contents($file), true);
    return is_array($list) && in_array($id, $list, true);
}

// Единая точка выдачи ключа: plan ('month'|'year') или days.
function ms_issue(array $body): array
{
    $cfg = ms_config();
    $planName = isset($cfg['plans'][$body['plan'] ?? '']) ? $body['plan'] : 'month';
    $plan = $cfg['plans'][$planName];

    $days = isset($body['days']) ? (int) $body['days'] : (int) $plan['days'];
    $days = max(1, min(400, $days));

    $exp = time() + $days * 86400;
    $payload = [
        'v' => 1,
        'tier' => 'pro',
        'exp' => $exp,
        'sub' => (string) ($body['order'] ?? ''),
        'plan' => $planName,
    ];

    $token = ms_sign($payload);
    $id = ms_key_id($token);

    $record = [
        'id' => $id,
        'plan' => $planName,
        'days' => $days,
        'exp' => $exp,
        'order' => $payload['sub'],
        'created' => date('c'),
        'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
    ];
    @file_put_contents(
        ms_data_dir() . '/issued.log',
        json_encode($record, JSON_UNESCAPED_UNICODE) . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );

    return [
        'key' => $token,
        'exp' => $exp,
        'tier' => 'pro',
        'id' => $id,
        'days' => $days,
        'plan' => $planName,
        'price' => (int) $plan['price'],
    ];
}

// ---------------------------------------------------------------------------
// Онлайн-оплата: HTTP-клиент, ЮKassa, письма, идемпотентность платежей.
// Внешних библиотек нет — только cURL (или поток, если cURL выключен) и mail().
// ---------------------------------------------------------------------------

function ms_log_line(string $file, array $record): void
{
    @file_put_contents(
        ms_data_dir() . '/' . $file,
        json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );
}

function ms_plan_title(string $planName): string
{
    return $planName === 'year' ? 'Год' : 'Месяц';
}

// Рубли -> «199.00» для ЮKassa (сумма всегда строкой с двумя знаками).
function ms_money(int $rub): string
{
    return number_format($rub, 2, '.', '');
}

// «199.00» -> 19900 копеек. Через копейки сравниваем без плавающей точки.
function ms_money_to_kopecks($value): int
{
    return (int) round(((float) str_replace([' ', ','], ['', '.'], (string) $value)) * 100);
}

function ms_uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

// Единый HTTP-вызов с JSON: возвращает status, data (массив), raw и error.
function ms_http_json(string $method, string $url, array $headers = [], ?array $payload = null, int $timeout = 20): array
{
    $body = $payload === null ? null : json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $lines = [];
    foreach ($headers as $name => $value) {
        $lines[] = $name . ': ' . $value;
    }
    if ($body !== null && !isset($headers['Content-Type'])) {
        $lines[] = 'Content-Type: application/json';
    }

    $raw = false;
    $status = 0;
    $error = null;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($raw === false) {
            $error = curl_error($ch) ?: 'ошибка соединения';
        }
        // curl_close() не нужен с PHP 8.0, а в 8.5 ещё и устарел — дескриптор освобождается сам.
    } else {
        $context = stream_context_create(['http' => [
            'method' => $method,
            'header' => implode("\r\n", $lines),
            'content' => $body ?? '',
            'timeout' => $timeout,
            'ignore_errors' => true,
        ]]);
        $raw = @file_get_contents($url, false, $context);
        if ($raw === false) {
            $error = 'нет соединения (cURL выключен, поток не открылся)';
        }
        // PHP 8.5 убрал локальную $http_response_header — берём заголовки новой функцией.
        $responseHeaders = function_exists('http_get_last_response_headers')
            ? (http_get_last_response_headers() ?: [])
            : ($http_response_header ?? []);
        if (!empty($responseHeaders[0]) && preg_match('/\s(\d{3})\s/', $responseHeaders[0], $match)) {
            $status = (int) $match[1];
        }
    }

    $data = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;

    return [
        'status' => $status,
        'data' => is_array($data) ? $data : [],
        'raw' => is_string($raw) ? $raw : '',
        'error' => $error,
    ];
}

function ms_yookassa_ready(): bool
{
    $cfg = ms_config()['yookassa'];
    return $cfg['shop_id'] !== '' && $cfg['secret_key'] !== '';
}

function ms_yookassa_request(string $method, string $path, ?array $payload = null, ?string $idempotenceKey = null): array
{
    $cfg = ms_config()['yookassa'];
    $headers = [
        'Authorization' => 'Basic ' . base64_encode($cfg['shop_id'] . ':' . $cfg['secret_key']),
        'Accept' => 'application/json',
    ];
    if ($idempotenceKey !== null) {
        $headers['Idempotence-Key'] = $idempotenceKey;
    }

    return ms_http_json($method, $cfg['api_url'] . $path, $headers, $payload, (int) $cfg['timeout']);
}

// Какой провайдер принимает деньги: yookassa | yoomoney | '' (не настроен).
function ms_provider(): string
{
    $cfg = ms_config();
    $choice = (string) ($cfg['provider'] ?? 'auto');
    if ($choice === 'yookassa' || $choice === 'yoomoney') {
        return $choice;
    }
    if (ms_yookassa_ready()) {
        return 'yookassa';
    }
    if (ms_yoomoney_ready()) {
        return 'yoomoney';
    }
    return '';
}

// ЮMoney-кошельку API-ключи не нужны: достаточно номера кошелька и секрета уведомлений.
function ms_yoomoney_ready(): bool
{
    $cfg = ms_config()['yoomoney'];
    return $cfg['receiver'] !== '' && $cfg['secret'] !== '';
}

// Подпись уведомления ЮMoney: HMAC-SHA256 по строке key=rawurlencode(value)&…
// Параметры сортируются по алфавиту, сам sign в подпись не входит.
function ms_yoomoney_sign(array $params, string $secret): string
{
    unset($params['sign']);
    ksort($params, SORT_STRING);
    $parts = [];
    foreach ($params as $key => $value) {
        $parts[] = $key . '=' . rawurlencode((string) $value);
    }
    return hash_hmac('sha256', implode('&', $parts), $secret);
}

function ms_yoomoney_verify(array $params, string $secret): bool
{
    $sign = strtolower(trim((string) ($params['sign'] ?? '')));
    if ($sign === '' || $secret === '') {
        return false;
    }
    return hash_equals(ms_yoomoney_sign($params, $secret), $sign);
}

// Метка платежа, которую вернёт ЮMoney в уведомлении (до 64 символов).
function ms_payment_label(): string
{
    return 'MS-' . bin2hex(random_bytes(8));
}

// ЮKassa вернула ошибку про чек — значит фискализация у магазина не настроена. Пробуем без чека.
function ms_is_receipt_error(array $data): bool
{
    $text = ($data['code'] ?? '') . ' ' . ($data['description'] ?? '') . ' ' . ($data['parameter'] ?? '');
    $text = function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
    foreach (['receipt', 'vat', '54-фз', '54fz', 'чек', 'fiscal', 'payment_subject', 'payment_mode'] as $needle) {
        if (strpos($text, $needle) !== false) {
            return true;
        }
    }
    return false;
}

// Ограничение частоты по IP: не больше $limit событий за $window секунд.
function ms_rate_limit(string $bucket, int $limit, int $window = 3600): bool
{
    if ($limit <= 0) {
        return true;
    }

    $dir = ms_data_dir() . '/throttle';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $file = $dir . '/' . preg_replace('/[^a-z0-9]/i', '', $bucket) . '.json';
    $now = time();
    $list = [];
    if (is_file($file)) {
        $decoded = json_decode((string) @file_get_contents($file), true);
        $list = is_array($decoded) ? $decoded : [];
    }

    $list = array_values(array_filter($list, static function ($stamp) use ($now, $window) {
        return is_int($stamp) && $stamp > $now - $window;
    }));

    if (count($list) >= $limit) {
        return false;
    }

    $list[] = $now;
    @file_put_contents($file, json_encode($list), LOCK_EX);
    return true;
}

// Письмо в UTF-8 через mail(). transport=log — только запись в журнал (тесты, отладка).
function ms_mail_send(string $to, string $subject, string $text, string $replyTo = ''): bool
{
    $cfg = ms_config()['mail'];
    $to = trim($to);
    $ok = false;
    $error = '';

    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        $error = 'некорректный адрес получателя';
    } elseif ($cfg['transport'] === 'log') {
        $ok = true;
    } elseif (!function_exists('mail')) {
        $error = 'функция mail() недоступна на хостинге';
    } else {
        $fromName = '=?UTF-8?B?' . base64_encode($cfg['from_name']) . '?=';
        $headers = [
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            'From: ' . $fromName . ' <' . $cfg['from'] . '>',
        ];
        $reply = $replyTo !== '' ? $replyTo : (string) $cfg['reply_to'];
        if ($reply !== '') {
            $headers[] = 'Reply-To: ' . $reply;
        }
        $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $encodedBody = chunk_split(base64_encode($text), 76, "\r\n");

        $ok = @mail($to, $encodedSubject, $encodedBody, implode("\r\n", $headers));
        if (!$ok) {
            $error = 'mail() вернул ошибку';
        }
    }

    ms_log_line('mail.log', [
        'to' => $to,
        'subject' => $subject,
        'transport' => $cfg['transport'],
        'ok' => $ok,
        'error' => $error,
        'created' => date('c'),
    ]);

    return $ok;
}

// --- Учёт платежей: одна JSON-запись на платёж, повторный webhook не выдаёт второй ключ ---

function ms_payments_dir(): string
{
    $dir = ms_data_dir() . '/payments';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function ms_payment_path(string $id): string
{
    return ms_payments_dir() . '/' . preg_replace('/[^A-Za-z0-9_-]/', '', $id) . '.json';
}

function ms_payment_load(string $id): ?array
{
    $file = ms_payment_path($id);
    if (!is_file($file)) {
        return null;
    }
    $data = json_decode((string) @file_get_contents($file), true);
    return is_array($data) ? $data : null;
}

function ms_payment_save(string $id, array $record): void
{
    $file = ms_payment_path($id);
    $json = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    $tmp = $file . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) !== false && @rename($tmp, $file)) {
        return;
    }
    @unlink($tmp);
    @file_put_contents($file, $json, LOCK_EX);
}

// true — запись создали мы, false — платёж уже обрабатывается/обработан.
function ms_payment_claim(string $id, array $record): bool
{
    $file = ms_payment_path($id);
    $handle = @fopen($file, 'x');
    if ($handle === false) {
        return false;
    }
    fwrite($handle, json_encode($record, JSON_UNESCAPED_UNICODE));
    fclose($handle);
    return true;
}

function ms_order_label(string $paymentId): string
{
    return 'ЮK-' . $paymentId;
}

// Текст письма покупателю. $record = запись платежа с ключом.
function ms_key_email_text(array $record): string
{
    $until = date('d.m.Y', (int) $record['exp']);
    $title = ms_plan_title((string) $record['plan']);
    $admin = ms_config()['mail']['admin'];

    return "Здравствуйте!\n\n"
        . "Оплата получена — спасибо. Ваш ключ доступа к «Маркет-Снайперу»:\n\n"
        . $record['key'] . "\n\n"
        . "Тариф: " . $title . " (" . (int) $record['days'] . " дн.), действует до " . $until . ".\n\n"
        . "Как включить полную версию:\n"
        . "1. Нажмите на иконку «Маркет-Снайпер» на панели браузера.\n"
        . "2. Вставьте ключ в поле «Ключ доступа» и нажмите «ОК».\n"
        . "3. Бейдж с чистой прибылью появится на карточках Яндекс.Маркета.\n\n"
        . "Ключ привязан к сроку, а не к устройству: его можно ввести и на другом компьютере.\n"
        . "Если письмо попало в спам — добавьте наш адрес в контакты, следующие письма будут рядом.\n\n"
        . "Вопросы и возврат в течение 7 дней: " . $admin . "\n"
        . "Номер платежа: " . $record['payment_id'] . "\n\n"
        . "--\n"
        . "Маркет-Снайпер · " . ms_config()['site_url'] . "\n"
        . "Самозанятый Воробьев Евгений Александрович, ИНН 422194497805\n";
}

// Отправляет ключ покупателю и копию администратору. Возвращает true, если письмо покупателю ушло.
function ms_deliver_key(array $record): bool
{
    $cfg = ms_config()['mail'];
    $to = (string) ($record['email'] ?? '');
    $sent = ms_mail_send($to, 'Ваш ключ доступа — Маркет-Снайпер', ms_key_email_text($record));

    $adminText = "Новая оплата «Маркет-Снайпер».\n\n"
        . "Сумма: " . (int) $record['amount'] . " ₽\n"
        . "Тариф: " . ms_plan_title((string) $record['plan']) . " (" . (int) $record['days'] . " дн.)\n"
        . "Покупатель: " . ($to !== '' ? $to : 'адрес не указан') . "\n"
        . "Платёж: " . $record['payment_id'] . "\n"
        . "Ключ: " . $record['key'] . "\n"
        . "Действует до: " . date('d.m.Y', (int) $record['exp']) . "\n\n"
        . "Чек НПД: убедитесь, что провайдер передал его в «Мой налог».\n";

    ms_mail_send((string) $cfg['admin'], 'Оплата ' . (int) $record['amount'] . ' ₽ — ключ выдан', $adminText);

    return $sent;
}

// ЮKassa ждёт любой 200 — тогда уведомление не повторяется.
function ms_webhook_ok(): void
{
    http_response_code(200);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'OK';
    exit;
}

function ms_webhook_bad(int $status, string $message): void
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

// Обработка HTTP-уведомления ЮMoney (перевод на кошелёк).
// Подпись sign — HMAC-SHA256 с секретом из настроек уведомлений кошелька.
function ms_handle_yoomoney_notification(array $data): void
{
    $cfg = ms_config();
    $ym = $cfg['yoomoney'];

    ms_log_line('payments.log', [
        'status' => 'yoomoney_notification',
        'notification_type' => (string) ($data['notification_type'] ?? ''),
        'operation_id' => (string) ($data['operation_id'] ?? ''),
        'label' => (string) ($data['label'] ?? ''),
        'amount' => (string) ($data['amount'] ?? ''),
        'created' => date('c'),
    ]);

    if ((string) $ym['secret'] === '') {
        ms_webhook_bad(503, 'no secret');
    }

    if (!ms_yoomoney_verify($data, (string) $ym['secret'])) {
        ms_log_line('payments.log', ['status' => 'yoomoney_bad_sign', 'label' => (string) ($data['label'] ?? ''), 'created' => date('c')]);
        ms_webhook_bad(403, 'bad sign');
    }

    $type = (string) ($data['notification_type'] ?? '');
    if (!in_array($type, ['p2p-incoming', 'card-incoming'], true)) {
        return;
    }

    $label = (string) ($data['label'] ?? '');
    if (!preg_match('/^MS-[A-Za-z0-9]{6,48}$/', $label)) {
        ms_log_line('payments.log', ['status' => 'yoomoney_bad_label', 'label' => $label, 'created' => date('c')]);
        return;
    }

    $record = ms_payment_load($label);
    if (!$record) {
        ms_log_line('payments.log', ['status' => 'yoomoney_unknown_label', 'label' => $label, 'created' => date('c')]);
        return;
    }

    // Повтор уведомления: ключ уже выдан — второй не выпускаем, письмо досылаем.
    if (!empty($record['key'])) {
        if (empty($record['mailSent'])) {
            $record['mailSent'] = ms_deliver_key($record);
            ms_payment_save($label, $record);
        }
        return;
    }

    if ((string) ($data['codepro'] ?? 'false') === 'true' || (string) ($data['unaccepted'] ?? 'false') === 'true') {
        ms_log_line('payments.log', ['status' => 'yoomoney_held', 'label' => $label, 'created' => date('c')]);
        return;
    }

    if ((string) ($data['currency'] ?? '') !== '643') {
        ms_log_line('payments.log', ['status' => 'yoomoney_bad_currency', 'label' => $label, 'created' => date('c')]);
        return;
    }

    // С получателя удерживается комиссия, поэтому сравниваем с порогом, а не с точной суммой.
    $paidKopecks = ms_money_to_kopecks($data['amount'] ?? '0');
    $expectedKopecks = (int) $record['amount'] * 100;
    $minKopecks = (int) floor($expectedKopecks * (float) $ym['min_amount_ratio']);

    if ($paidKopecks < $minKopecks) {
        ms_log_line('payments.log', [
            'status' => 'yoomoney_amount_mismatch',
            'label' => $label,
            'paid' => (string) ($data['amount'] ?? ''),
            'expected' => ms_money((int) $record['amount']),
            'created' => date('c'),
        ]);
        ms_mail_send(
            (string) $cfg['mail']['admin'],
            'Маркет-Снайпер: перевод меньше тарифа',
            "Пришёл перевод по метке " . $label . ", но сумма меньше цены тарифа.\n\n"
            . "Тариф: " . ms_plan_title((string) $record['plan']) . " (" . (int) $record['amount'] . " ₽)\n"
            . "Зачислено: " . (string) ($data['amount'] ?? '?') . " ₽\n"
            . "Покупатель: " . (string) ($record['email'] ?? '') . "\n\n"
            . "Ключ автоматически не выдан. Проверьте перевод в истории кошелька.\n"
        );
        return;
    }

    $claim = [
        'status' => 'processing',
        'provider' => 'yoomoney',
        'payment_id' => $label,
        'plan' => (string) $record['plan'],
        'days' => (int) $record['days'],
        'amount' => (int) $record['amount'],
        'email' => (string) ($record['email'] ?? ''),
        'operation_id' => (string) ($data['operation_id'] ?? ''),
        'startedTs' => time(),
        'started' => date('c'),
    ];
    if (!ms_payment_claim($label, $claim)) {
        $again = ms_payment_load($label) ?: [];
        if (!empty($again['key']) || (int) ($again['startedTs'] ?? 0) > time() - 120) {
            return;
        }
        ms_payment_save($label, $claim);
    }

    $operationId = (string) ($data['operation_id'] ?? '');
    $issued = ms_issue(['plan' => (string) $record['plan'], 'order' => 'YM-' . $operationId]);

    $paid = [
        'status' => 'paid',
        'provider' => 'yoomoney',
        'payment_id' => $label,
        'plan' => (string) $record['plan'],
        'days' => $issued['days'],
        'amount' => (int) $record['amount'],
        'paid_amount' => round($paidKopecks / 100, 2),
        'email' => (string) ($record['email'] ?? ''),
        'operation_id' => $operationId,
        'key' => $issued['key'],
        'key_id' => $issued['id'],
        'exp' => $issued['exp'],
        'paid_at' => (string) ($data['datetime'] ?? date('c')),
        'mailSent' => false,
    ];
    $paid['mailSent'] = ms_deliver_key($paid);
    ms_payment_save($label, $paid);

    ms_log_line('payments.log', [
        'status' => 'paid',
        'provider' => 'yoomoney',
        'payment_id' => $label,
        'operation_id' => $operationId,
        'plan' => (string) $record['plan'],
        'amount' => (int) $record['amount'],
        'paid_amount' => $paid['paid_amount'],
        'email' => (string) ($record['email'] ?? ''),
        'key_id' => $issued['id'],
        'mail' => $paid['mailSent'],
        'created' => date('c'),
    ]);

    if (!$paid['mailSent']) {
        ms_log_line('payments.log', [
            'status' => 'mail_failed',
            'provider' => 'yoomoney',
            'payment_id' => $label,
            'email' => (string) ($record['email'] ?? ''),
            'created' => date('c'),
        ]);
    }
}
