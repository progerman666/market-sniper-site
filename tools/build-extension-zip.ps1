# build-extension-zip.ps1 — пересборка пакета расширения из extension\.
#
# Нужен после правок content.js/popup.js/manifest.json: set-domain.ps1 делает
# то же самое, но заодно переписывает домен и архивы сайта.
#
# Примеры:
#   .\tools\build-extension-zip.ps1
#   .\tools\build-extension-zip.ps1 -Version "0.4.0"
#
# Версия по умолчанию берётся из extension\manifest.json, чтобы имя архива
# не разъезжалось с тем, что видит браузер.

param(
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$extDir = Join-Path $root 'extension'
$distDir = Join-Path $root 'dist'

if (-not $Version) {
    $manifest = Get-Content -LiteralPath (Join-Path $extDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = [string]$manifest.version
    if (-not $Version) { throw 'Не удалось прочитать version из extension\manifest.json' }
}

$zipPath = Join-Path $distDir ("market-sniper-$Version.zip")

if (-not (Test-Path -LiteralPath $extDir)) { throw "Нет папки: $extDir" }
if (-not (Test-Path -LiteralPath $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

$files = @(
    'manifest.json',
    'background.js',
    'content.js',
    'rates.js',
    'license.js',
    'popup.html',
    'popup.js',
    '_locales/ru/messages.json',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png'
)

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
    foreach ($rel in $files) {
        $src = Join-Path $extDir ($rel.Replace('/', '\'))
        if (-not (Test-Path -LiteralPath $src)) { throw "Нет файла: $src" }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, $rel) | Out-Null
    }
} finally { $zip.Dispose() }

Copy-Item -LiteralPath $zipPath -Destination (Join-Path $root "site\download\market-sniper-$Version.zip") -Force

$size = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 1)
Write-Host ("Готово: dist\market-sniper-$Version.zip ($size КБ) и копия в site\download\") -ForegroundColor Green
