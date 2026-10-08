$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $root ".env"))) {
  throw ".env not found. Configure it before installing the background watcher."
}

$taskName = "Naukri Hourly Job Watcher"
$runner = Join-Path $root "scripts\run-background.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Days 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed: $taskName"
Write-Host "Runs at Windows logon and repeats according to RUN_EVERY_MINUTES in .env."