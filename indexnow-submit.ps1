# Notify IndexNow-participating search engines about render.makermargins.com.
#
# This is a separate hostname from makermargins.com and inherits nothing from it
# — not its robots.txt, not its sitemap, and not its IndexNow key. It needs its
# own key file, which the Worker serves from src/routes.js.
#
# IndexNow needs no account, no OAuth and no login: hosting the key file at the
# host root *is* the verification. Bing, Yandex, Seznam and Naver participate.
# Google does not, so sitemap.xml plus Search Console remains the route there.
#
#   powershell -ExecutionPolicy Bypass -File indexnow-submit.ps1

$ErrorActionPreference = "Stop"

$key   = "8c1f47b0e2a94d6fb35ac0d918e7f24c"
$host_ = "render.makermargins.com"
$urls  = @("https://render.makermargins.com/", "https://render.makermargins.com/stats")

$keyUrl = "https://$host_/$key.txt"

# Refuse to submit unless the key file is genuinely live and correct — otherwise
# every engine rejects the batch and the failure looks like a network problem.
Write-Host "Checking key file..." -ForegroundColor Cyan
$code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 20 $keyUrl
if ($code -ne "200") {
  Write-Host "  $code at $keyUrl - deploy first. Nothing sent." -ForegroundColor Red
  exit 1
}
if ((& curl.exe -s --max-time 20 $keyUrl).Trim() -ne $key) {
  Write-Host "  Key file contents do not match. Nothing sent." -ForegroundColor Red
  exit 1
}
Write-Host "  OK - $keyUrl serves the key" -ForegroundColor Green

$payload = [ordered]@{ host = $host_; key = $key; keyLocation = $keyUrl; urlList = $urls } |
  ConvertTo-Json -Depth 4
$tmp = Join-Path $env:TEMP ("indexnow-render-" + [guid]::NewGuid().ToString("N").Substring(0, 8) + ".json")
[System.IO.File]::WriteAllText($tmp, $payload, (New-Object System.Text.UTF8Encoding($false)))

foreach ($e in @("https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow")) {
  $status = & curl.exe -s -o NUL -w "%{http_code}" --max-time 40 -X POST $e `
    -H "Content-Type: application/json; charset=utf-8" --data-binary "@$tmp"
  $meaning = switch ($status) {
    "200" { "OK - accepted" }
    "202" { "Accepted - key validation pending" }
    "403" { "Forbidden - key not valid for this host" }
    "422" { "Unprocessable - URLs do not match the host" }
    default { "unexpected" }
  }
  $colour = if ($status -eq "200" -or $status -eq "202") { "Green" } else { "Red" }
  Write-Host ("  {0}  {1,-32} {2}" -f $status, $e, $meaning) -ForegroundColor $colour
}

try { Remove-Item $tmp -Force -ErrorAction SilentlyContinue } catch {}
Write-Host ""
Write-Host "Submitted $($urls.Count) URLs for $host_." -ForegroundColor Cyan
