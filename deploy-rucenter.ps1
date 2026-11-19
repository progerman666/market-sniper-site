# deploy-rucenter.ps1 — загрузка сайта на хостинг Ru-Center по FTP/FTPS.
# Работает через встроенный curl.exe (Windows 10/11), WinSCP не нужен.
#
# Пример:
#   .\deploy-rucenter.ps1 -FtpHost "server12.hosting.reg.ru" -User "u1234567" `
#       -Password "пароль" -RemotePath "/www/market-sniper.ru/public_html"
#
# Перед запуском уточните в панели Ru-Center: «Хостинг → Доступ по FTP»
# (хост, логин, пароль) и путь к каталогу сайта (обычно /www/<домен>/public_html).

param(
    [Parameter(Mandatory = $true)][string]$FtpHost,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Password,
    [Parameter(Mandatory = $true)][string]$RemotePath,
    [string]$LocalPath = (Join-Path $PSScriptRoot 'site'),
    [switch]$Insecure,
    [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $LocalPath)) { throw "Нет локальной папки: $LocalPath" }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw 'Не найден curl.exe' }

$RemotePath = '/' + $RemotePath.Trim('/')
$baseUrl = 'ftp://' + $FtpHost
$common = @('--ssl-reqd', '--ftp-pasv', '--ftp-create-dirs', '--silent', '--show-error')
if ($Insecure) { $common += '--insecure' }

# api\data — журналы и платежи продакшена: локальные тестовые записи туда заливать нельзя,
# поэтому отправляем только .htaccess, который закрывает каталог.
$files = Get-ChildItem -LiteralPath $LocalPath -Recurse -File | Where-Object {
    $_.Name -ne 'README.md' -and -not ($_.FullName -match '\\api\\data\\' -and $_.Name -ne '.htaccess')
}
$total = $files.Count
$i = 0

Write-Host "Файлов к загрузке: $total"
Write-Host "Куда: $baseUrl$RemotePath"

foreach ($file in $files) {
    $i++
    $rel = $file.FullName.Substring($LocalPath.Length + 1).Replace('\', '/')
    $url = $baseUrl + $RemotePath + '/' + $rel

    if ($WhatIfOnly) {
        Write-Host ("[{0}/{1}] {2}" -f $i, $total, $rel)
        continue
    }

    $curlArgs = $common + @('--user', "$User`:$Password", '--upload-file', $file.FullName, $url)
    & curl.exe @curlArgs
    if ($LASTEXITCODE -ne 0) { throw "Ошибка загрузки: $rel (curl $LASTEXITCODE)" }
    Write-Host ("[{0}/{1}] {2}" -f $i, $total, $rel)
}

if ($WhatIfOnly) {
    Write-Host 'Режим проверки: ничего не загружено.'
    exit 0
}

Write-Host 'Проверяю доступность сайта...'
$check = curl.exe --silent --show-error --output NUL --write-out '%{http_code}' ($baseUrl.Replace('ftp://', 'https://') + '/api/plans.php')
Write-Host "HTTP /api/plans.php -> $check"
Write-Host 'Готово. Если код 200 — сайт и API на месте.' -ForegroundColor Green
