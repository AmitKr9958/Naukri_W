$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "background.out.log"
$err = Join-Path $logDir "background.err.log"
$node = (Get-Command node -ErrorAction Stop).Source
$entry = Join-Path $root "src\index.js"

# Keep the watcher alive if Node exits unexpectedly. The application already
# runs 30-minute cycles; this loop only restarts it after a process exit.
while ($true) {
  try {
    Add-Content -LiteralPath $out -Value ("[{0}] Starting Naukri watcher process." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
    & $node $entry >> $out 2>> $err
    $exitCode = $LASTEXITCODE
    Add-Content -LiteralPath $err -Value ("[{0}] Watcher process exited with code {1}; restarting in 60 seconds." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $exitCode)
  } catch {
    Add-Content -LiteralPath $err -Value ("[{0}] Runner error: {1}; retrying in 60 seconds." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message)
  }
  Start-Sleep -Seconds 60
}
