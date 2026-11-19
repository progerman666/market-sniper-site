<?php
declare(strict_types=1);
require __DIR__ . '/helpers.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    ms_json_out([]);
}

$cfg = ms_config();
$plans = [];
foreach ($cfg['plans'] as $name => $plan) {
    $plans[] = [
        'plan' => $name,
        'days' => (int) $plan['days'],
        'price' => (int) $plan['price'],
        'currency' => 'RUB',
    ];
}

ms_json_out(['plans' => $plans]);
