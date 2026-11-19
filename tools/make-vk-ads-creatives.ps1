# make-vk-ads-creatives.ps1 — креативы для VK Рекламы из демо-бейджа расширения.
#
# Делает два файла под форматы рекламы сайта:
#   promo\vk-ads\creative-1080x607.png   — горизонталь (лента ВК/ОК, рекламная сеть)
#   promo\vk-ads\creative-1080x1080.png  — квадрат (универсальное объявление)
#
# Источник картинки — site\img\badge.png (демо-бейдж «Прибыль с продажи»).
# Цвета взяты из site\styles.css: navy #0b1f3a, gold #f5c451, muted #9fb3cc.
# Скрипт только рисует PNG, в API ничего не отправляет.
#
# Примеры:
#   .\tools\make-vk-ads-creatives.ps1
#   .\tools\make-vk-ads-creatives.ps1 -OutDir "D:\tmp\vk"

param(
    [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'promo\vk-ads' }
$badgePath = Join-Path $root 'site\img\badge.png'

if (-not (Test-Path -LiteralPath $badgePath)) { throw "Нет файла с бейджем: $badgePath" }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$navy = [System.Drawing.ColorTranslator]::FromHtml('#0b1f3a')
$gold = [System.Drawing.ColorTranslator]::FromHtml('#f5c451')
$muted = [System.Drawing.ColorTranslator]::FromHtml('#9fb3cc')
$white = [System.Drawing.Color]::White

function New-PixelFont {
    param([string]$Name, [single]$Size, [System.Drawing.FontStyle]$Style)
    return New-Object System.Drawing.Font($Name, $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
}

function Get-WrappedLines {
    param($Graphics, [string]$Text, $Font, [single]$MaxWidth)
    $lines = New-Object System.Collections.ArrayList
    $current = ''
    foreach ($word in ($Text -split '\s+')) {
        $candidate = if ($current) { "$current $word" } else { $word }
        if ($Graphics.MeasureString($candidate, $Font).Width -le $MaxWidth) {
            $current = $candidate
        } else {
            if ($current) { [void]$lines.Add($current) }
            $current = $word
        }
    }
    if ($current) { [void]$lines.Add($current) }
    return $lines
}

function New-Creative {
    param(
        [int]$Width,
        [int]$Height,
        [string]$Title,
        [string]$Subtitle,
        [string]$Domain,
        [string]$File
    )

    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.Clear($navy)

    $pad = [int][Math]::Round($Width * 0.06)
    $cursorY = [single]$pad

    # Шапка: название продукта слева, домен справа
    $brandFont = New-PixelFont 'Segoe UI Semibold' ([single][Math]::Round($Width * 0.026)) ([System.Drawing.FontStyle]::Bold)
    $goldBrush = New-Object System.Drawing.SolidBrush($gold)
    $mutedBrush = New-Object System.Drawing.SolidBrush($muted)
    $whiteBrush = New-Object System.Drawing.SolidBrush($white)

    $g.DrawString('Маркет-Снайпер', $brandFont, $goldBrush, [single]$pad, $cursorY)
    $brandBox = $g.MeasureString('Маркет-Снайпер', $brandFont)
    $domainBox = $g.MeasureString($Domain, $brandFont)
    $g.DrawString($Domain, $brandFont, $mutedBrush, [single]($Width - $pad - $domainBox.Width), $cursorY)
    $cursorY += [single]($brandBox.Height + $pad * 0.6)

    # Широкий формат верстаем в две колонки: текст слева, скриншот справа
    $isWide = (($Width / $Height) -ge 1.4)
    if ($isWide) {
        $textWidth = [int][Math]::Round($Width * 0.40)
        $shotLeft = $pad + $textWidth + [int][Math]::Round($pad * 0.6)
        $shotAreaWidth = $Width - $shotLeft - $pad
    } else {
        $textWidth = $Width - 2 * $pad
        $shotLeft = $pad
        $shotAreaWidth = $Width - 2 * $pad
    }

    # Заголовок
    $titleRatio = if ($isWide) { 0.040 } else { 0.052 }
    $titleFont = New-PixelFont 'Segoe UI Semibold' ([single][Math]::Round($Width * $titleRatio)) ([System.Drawing.FontStyle]::Bold)
    foreach ($line in (Get-WrappedLines -Graphics $g -Text $Title -Font $titleFont -MaxWidth $textWidth)) {
        $g.DrawString($line, $titleFont, $whiteBrush, [single]$pad, $cursorY)
        $cursorY += [single]$g.MeasureString($line, $titleFont).Height
    }
    $cursorY += [single]($pad * 0.4)

    # Подзаголовок
    $subRatio = if ($isWide) { 0.023 } else { 0.026 }
    $subFont = New-PixelFont 'Segoe UI' ([single][Math]::Round($Width * $subRatio)) ([System.Drawing.FontStyle]::Regular)
    foreach ($line in (Get-WrappedLines -Graphics $g -Text $Subtitle -Font $subFont -MaxWidth $textWidth)) {
        $g.DrawString($line, $subFont, $mutedBrush, [single]$pad, $cursorY)
        $cursorY += [single]$g.MeasureString($line, $subFont).Height
    }
    $cursorY += [single]($pad * 0.5)

    # Скриншот бейджа — вписываем без обрезки: справа (широкий) или снизу (квадрат)
    $shot = [System.Drawing.Image]::FromFile($badgePath)
    $availWidth = $shotAreaWidth
    $availHeight = if ($isWide) { $Height - 2 * $pad } else { $Height - $cursorY - $pad }
    $scale = [Math]::Min($availWidth / $shot.Width, $availHeight / $shot.Height)
    $drawWidth = [int][Math]::Round($shot.Width * $scale)
    $drawHeight = [int][Math]::Round($shot.Height * $scale)
    if ($isWide) {
        $drawX = [int][Math]::Round($shotLeft + ($shotAreaWidth - $drawWidth) / 2)
        $drawY = [int][Math]::Round(($Height - $drawHeight) / 2)
    } else {
        $drawX = [int][Math]::Round(($Width - $drawWidth) / 2)
        $drawY = [int][Math]::Round($Height - $pad - $drawHeight)
    }
    $g.DrawImage($shot, $drawX, $drawY, $drawWidth, $drawHeight)
    $shot.Dispose()


    $bitmap.Save($File, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bitmap.Dispose()
    $brandFont.Dispose()
    $titleFont.Dispose()
    $subFont.Dispose()
    $goldBrush.Dispose()
    $mutedBrush.Dispose()
    $whiteBrush.Dispose()
}

$horizontal = Join-Path $OutDir 'creative-1080x607.png'
New-Creative -Width 1080 -Height 607 `
    -Title 'Прибыль с продажи — на карточке Маркета' `
    -Subtitle 'Комиссия, доставка, реклама и закупка — сразу видно, что останется. 7 дней бесплатно.' `
    -Domain 'sniper.gadget-nakhodki.ru' `
    -File $horizontal

$square = Join-Path $OutDir 'creative-1080x1080.png'
New-Creative -Width 1080 -Height 1080 `
    -Title 'Считайте прибыль, а не цену' `
    -Subtitle 'Расширение показывает прибыль с продажи на карточке Яндекс.Маркета. 199 ₽ в месяц после 7 дней бесплатно.' `
    -Domain 'sniper.gadget-nakhodki.ru' `
    -File $square

Write-Host 'Готово:'
Write-Host "  $horizontal"
Write-Host "  $square"
Write-Host 'Дальше: node tools\vk-ads-create.js create --package <id> --image promo\vk-ads\creative-1080x607.png'
