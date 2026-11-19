<?php
declare(strict_types=1);
require __DIR__ . '/helpers.php';

$token = trim((string) ($_GET['key'] ?? ''));
if ($token === '') {
    $body = ms_body();
    $token = trim((string) ($body['key'] ?? ''));
}
if ($token === '') {
    ms_json_out(['valid' => false, 'reason' => 'нет ключа'], 400);
}

$parts = explode('.', $token);
if (count($parts) !== 3 || $parts[0] !== 'MS1') {
    ms_json_out(['valid' => false, 'reason' => 'неверный формат']);
}

$json = base64_decode(strtr($parts[1], '-_', '+/'), true);
$signature = base64_decode(strtr($parts[2], '-_', '+/'), true);
if ($json === false || $signature === false) {
    ms_json_out(['valid' => false, 'reason' => 'нечитаемый ключ']);
}

$cfg = ms_config();
$pem = @file_get_contents($cfg['private_key_path']);
$privateKey = $pem ? openssl_pkey_get_private($pem) : false;
if (!$privateKey) {
    ms_json_out(['error' => 'на сервере нет ключа подписи'], 500);
}

$details = openssl_pkey_get_details($privateKey);
$publicKey = $details['key'] ?? '';
// В ключе подпись лежит «сырой» (r||s), OpenSSL ждёт DER.
$signatureOk = openssl_verify($json, ms_raw_to_der($signature), $publicKey, OPENSSL_ALGO_SHA256) === 1;

$payload = json_decode($json, true) ?: [];
$id = ms_key_id($token);
$expired = !isset($payload['exp']) || (int) $payload['exp'] < time();
$revoked = ms_is_revoked($id);

ms_json_out([
    'valid' => $signatureOk && !$expired && !$revoked,
    'exp' => isset($payload['exp']) ? (int) $payload['exp'] : null,
    'tier' => $payload['tier'] ?? null,
    'plan' => $payload['plan'] ?? null,
    'id' => $id,
    'reason' => !$signatureOk ? 'подпись не сходится'
        : ($expired ? 'срок истёк' : ($revoked ? 'лицензия отозвана' : null)),
]);
