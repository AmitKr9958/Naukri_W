$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "background.out.log"
$err = Join-Path $logDir "background.err.log"
$node = (Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $root "src\index.js") >> $out 2>> $err
exit $LASTEXITCODE