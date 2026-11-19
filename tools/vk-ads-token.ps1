# vk-ads-token.ps1 — получить access_token VK Рекламы и сохранить его вне репозитория.
#
# client_id и client_secret выдаёт кабинет: ads.vk.ru → Настройки → Доступ к API.
# Секрет показывается один раз и живёт 10 минут — держите вкладку открытой.
# Токен действует 24 часа (expires_in=86400), а если его не обновлять месяц — VK его удалит.
#
# Примеры:
#   .\tools\vk-ads-token.ps1
#   .\tools\vk-ads-token.ps1 -ClientId b8kFvHEpqIDZzhNI
#   .\tools\vk-ads-token.ps1 -ClientId b8kFvHEpqIDZzhNI -ClientSecret "…" -NoSave
#
# Секрет никуда не пишется. Токен сохраняется в %USERPROFILE%\.vk-ads-token
# с доступом только текущему пользователю; этот файл лежит вне проекта.

param(
    [string]$ClientId = '',
    [string]$ClientSecret = '',
    [string]$TokenFile = (Join-Path $env:USERPROFILE '.vk-ads-token'),
    [string]$TokenUrl = 'https://ads.vk.ru/api/v2/oauth2/token.json',
    [switch]$NoSave
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Файл реквизитов: строки «ключ = значение» («Client ID = …», «Client secret = …»).
# Тот же формат понимает tools\vk-ads-create.js, поэтому файл можно использовать обоими скриптами.
function Read-CredFile {
    param([string]$Path)
    $creds = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $creds }
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
        if ($line -match '^\s*([^:=]+?)\s*[=:]\s*(.+)$') {
            $key = ($matches[1] -replace '[\s_\-.]', '').ToLower()
            $creds[$key] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $creds
}

# Дописывает access_token в файл реквизитов, сохраняя Client ID и Client secret.
function Save-TokenToFile {
    param([string]$Path, [string]$Token)
    $existing = @()
    if (Test-Path -LiteralPath $Path) { $existing = @(Get-Content -LiteralPath $Path -Encoding UTF8) }
    $isCredFile = $false
    foreach ($line in $existing) {
        if ($line -match '^\s*[^:=]+?\s*[=:]\s*.+$') { $isCredFile = $true; break }
    }
    if (-not $isCredFile) {
        Set-Content -LiteralPath $Path -Value $Token -Encoding ASCII -NoNewline
        return
    }
    $written = $false
    $out = foreach ($line in $existing) {
        if ($line -match '^\s*([^:=]+?)\s*[=:]\s*(.+)$') {
            $key = ($matches[1] -replace '[\s_\-.]', '').ToLower()
            if ($key -eq 'accesstoken' -or $key -eq 'token' -or $key -eq 'vktoken') {
                $written = $true
                "access_token = $Token"
                continue
            }
        }
        $line
    }
    if (-not $written) { $out = @($out) + "access_token = $Token" }
    Set-Content -LiteralPath $Path -Value $out -Encoding UTF8
}

$creds = Read-CredFile -Path $TokenFile
if (-not $ClientId) {
    $ClientId = [string]($creds['clientid'] + $creds['vkid'] + $creds['appid'])
}
if (-not $ClientSecret) {
    $ClientSecret = [string]($creds['clientsecret'] + $creds['secret'])
}
if ($ClientId) { Write-Host ("Реквизиты: " + $TokenFile) }

if (-not $ClientId) {
    $ClientId = (Read-Host 'client_id из кабинета (Настройки → Доступ к API)').Trim()
}
if (-not $ClientId) { throw 'Без client_id токен не выдать.' }

if (-not $ClientSecret) {
    $secure = Read-Host 'client_secret (ввод скрыт)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $ClientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
if (-not $ClientSecret) { throw 'Без client_secret токен не выдать.' }

$body = @{
    grant_type    = 'client_credentials'
    client_id     = $ClientId
    client_secret = $ClientSecret
}

try {
    $response = Invoke-RestMethod -Method Post -Uri $TokenUrl `
        -ContentType 'application/x-www-form-urlencoded' -Body $body -TimeoutSec 40
} catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    $raw = $_.ErrorDetails.Message
    $code = ''
    $description = ''
    if ($raw) {
        try {
            $parsed = $raw | ConvertFrom-Json
            $code = [string]$parsed.error
            $description = [string]$parsed.error_description
        } catch {
            $description = $raw
        }
    }

    Write-Host ''
    $headline = "Ошибка: HTTP $status"
    if ($code) { $headline = "$headline ($code)" }
    Write-Host $headline -ForegroundColor Red
    if ($description) { Write-Host "Ответ VK: $description" }
    switch ($code) {
        'invalid_client' {
            Write-Host 'Подсказка: client_id или client_secret неверны. Секрет действует только 10 минут —' -ForegroundColor Yellow
            Write-Host '            выдайте новый в кабинете и повторите ввод. OAuth-клиент мог быть заблокирован.'
        }
        'unauthorized_client' {
            Write-Host 'Подсказка: у OAuth-клиента нет доступа к схеме client_credentials — напишите на ads_api@vk.team.' -ForegroundColor Yellow
        }
        default {
            Write-Host 'Подсказка: проверьте, что реквизиты кабинета заполнены и проверены модерацией.' -ForegroundColor Yellow
        }
    }
    exit 1
}

if (-not $response.access_token) {
    throw 'VK вернул ответ без access_token — проверьте права доступа к API.'
}

$expiresIn = [int]$response.expires_in
$expiresAt = (Get-Date).AddSeconds($expiresIn)

Write-Host ''
Write-Host 'Токен получен.' -ForegroundColor Green
$scopeText = if ($response.scope) { $response.scope } else { '—' }
Write-Host ("  тип:     " + $response.token_type)
Write-Host ("  scope:   " + $scopeText)
Write-Host ("  действует до: " + $expiresAt.ToString('dd.MM.yyyy HH:mm'))

if ($NoSave) {
    Write-Host ''
    Write-Host $response.access_token
    Write-Host ''
    Write-Host 'Сохранение отключено (-NoSave): передайте токен через переменную VK_ADS_TOKEN.'
    exit 0
}

Save-TokenToFile -Path $TokenFile -Token $response.access_token
try {
    & icacls.exe $TokenFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
} catch {
    Write-Host 'Не удалось сузить права на файл токена (не критично).' -ForegroundColor Yellow
}

Write-Host ("  файл:    " + $TokenFile + ' (только для текущего пользователя)')
Write-Host ''
Write-Host 'Проверка и запуск кампании:'
Write-Host '  node tools\vk-ads-create.js check'
Write-Host '  node tools\vk-ads-create.js packages --filter сайт'
Write-Host '  node tools\vk-ads-create.js create --package <id>'
