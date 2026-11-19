# build-site-zips.ps1 — пересборка архивов сайта из папки site\.
#
# Нужен потому, что set-domain.ps1 обновляет только dist\site-rucenter.zip,
# а dist\site-pages.zip (для GitHub Pages) легко забыть — и в архиве остаются
# старые заглушки вроде test@demo.ru.
#
# Примеры:
#   .\tools\build-site-zips.ps1
#   .\tools\build-site-zips.ps1 -Cname "sniper.example.ru"

param(
    [string]$Cname = 'sniper.gadget-nakhodki.ru'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$siteDir = Join-Path $root 'site'
$distDir = Join-Path $root 'dist'

if (-not (Test-Path -LiteralPath $siteDir)) { throw "Нет папки: $siteDir" }
if (-not (Test-Path -LiteralPath $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

function Add-Entry($zip, [string]$source, [string]$entryName) {
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    $input = [System.IO.File]::OpenRead($source)
    try { $input.CopyTo($stream) } finally { $input.Dispose(); $stream.Dispose() }
}

function New-SiteZip([string]$zipPath, [bool]$forPages, [string]$cname) {
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')

    try {
        # корневые файлы сайта (README.md в архив не входит)
        $rootFiles = Get-ChildItem -LiteralPath $siteDir -File | Sort-Object Name
        foreach ($file in $rootFiles) {
            if ($file.Name -eq 'README.md') { continue }
            Add-Entry $zip $file.FullName $file.Name
        }

        # api\ — только для платного хостинга, на GitHub Pages PHP нет
        if (-not $forPages) {
            $apiDir = Join-Path $siteDir 'api'
            if (Test-Path -LiteralPath $apiDir) {
                $apiFiles = Get-ChildItem -LiteralPath $apiDir -Recurse -File | Sort-Object FullName
                foreach ($file in $apiFiles) {
                    # Журналы, платежи и троттлинг — данные хостинга, в архив их не кладём.
                    # Исключение — api\data\.htaccess: он должен закрывать каталог сразу после распаковки.
                    if ($file.FullName -match '\\api\\data\\' -and $file.Name -ne '.htaccess') { continue }
                    $rel = $file.FullName.Substring($siteDir.Length + 1).Replace('\', '/')
                    Add-Entry $zip $file.FullName $rel
                }
            }
        }

        # download\, img\ и js\ — в обоих вариантах
        foreach ($sub in @('download', 'img', 'js')) {
            $dir = Join-Path $siteDir $sub
            if (-not (Test-Path -LiteralPath $dir)) { continue }
            foreach ($file in (Get-ChildItem -LiteralPath $dir -Recurse -File | Sort-Object FullName)) {
                $rel = $file.FullName.Substring($siteDir.Length + 1).Replace('\', '/')
                Add-Entry $zip $file.FullName $rel
            }
        }

        # CNAME — только для GitHub Pages
        if ($forPages) {
            $entry = $zip.CreateEntry('CNAME', [System.IO.Compression.CompressionLevel]::Optimal)
            $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
            try { $writer.Write($cname) } finally { $writer.Dispose() }
        }
    } finally { $zip.Dispose() }

    $size = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 1)
    Write-Host ("  + " + (Split-Path -Leaf $zipPath) + " ($size КБ)")
}

Write-Host 'Сборка архивов сайта из site\:'
New-SiteZip (Join-Path $distDir 'site-pages.zip') $true $Cname
New-SiteZip (Join-Path $distDir 'site-rucenter.zip') $false ''

Write-Host ''
Write-Host 'Готово. site-pages.zip — для GitHub Pages (CNAME '$Cname', без api\), site-rucenter.zip — для public_html.' -ForegroundColor Green
