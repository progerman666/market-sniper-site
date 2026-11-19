# set-domain.ps1 — переключение адреса сайта одной командой.
# Меняет ссылку на покупку в расширении, canonical в лендинге, e-mail (по флагу)
# и пересобирает оба архива. Нужно при переезде: поддомен → купленный домен.
#
# Примеры:
#   .\set-domain.ps1 -Domain "sniper.old-domain.ru"
#   .\set-domain.ps1 -Domain "sniper-market.ru" -Email "hello@sniper-market.ru"

param(
    [Parameter(Mandatory = $true)][string]$Domain,
    [string]$Email,
    [switch]$NoRebuild
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# нормализуем адрес
$Domain = $Domain.Trim().ToLower()
$Domain = $Domain -replace '^https?://', ''
$Domain = $Domain.Trim('/')
if ($Domain -notmatch '^[a-z0-9.\-]+\.[a-zа-я]{2,}$') { throw "Похоже, это не домен: $Domain" }

$url = 'https://' + $Domain
$purchaseUrl = $url + '/buy.html'
Write-Host "Домен: $Domain"
Write-Host "Ссылка на покупку в расширении: $purchaseUrl"

# 1. Расширение
$licensePath = Join-Path $root 'extension\license.js'
$license = Get-Content -LiteralPath $licensePath -Raw -Encoding UTF8
$license = [regex]::Replace($license, "PURCHASE_URL:\s*'[^']*'", "PURCHASE_URL: '$purchaseUrl'")
$license = [regex]::Replace($license, "purchaseUrl:\s*'[^']*'", "purchaseUrl: '$purchaseUrl'")
Set-Content -LiteralPath $licensePath -Value $license -Encoding UTF8 -NoNewline
Write-Host '  + extension\license.js обновлён'

# 2. Адреса покупки в попапе/бейдже берутся из license.js, отдельных правок не нужно
$siteFiles = Get-ChildItem -LiteralPath (Join-Path $root 'site') -Filter '*.html' -File
foreach ($file in $siteFiles) {
    $html = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    $original = $html

    if ($file.Name -eq 'index.html') {
        $html = [regex]::Replace($html, '<link rel="canonical"[^>]*>\s*', '')
        $canonical = '<link rel="canonical" href="' + $url + '/">'
        $html = $html.Replace('<link rel="icon" href="img/icon.png">', '<link rel="icon" href="img/icon.png">' + "`r`n" + $canonical)
    }

    if ($Email) {
        # заменяем любой e-mail (в mailto: и в тексте), а не только конкретную заглушку
        $html = [regex]::Replace($html, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', $Email)
    }

    if ($html -ne $original) {
        Set-Content -LiteralPath $file.FullName -Value $html -Encoding UTF8 -NoNewline
        Write-Host "  + site\$($file.Name) обновлён"
    }
}

if ($NoRebuild) {
    Write-Host 'Архивы не пересобирались (-NoRebuild).'
    exit 0
}

# 3. Пересборка архива расширения (для download на сайте и для магазина)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$extDir = Join-Path $root 'extension'
$extVersion = [string](Get-Content -LiteralPath (Join-Path $extDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $extVersion) { throw 'Не удалось прочитать version из extension\manifest.json' }
$extZip = Join-Path $root ("dist\market-sniper-$extVersion.zip")
if (Test-Path $extZip) { Remove-Item -LiteralPath $extZip -Force }
$zip = [System.IO.Compression.ZipFile]::Open($extZip, 'Create')
try {
    foreach ($rel in @('manifest.json', 'background.js', 'content.js', 'rates.js', 'license.js', 'popup.html', 'popup.js',
                       '_locales/ru/messages.json',
                       'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png')) {
        $src = Join-Path $extDir ($rel.Replace('/', '\'))
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, $rel) | Out-Null
    }
} finally { $zip.Dispose() }
Write-Host ('  + dist\market-sniper-' + $extVersion + '.zip пересобран (' + [math]::Round((Get-Item $extZip).Length / 1KB, 1) + ' КБ)')

Copy-Item -LiteralPath $extZip -Destination (Join-Path $root ("site\download\market-sniper-$extVersion.zip")) -Force
Write-Host '  + копия положена в site\download\'

# 4. Пересборка архива сайта (пути с прямыми слэшами, без README)
$siteDir = Join-Path $root 'site'
$siteZip = Join-Path $root 'dist\site-rucenter.zip'
if (Test-Path $siteZip) { Remove-Item -LiteralPath $siteZip -Force }
$zip = [System.IO.Compression.ZipFile]::Open($siteZip, 'Create')
try {
    $files = Get-ChildItem -LiteralPath $siteDir -Recurse -File | Where-Object { $_.Name -ne 'README.md' }
    foreach ($file in $files) {
        $rel = $file.FullName.Substring($siteDir.Length + 1).Replace('\', '/')
        $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        $input = [System.IO.File]::OpenRead($file.FullName)
        $input.CopyTo($stream)
        $input.Dispose()
        $stream.Dispose()
    }
} finally { $zip.Dispose() }
Write-Host ('  + dist\site-rucenter.zip пересобран (' + [math]::Round((Get-Item $siteZip).Length / 1KB, 1) + ' КБ)')

Write-Host ''
Write-Host 'Готово. Дальше: залить site\ на хостинг (.\deploy-rucenter.ps1) и проверить /api/plans.php' -ForegroundColor Green
