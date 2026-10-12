$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Local .env file is missing. Run the project setup before this test."
}
$envText = Get-Content -LiteralPath $envFile -Raw
if ($envText -notmatch '(?im)^DRY_RUN\s*=\s*true\s*$') {
  throw "Safety stop: DRY_RUN must be true. This test will not run with live Telegram delivery enabled."
}

Write-Host "Phase 1/2: running automated checks and local preflight..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "validate-ready.ps1")
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
  throw "Automated validation failed; the Naukri dry-run was not started."
}

Write-Host ""
Write-Host "Phase 2/2: starting exactly one Naukri dry-run cycle..." -ForegroundColor Cyan
Write-Host "Safety: DRY_RUN=true; --ignore-seen is allowed only in dry-run; Telegram is skipped; seen-job state is not changed."
& node (Join-Path $root "src\index.js") --once --ignore-seen
if ($LASTEXITCODE -ne 0) {
  throw "The Naukri dry-run cycle failed. Review the diagnostics printed above."
}

Write-Host ""
Write-Host "END-TO-END DRY-RUN FINISHED." -ForegroundColor Green
Write-Host "No Telegram messages were sent and seen-job state was not changed."
