<?php
// Настройки API «Маркет-Снайпер». Файл закрыт .htaccess — не отдаётся в браузер.
// Дополнительная защита на случай сервера без .htaccess:
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

$adminSecret = getenv('MS_ADMIN_SECRET');

// Флаги удобнее задавать строкой: MS_SEND_RECEIPT=1 / MS_SEND_RECEIPT=0.
$envBool = static function (string $name, bool $default): bool {
    $value = getenv($name);
    if ($value === false || $value === '') {
        return $default;
    }
    return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on'], true);
};

// Адрес сайта вычисляем из запроса: работает и в корне домена, и в подпапке,
// и на локальном php -S. Переопределяется переменной MS_SITE_URL.
$scheme = 'http';
if ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')) {
    $scheme = 'https';
}
$host = (string) ($_SERVER['HTTP_HOST'] ?? 'sniper.gadget-nakhodki.ru');
$basePath = str_replace('\\', '/', dirname(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/pay.php'))));
$basePath = ($basePath === '/' || $basePath === '.') ? '' : rtrim($basePath, '/');
$siteUrl = rtrim(getenv('MS_SITE_URL') ?: ($scheme . '://' . $host . $basePath), '/');

return [
    // Базовый адрес сайта — для писем и redirect после оплаты.
    'site_url' => $siteUrl,
    // Пароль для выдачи ключей. Обязательно замените перед публикацией!
    'admin_secret' => $adminSecret !== false && $adminSecret !== '' ? $adminSecret : 'ЗАМЕНИТЕ_ЭТОТ_ПАРОЛЬ',

    // Приватный ключ подписи (ECDSA P-256). Лежит вне веб-доступа (.htaccess), лучше — вообще вне public_html.
    'private_key_path' => getenv('MS_PRIVATE_KEY_PATH') ?: __DIR__ . '/keys/private.pem',

    // Куда писать журнал выдачи и список отозванных ключей.
    'data_dir' => getenv('MS_DATA_DIR') ?: __DIR__ . '/data',

    // Кто принимает деньги: auto (ЮKassa, если есть её секрет, иначе ЮMoney), yookassa или yoomoney.
    'provider' => getenv('MS_PROVIDER') ?: 'auto',

    // ЮKassa: онлайн-оплата картой и по СБП, после неё ключ уходит письмом автоматически.
    // shop_id не секрет, его можно держать здесь; secret_key — только из переменной окружения.
    // В панели ЮKassa: Настройки → API-ключи → «Выпустить ключ» (боевой) или тестовый магазин.
    'yookassa' => [
        // shopId магазина ЮKassa — число вида 100500 из кабинета yookassa.ru.
        // Номер кошелька ЮMoney (41001…) сюда не подходит: это разные продукты.
        'shop_id' => getenv('MS_YOOKASSA_SHOP_ID') ?: '1529556',
        // Секрет — только из окружения хостинга: в файлах репозитория его быть не должно.
        // Без MS_YOOKASSA_SECRET_KEY онлайн-оплата отключается, сайт предлагает СБП/ЮMoney.
        'secret_key' => getenv('MS_YOOKASSA_SECRET_KEY') ?: '',
        'api_url' => rtrim(getenv('MS_YOOKASSA_API_URL') ?: 'https://api.yookassa.ru/v3', '/'),
        'return_url' => getenv('MS_RETURN_URL') ?: ($siteUrl . '/thanks.html'),
        'timeout' => (int) (getenv('MS_YOOKASSA_TIMEOUT') ?: 20),

        // Чек для 54-ФЗ. Для самозанятого (НПД) должен быть включён, если ЮKassa передаёт чеки
        // в «Мой налог». Если фискализация не настроена, pay.php сам повторит запрос без чека.
        'send_receipt' => $envBool('MS_SEND_RECEIPT', true),
        'vat_code' => (int) (getenv('MS_RECEIPT_VAT_CODE') ?: 1), // 1 = без НДС
        'payment_subject' => 'service',
        'payment_mode' => 'full_payment',
    ],

    // ЮMoney-кошелёк: форма быстрой оплаты + HTTP-уведомления. API-ключи не нужны —
    // только номер кошелька и секрет уведомлений из настроек кошелька.
    'yoomoney' => [
        'receiver' => getenv('MS_YOOMONEY_RECEIVER') ?: '4100119685733916',
        'secret' => getenv('MS_YOOMONEY_SECRET') ?: '',
        'success_url' => getenv('MS_YOOMONEY_SUCCESS_URL') ?: ($siteUrl . '/thanks.html'),
        'payment_type' => getenv('MS_YOOMONEY_PAYMENT_TYPE') ?: 'AC', // AC — карта, PC — кошелёк
        // С получателя удерживается комиссия (карта ~3%, кошелёк ~1%), поэтому зачисление
        // меньше суммы заказа. Принимаем оплату не ниже 95% цены тарифа.
        'min_amount_ratio' => (float) (getenv('MS_YOOMONEY_MIN_RATIO') ?: 0.95),
    ],

    // Письма с ключами. transport=log — письма не отправляются, а пишутся в data/mail.log (для тестов).
    'mail' => [
        'transport' => getenv('MS_MAIL_TRANSPORT') ?: 'mail',
        'from' => getenv('MS_MAIL_FROM') ?: 'no-reply@sniper.gadget-nakhodki.ru',
        'from_name' => getenv('MS_MAIL_FROM_NAME') ?: 'Маркет-Снайпер',
        'admin' => getenv('MS_MAIL_ADMIN') ?: 'goinslims@gmail.com',
        'reply_to' => getenv('MS_MAIL_REPLY_TO') ?: 'goinslims@gmail.com',
    ],

    // Сколько платежей можно создать с одного IP за час (защита от мусорных запросов).
    'pay_rate_limit' => (int) (getenv('MS_PAY_RATE_LIMIT') ?: 10),

    // Стартовая цена: поднимаем по мере роста установок и рейтинга.
    'plans' => [
        'month' => ['days' => 30, 'price' => 199],
        'year' => ['days' => 365, 'price' => 1990],
    ],
];
