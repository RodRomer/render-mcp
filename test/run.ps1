# Runs test/model.test.js against src/protocol.js with no Node installed.
#
# This machine has no Node, so the suite runs in headless Edge instead. The only
# transformation applied is removing the ES-module `export` keyword and the test
# file's `import` block — the function bodies that are actually under test are
# byte-for-byte the deployed source, concatenated and executed by a real modern
# JavaScript engine. Nothing is reimplemented for the tests.
#
#   powershell -ExecutionPolicy Bypass -File test\run.ps1

param([string]$SourceFile, [string]$TestFile)

$ErrorActionPreference = "Stop"

$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) { Write-Host "No Edge or Chrome found; cannot run the suite."; exit 2 }

$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

function ReadText($p) { [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8) }

if (-not $SourceFile) { $SourceFile = "src\protocol.js" }
if (-not $TestFile)   { $TestFile   = "test\model.test.js" }
$src  = ReadText (Join-Path $root $SourceFile)
$test = ReadText (Join-Path $root $TestFile)

# `export function foo` -> `function foo`; `export const X` -> `const X`.
$src = [regex]::Replace($src, '(?m)^export\s+', '')
# Drop the test's import block; the source is concatenated ahead of it instead.
$test = [regex]::Replace($test, '(?sm)^import\s*\{.*?\}\s*from\s*["''][^"'']+["''];', '')

$work = Join-Path $env:TEMP ("render-mcp-test-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null

$bundle = $src + "`r`n" + $test
# Inline rather than <script src>. A file:// external script is a separate opaque
# origin, so any failure inside it reaches window.onerror as a bare "Script error."
# with no message or line number. Inline keeps errors readable.
$bundle = $bundle.Replace("</script", "<\/script")

$head = @'
<!doctype html><html><body>
<script>
var __lines = [];
var __code = 0;
console.log = function () { __lines.push(Array.prototype.slice.call(arguments).join(" ")); };
var process = { exit: function (c) { __code = c; } };
window.onerror = function (m, f, l, c) { __lines.push("HARNESS ERROR line " + l + ": " + m); return true; };
</script>
<script>
'@
$tail = @'
</script>
<script>
// Built fresh rather than reused: a DOM suite may replace page content wholesale,
// and an output element that lived in the original markup would vanish with it.
var __out = document.createElement("pre");
__out.id = "out";
__out.textContent = __lines.join("\n") + "\nEXITCODE:" + __code;
document.documentElement.appendChild(__out);
</script>
</body></html>
'@
[System.IO.File]::WriteAllText((Join-Path $work "runner.html"), $head + $bundle + $tail, $utf8)

# msedge.exe is a GUI-subsystem binary: it has no console attached, so piping its
# stdout in-process yields nothing at all — silently, with exit code 0. The output
# only appears if it is redirected to a file.
$domFile = Join-Path $work "dom.html"
$proc = Start-Process -FilePath $edge -NoNewWindow -PassThru -Wait `
  -RedirectStandardOutput $domFile -RedirectStandardError (Join-Path $work "err.txt") `
  -ArgumentList @(
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--user-data-dir=$(Join-Path $work 'prof')",
    "--virtual-time-budget=8000", "--dump-dom",
    ("file:///" + (Join-Path $work "runner.html").Replace("\", "/"))
  )

if ($proc.ExitCode -ne 0) { Write-Host "Browser exited with $($proc.ExitCode)."; exit 2 }
$text = ReadText $domFile
$m = [regex]::Match($text, '(?s)<pre id="out">(.*?)</pre>')
if (-not $m.Success) { Write-Host "Could not read results from the page."; Write-Host $text; exit 2 }

$out = $m.Groups[1].Value `
  -replace '&lt;', '<' -replace '&gt;', '>' -replace '&quot;', '"' -replace '&#39;', "'" -replace '&amp;', '&'

Write-Host $out

try { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue } catch {}

if ($out -match 'EXITCODE:0') { exit 0 } else { exit 1 }
