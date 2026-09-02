# render-mcp — status at a glance.
# Double-click status.cmd, or run this directly.

$endpoint = "https://render.makermargins.com/mcp"
$repo     = "RodRomer/render-mcp"
$regName  = "io.github.RodRomer/render-mcp"
$gh       = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\bin\gh.exe"
$tmp      = Join-Path $env:TEMP "render-mcp-status"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host ""
Write-Host "  RENDER-MCP - STATUS" -ForegroundColor Green
Write-Host ("  " + (Get-Date -Format "ddd d MMM yyyy, HH:mm")) -ForegroundColor DarkGray
Write-Host ""

# ---------- is the server alive ----------
Write-Host "  SERVER" -ForegroundColor Cyan
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
$bodyFile = Join-Path $tmp "ping.json"
[System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding $false))
$sw = [Diagnostics.Stopwatch]::StartNew()
$raw = & curl.exe -s --max-time 30 -X POST $endpoint -H "content-type: application/json" --data-binary "@$bodyFile" 2>$null
$sw.Stop()
try {
  $tools = ($raw | ConvertFrom-Json).result.tools
  Write-Host ("    Up        : yes  ({0:N0} ms)" -f $sw.Elapsed.TotalMilliseconds) -ForegroundColor Green
  Write-Host ("    Tools     : " + (($tools | ForEach-Object { $_.name }) -join ", "))
} catch {
  Write-Host "    Up        : NO - endpoint not responding correctly" -ForegroundColor Red
}

# ---------- registry ----------
Write-Host ""
Write-Host "  OFFICIAL MCP REGISTRY" -ForegroundColor Cyan
try {
  $regFile = Join-Path $tmp "reg.json"
  & curl.exe -s --max-time 30 "https://registry.modelcontextprotocol.io/v0/servers?search=render-mcp&limit=50" -o $regFile 2>$null
  $j = [System.IO.File]::ReadAllText($regFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  $mine = $j.servers | Where-Object { $_.server.name -eq $regName }
  if ($mine) {
    $m = $mine._meta.'io.modelcontextprotocol.registry/official'
    Write-Host ("    Listed    : yes  (v{0}, {1})" -f $mine.server.version, $m.status) -ForegroundColor Green
  } else {
    Write-Host "    Listed    : not found in search results" -ForegroundColor DarkYellow
  }
} catch { Write-Host "    Registry lookup failed" -ForegroundColor DarkYellow }

# ---------- github interest ----------
Write-Host ""
Write-Host "  GITHUB" -ForegroundColor Cyan
if (Test-Path $gh) {
  try {
    $r = & $gh api "repos/$repo" 2>$null | ConvertFrom-Json
    Write-Host ("    Stars     : {0}    Forks: {1}    Watchers: {2}" -f $r.stargazers_count, $r.forks_count, $r.subscribers_count)
    $v = & $gh api "repos/$repo/traffic/views" 2>$null | ConvertFrom-Json
    $c = & $gh api "repos/$repo/traffic/clones" 2>$null | ConvertFrom-Json
    if ($v) { Write-Host ("    Views     : {0} in 14 days ({1} unique)" -f $v.count, $v.uniques) }
    if ($c) { Write-Host ("    Clones    : {0} in 14 days ({1} unique)" -f $c.count, $c.uniques) }
  } catch { Write-Host "    GitHub lookup failed - try: gh auth status" -ForegroundColor DarkYellow }
} else {
  Write-Host "    GitHub CLI not found" -ForegroundColor DarkYellow
}

# ---------- what it means ----------
Write-Host ""
Write-Host "  ---------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  HOW TO READ THIS" -ForegroundColor Cyan
Write-Host "    Clones and unique views are the closest proxy for real"
Write-Host "    interest - the registry does not publish install counts."
Write-Host "    Zero for the first few weeks is normal and expected."
Write-Host ""
Write-Host "  IF IT STARTS GETTING USED" -ForegroundColor Cyan
Write-Host "    The free Cloudflare tier allows 3 concurrent browsers and" -ForegroundColor DarkGray
Write-Host "    10 minutes of browser time a day." -ForegroundColor DarkGray
Write-Host "    Measured 2 Sep 2026: most calls land in the 2-8s band, so that" -ForegroundColor DarkGray
Write-Host "    ceiling is roughly 75-150 renders a day. Headroom is real, and" -ForegroundColor DarkGray
Write-Host "    /stats shows the duration split - check it before assuming." -ForegroundColor DarkGray
Write-Host "    Workers Paid is `$5/mo -> 10 browser-hours, 10 concurrent" -ForegroundColor DarkGray
Write-Host "    (~12,000 renders). Only worth paying once something uses it." -ForegroundColor DarkGray
Write-Host ""
Write-Host "    Then: add x402 pricing (one function call via Vercel's" -ForegroundColor DarkGray
Write-Host "    x402-mcp). Median agent price is `$0.028/call against a" -ForegroundColor DarkGray
Write-Host "    render cost near `$0.0001 - roughly 250x margin." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Endpoint : $endpoint"
Write-Host "  Repo     : https://github.com/$repo"
Write-Host "  Registry : https://registry.modelcontextprotocol.io"
Write-Host ""
