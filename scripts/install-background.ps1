$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  throw ".env not found. Configure it before installing the background watcher."
}
$envText = Get-Content $envFile -Raw
if ($envText -notmatch '(?m)^DRY_RUN=false\s*
$taskName = "Naukri Hourly Job Watcher"
$runner = Join-Path $root "scripts\run-background.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed: $taskName"
Write-Host "Runs at Windows logon and repeats according to RUN_EVERY_MINUTES in .env.") {
  throw "Production install requires DRY_RUN=false after Telegram credentials are configured."
}
if ($envText -notmatch '(?m)^TELEGRAM_BOT_TOKEN=.+
$taskName = "Naukri Hourly Job Watcher"
$runner = Join-Path $root "scripts\run-background.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed: $taskName"
Write-Host "Runs at Windows logon and repeats according to RUN_EVERY_MINUTES in .env." -or $envText -match '(?m)^TELEGRAM_BOT_TOKEN=\s*
$taskName = "Naukri Hourly Job Watcher"
$runner = Join-Path $root "scripts\run-background.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed: $taskName"
Write-Host "Runs at Windows logon and repeats according to RUN_EVERY_MINUTES in .env.") {
  throw "TELEGRAM_BOT_TOKEN is missing."
}
if ($envText -notmatch '(?m)^TELEGRAM_CHAT_ID=.+
$taskName = "Naukri Hourly Job Watcher"
$runner = Join-Path $root "scripts\run-background.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed: $taskName"
Write-Host "Runs at Windows logon and repeats according to RUN_EVERY_MINUTES in .env." -or $envText -match '(?m)^TELEGRAM_CHAT_ID=\s*
$taskName = "Naukri Hourly Job Watcher"
$runner = Join-Path $root "scripts\run-background.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed: $taskName"
Write-Host "Runs at Windows logon and repeats according to RUN_EVERY_MINUTES in .env.") {
  throw "TELEGRAM_CHAT_ID is missing."
}

$taskName = "Naukri Hourly Job Watcher"
$runner = Join-Path $root "scripts\run-background.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Hourly Naukri job watcher with Telegram alerts" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed: $taskName"
Write-Host "Runs at Windows logon and repeats according to RUN_EVERY_MINUTES in .env."