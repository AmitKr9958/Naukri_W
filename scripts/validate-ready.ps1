$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-NpmCheck([string]$Label, [string[]]$Arguments) {
  Write-Host ""
  Write-Host "=== $Label ===" -ForegroundColor Cyan
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

$nodeVersion = (& node -p "process.versions.node").Trim()
if ($LASTEXITCODE -ne 0) { throw "Node.js is not available on PATH." }
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required. Found $nodeVersion." }

if (-not (Test-Path -LiteralPath (Join-Path $root ".env"))) {
  throw "Local .env file is missing. Create it from .env.example and configure RESUME_PATH before running this validation."
}

Write-Host "Naukri_W local validation" -ForegroundColor Green
Write-Host "Node.js: $nodeVersion"
Write-Host "Repository: $root"
Write-Host "This script does not launch Naukri, send Telegram messages, or change DRY_RUN."

Invoke-NpmCheck "Install dependencies" @("install", "--no-audit", "--no-fund", "--package-lock=false")
Invoke-NpmCheck "JavaScript syntax checks" @("run", "lint")
Invoke-NpmCheck "Automated test suite" @("test")
Invoke-NpmCheck "Local configuration and resume preflight" @("run", "preflight")

Write-Host ""
Write-Host "AI model checks skipped: this watcher is configured for rule-based scoring only." -ForegroundColor Yellow

Write-Host ""
Write-Host "VALIDATION PASSED - project is ready for your controlled dry-run test." -ForegroundColor Green
Write-Host "No Naukri search was started and no Telegram message was sent."
