# build-promo-video.ps1 — собирает промо-ролик «Маркет-Снайпер» (9:16, 15 сек) из скриншотов.
# Кадры рисуются через System.Drawing, анимация и кодирование — ffmpeg.
#
# Пример:
#   .\tools\build-promo-video.ps1
#   .\tools\build-promo-video.ps1 -Ffmpeg "C:\Program Files\Jellyfin\Server\ffmpeg.exe"

param(
    [string]$Ffmpeg = 'C:\Program Files\Jellyfin\Server\ffmpeg.exe',
    [string]$Ffprobe = 'C:\Program Files\Jellyfin\Server\ffprobe.exe'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'promo\video'
$framesDir = Join-Path $outDir 'frames'
$siteDir = Join-Path $root 'site'

if (-not (Test-Path -LiteralPath $Ffmpeg)) { throw "Не найден ffmpeg: $Ffmpeg" }
if (Test-Path -LiteralPath $framesDir) { Remove-Item -LiteralPath $framesDir -Recurse -Force }
New-Item -ItemType Directory -Path $framesDir -Force | Out-Null

$W = 1080
$H = 1920

function C([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }

$navyTop = C '#10294a'
$navyBottom = C '#081a31'
$gold = C '#f5c451'
$white = C '#ffffff'
$muted = C '#9fb3cc'
$line = C '#2c517d'
$navy = C '#0b1f3a'

function New-Canvas {
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $navyTop, $navyBottom, 90)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # мягкое золотое свечение сверху
    $glow = New-Object System.Drawing.Drawing2D.GraphicsPath
    $glow.AddEllipse(-260, -520, 1600, 1100)
    $glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
    $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(30, 245, 196, 81)
    $glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 245, 196, 81))
    $g.FillPath($glowBrush, $glow)
    $glowBrush.Dispose()
    $glow.Dispose()

    return @{ Bitmap = $bmp; Graphics = $g }
}

function New-RoundedPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Add-Box($g, [string]$hex, [int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
    $path = New-RoundedPath $x $y $w $h $r
    $brush = New-Object System.Drawing.SolidBrush((C $hex))
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
}

function Add-Text($g, [string]$text, [int]$size, [string]$hex, [int]$x, [int]$y, [int]$w, [int]$h, [string]$style = 'Bold') {
    $fontStyle = [System.Enum]::Parse([System.Drawing.FontStyle], $style)
    $font = New-Object System.Drawing.Font('Arial', $size, $fontStyle, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush((C $hex))
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
    $g.DrawString($text, $font, $brush, $rect, $format)
    $format.Dispose()
    $brush.Dispose()
    $font.Dispose()
}

function Add-Brand($g) {
    Add-Box $g '#1b3a5f' 60 70 300 56 28
    Add-Text $g 'МАРКЕТ-СНАЙПЕР' 20 '#f5c451' 60 70 300 56
}

function Add-Footer($g) {
    Add-Text $g 'sniper.gadget-nakhodki.ru' 24 '#6f87a6' 90 1790 900 50
}

function Add-Screenshot($g, [string]$fileName, [int]$maxW, [int]$top, [int]$captionTop, [string]$caption) {
    $path = Join-Path $siteDir ('img\' + $fileName)
    if (-not (Test-Path -LiteralPath $path)) {
        $path = Join-Path $root ('store\screenshots\' + $fileName)
    }

    $img = [System.Drawing.Image]::FromFile($path)
    try {
        $scale = [Math]::Min($maxW / $img.Width, 1.0)
        $shotW = [int]($img.Width * $scale)
        $shotH = [int]($img.Height * $scale)
        $x = [int](($W - $shotW) / 2)

        Add-Box $g '#17365a' ($x - 14) ($top - 14) ($shotW + 28) ($shotH + 28) 22
        $dest = New-Object System.Drawing.Rectangle($x, $top, $shotW, $shotH)
        $g.DrawImage($img, $dest)
        $pen = New-Object System.Drawing.Pen((C '#2c517d'), 2)
        $g.DrawRectangle($pen, $dest)
        $pen.Dispose()
    } finally {
        $img.Dispose()
    }

    Add-Text $g $caption 44 '#ffffff' 80 $captionTop 920 200
}

function Save-Frame($canvas, [string]$name) {
    $path = Join-Path $framesDir $name
    $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Graphics.Dispose()
    $canvas.Bitmap.Dispose()
    Write-Host ('  + frames\' + $name)
}

Write-Host 'Кадры:'

# 1. Боль
$c = New-Canvas; $g = $c.Graphics
Add-Brand $g
Add-Box $g '#f5c451' 90 700 90 8 4
Add-Text $g 'Продаёте на маркетплейсе?' 72 '#ffffff' 90 780 900 260
Add-Text $g 'Прибыль считаете в таблице?' 46 '#9fb3cc' 90 1080 900 140
Add-Footer $g
Save-Frame $c '01.png'

# 2. Проблема
$c = New-Canvas; $g = $c.Graphics
Add-Brand $g
Add-Text $g 'Комиссия, доставка, реклама' 62 '#ffffff' 90 720 900 200
Add-Text $g 'съедают вашу маржу' 62 '#f5c451' 90 900 900 200
Add-Text $g 'А видно это только в конце месяца' 40 '#9fb3cc' 90 1160 900 140
Add-Footer $g
Save-Frame $c '02.png'

# 3. Решение: бейдж с прибылью
$c = New-Canvas; $g = $c.Graphics
Add-Brand $g
Add-Screenshot $g 'shot1-badge.png' 980 520 1240 'Чистая прибыль — на карточке'
Add-Footer $g
Save-Frame $c '03.png'

# 4. Настройка
$c = New-Canvas; $g = $c.Graphics
Add-Brand $g
Add-Screenshot $g 'popup.png' 560 470 245 'Ставки и налоги — один раз в настройках'
Add-Footer $g
Save-Frame $c '04.png'

# 5. Призыв
$c = New-Canvas; $g = $c.Graphics
$iconPath = Join-Path $siteDir 'img\icon.png'
$icon = [System.Drawing.Image]::FromFile($iconPath)
try {
    $g.DrawImage($icon, (New-Object System.Drawing.Rectangle(430, 520, 220, 220)))
} finally { $icon.Dispose() }
Add-Text $g '7 дней бесплатно' 78 '#f5c451' 90 810 900 140
Add-Text $g 'дальше 199 ₽ в месяц' 42 '#9fb3cc' 90 950 900 100
Add-Box $g '#f5c451' 150 1110 780 110 55
Add-Text $g 'sniper.gadget-nakhodki.ru' 34 '#0b1f3a' 150 1110 780 110
Add-Text $g 'Расширение для Edge и Chrome' 30 '#6f87a6' 90 1270 900 60
Add-Footer $g
Save-Frame $c '05.png'

# --- Рендер ---
Write-Host ''
Write-Host 'Рендер:'

$outFile = Join-Path $outDir 'market-sniper-promo-9x16.mp4'
$durations = @(3, 4, 4, 3, 2.5)
$total = ($durations | Measure-Object -Sum).Sum
$names = @('01.png', '02.png', '03.png', '04.png', '05.png')

$ffArgs = @('-y', '-hide_banner', '-loglevel', 'error')
for ($i = 0; $i -lt $names.Count; $i++) {
    $ffArgs += @('-framerate', '30', '-loop', '1', '-t', [string]$durations[$i], '-i', (Join-Path $framesDir $names[$i]))
}
$ffArgs += @('-f', 'lavfi', '-t', [string]$total, '-i', 'anullsrc=r=48000:cl=stereo')

$filters = @()
for ($i = 0; $i -lt $names.Count; $i++) {
    $fadeOut = [double]$durations[$i] - 0.35
    $chain = '[' + $i + ':v]scale=1080:1920,setsar=1,' +
        "zoompan=z='min(zoom+0.0007,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30," +
        'fade=t=in:st=0:d=0.35,fade=t=out:st=' + $fadeOut.ToString([System.Globalization.CultureInfo]::InvariantCulture) + ':d=0.35[v' + $i + ']'
    $filters += $chain
}
$filters += '[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[v]'
$filterComplex = $filters -join ';'

$ffArgs += @('-filter_complex', $filterComplex, '-map', '[v]', '-map', '5:a', '-t', [string]$total,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', $outFile)

& $Ffmpeg @ffArgs
if (-not (Test-Path -LiteralPath $outFile)) { throw 'ffmpeg не создал файл' }

# Превью-кадры, чтобы можно было проверить без проигрывания
foreach ($t in @(1.5, 5.5, 9.5, 15.5)) {
    $preview = Join-Path $outDir ('preview-' + $t + 's.jpg')
    & $Ffmpeg -y -hide_banner -loglevel error -ss $t -i $outFile -frames:v 1 -q:v 3 $preview
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $outFile).Length / 1MB, 2)
Write-Host ''
Write-Host ('  + promo\video\' + (Split-Path -Leaf $outFile) + ' (' + $sizeMb + ' МБ)')
Write-Host '  + preview-*.jpg'

if (Test-Path -LiteralPath $Ffprobe) {
    Write-Host ''
    Write-Host 'Проверка:'
    & $Ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate -show_entries format=duration,size -of default=noprint_wrappers=1 $outFile | ForEach-Object { Write-Host ('  ' + $_) }
}

Write-Host ''
Write-Host 'Готово: promo\video\market-sniper-promo-9x16.mp4'
