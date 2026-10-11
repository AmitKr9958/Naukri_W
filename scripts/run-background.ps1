$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "background.out.log"
$err = Join-Path $logDir "background.err.log"
$node = (Get-Command node -ErrorAction Stop).Source
$entry = Join-Path $root "src\index.js"
$cmd = $env:ComSpec
if (-not $cmd) { $cmd = "cmd.exe" }

# Run Node through cmd.exe so stderr is redirected to a file without PowerShell
# treating ordinary Node error logs as terminating PowerShell errors. This keeps
# the 30-minute Node loop alive after a failed search cycle.
while ($true) {
  try {
    Add-Content -LiteralPath $out -Value ("[{0}] Starting Naukri watcher process." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
    $commandLine = '"' + $node + '" "' + $entry + '" 1>> "' + $out + '" 2>> "' + $err + '"'
    & $cmd /d /s /c $commandLine
    $exitCode = $LASTEXITCODE
    Add-Content -LiteralPath $err -Value ("[{0}] Watcher process exited with code {1}; restarting in 60 seconds." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $exitCode)
  } catch {
    Add-Content -LiteralPath $err -Value ("[{0}] Runner error: {1}; retrying in 60 seconds." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message)
  }
  Start-Sleep -Seconds 60
}
