# publish-edge.ps1 — обновление УЖЕ опубликованного расширения в Microsoft Edge Add-ons
# через Update REST API v1.1 (авторизация по API key, без OAuth).
#
# Первую публикацию API сделать не может — только вручную в Partner Center.
# Где взять ProductId / ClientId / ApiKey:
#   Partner Center → Microsoft Edge → ваше расширение (ProductId виден в URL /products/<ProductId>)
#   Partner Center → Publish API → Enable → Client ID + API key (v1.1)
#
# Пример:
#   .\publish-edge.ps1 -ProductId "abc123" -ClientId "11111111-2222-3333-4444-555555555555" `
#       -ApiKey "xxxxx" -PackagePath ".\dist\market-sniper-0.2.0.zip" -Notes "0.2.0: расчет прибыли"

param(
  [Parameter(Mandatory = $true)][string]$ProductId,
  [Parameter(Mandatory = $true)][string]$ClientId,
  [Parameter(Mandatory = $true)][string]$ApiKey,
  [Parameter(Mandatory = $true)][string]$PackagePath,
  [string]$Notes = 'Auto update',
  [string]$ApiEndpoint = 'https://api.addons.microsoftedge.microsoft.com',
  [int]$RetryLimit = 60,
  [int]$RetryAfterPeriod = 10
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PackagePath)) { throw "Не найден пакет: $PackagePath" }
$PackagePath = (Resolve-Path -LiteralPath $PackagePath).Path

function Get-ApiHeaders {
  param([string]$ContentType)
  $h = @{ 'Authorization' = "ApiKey $ApiKey"; 'X-ClientID' = $ClientId }
  if ($ContentType) { $h['Content-Type'] = $ContentType }
  return $h
}

function Invoke-Api {
  param([string]$Method, [string]$Url, [object]$Body, [string]$ContentType, [string]$FilePath)
  $params = @{
    Uri         = $Url
    Method      = $Method
    Headers     = (Get-ApiHeaders $ContentType)
    TimeoutSec  = 600
    UseBasicParsing = $true
  }
  if ($Body) { $params['Body'] = $Body }
  if ($FilePath) { $params['InFile'] = $FilePath }

  try {
    return Invoke-WebRequest @params
  } catch {
    $web = $_.Exception.Response
    if ($web) {
      $reader = New-Object System.IO.StreamReader($web.GetResponseStream())
      $text = $reader.ReadToEnd()
      throw ("HTTP {0} на {1} {2}: {3}" -f [int]$web.StatusCode, $Method, $Url, $text)
    }
    throw
  }
}

function Get-LocationId {
  param($Response)
  $loc = $Response.Headers['Location']
  if ($loc -is [array]) { $loc = $loc[0] }
  if (-not $loc) { throw 'Ответ без заголовка Location — не удалось получить operationId' }
  return ($loc.TrimEnd('/') -split '/')[-1]
}

function Wait-Operation {
  param([string]$StatusUrl, [string]$Title)
  $status = 'InProgress'
  for ($i = 1; $i -le $RetryLimit; $i++) {
    Start-Sleep -Seconds $RetryAfterPeriod
    $resp = Invoke-Api -Method 'GET' -Url $StatusUrl
    $status = ($resp.Content | ConvertFrom-Json).status
    Write-Host ("  {0}: {1} (попытка {2}/{3})" -f $Title, $status, $i, $RetryLimit)
    if ($status -ne 'InProgress') { break }
  }
  if ($status -ne 'Succeeded') { throw "$Title завершилась со статусом $status" }
  return $status
}

Write-Host "1/4 Загрузка пакета: $PackagePath"
$upload = Invoke-Api -Method 'POST' -Url "$ApiEndpoint/v1/products/$ProductId/submissions/draft/package" `
  -ContentType 'application/zip' -FilePath $PackagePath
$uploadOp = Get-LocationId $upload

Write-Host "2/4 Ожидание обработки пакета (operationId=$uploadOp)"
Wait-Operation -StatusUrl "$ApiEndpoint/v1/products/$ProductId/submissions/draft/package/operations/$uploadOp" -Title 'upload' | Out-Null

Write-Host "3/4 Публикация черновика"
$publishBody = @{ notes = $Notes } | ConvertTo-Json
$publish = Invoke-Api -Method 'POST' -Url "$ApiEndpoint/v1/products/$ProductId/submissions" `
  -Body $publishBody -ContentType 'application/json'
$publishOp = Get-LocationId $publish

Write-Host "4/4 Ожидание проверки и публикации (operationId=$publishOp)"
Wait-Operation -StatusUrl "$ApiEndpoint/v1/products/$ProductId/submissions/operations/$publishOp" -Title 'publish' | Out-Null

Write-Host 'Готово: обновление отправлено на проверку Edge.' -ForegroundColor Green
