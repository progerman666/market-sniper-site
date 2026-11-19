<?php
declare(strict_types=1);
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    ms_json_out([]);
}
if ($method !== 'POST') {
    ms_json_out(['error' => 'нужен POST'], 405);
}

$cfg = ms_config();
$body = ms_body();
$secret = $_SERVER['HTTP_X_ADMIN_SECRET'] ?? (string) ($body['secret'] ?? '');

if (!is_string($secret) || !hash_equals((string) $cfg['admin_secret'], $secret)) {
    ms_json_out(['error' => 'нет доступа'], 401);
}

ms_json_out(ms_issue($body));
