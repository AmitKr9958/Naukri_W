$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  throw ".env not found. Configure it before installing the background watcher."
}

$envText = Get-Content $envFile -Raw

if ($envText -notmatch '(?m)^DRY_RUN=false\s*$') {
  throw "Production install requires DRY_RUN=false after Telegram credentials are configured."
}
if ($envText -notmatch '(?m)^NAUKRI_HEADLESS=true\s*$') {
  throw "Production install requires NAUKRI_HEADLESS=true."
}
if ($envText -notmatch '(?m)^TELEGRAM_BOT_TOKEN=.+$' -or $envText -match '(?m)^TELEGRAM_BOT_TOKEN=\s*$') {
  throw "TELEGRAM_BOT_TOKEN is missing."
}
if ($envText -notmatch '(?m)^TELEGRAM_CHAT_ID=.+$' -or $envText -match '(?m)^TELEGRAM_CHAT_ID=\s*$') {
  throw "TELEGRAM_CHAT_ID is missing."
}
if ($envText -match '(?m)^AI_ENABLED=true\s*$' -and $envText -notmatch '(?m)^AI_CONSENT=true\s*$') {
  throw "AI_ENABLED=true requires AI_CONSENT=true."
}

$taskName = "Naukri Job Watcher 30min 24x7"
$runner = Join-Path $root "scripts\run-background.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "30-minute Naukri job watcher with Telegram alerts" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Installed: $taskName"
Write-Host "Starts at Windows logon and repeats according to RUN_EVERY_MINUTES in .env."