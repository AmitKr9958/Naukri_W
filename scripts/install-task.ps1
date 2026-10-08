$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "src/index.js" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Days 1)
Register-ScheduledTask -TaskName "Naukri Hourly Job Watcher" -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force
Write-Host "Installed: Naukri Hourly Job Watcher"
