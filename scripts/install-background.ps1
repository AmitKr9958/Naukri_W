$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $root ".env"))) {
  throw ".env not found. Configure it before installing the background watcher."
}

$taskName = "Naukri Hourly Job Watcher"
$entry = Join-Path $root "src\index.js"
$action = New-ScheduledTaskAction -Execute $node -Argument ("`"" + $entry + "`"") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Days 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force | Out-Null
Write-Host "Installed: $taskName"
Write-Host "Runs at Windows logon and repeats according to RUN_EVERY_MINUTES in .env."