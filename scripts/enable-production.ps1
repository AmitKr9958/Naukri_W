$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  throw ".env was not found in $root. Run this from your existing project checkout."
}

$original = Get-Content $envFile -Raw
$required = @("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")
foreach ($name in $required) {
  if ($original -notmatch "(?m)^$name=.+$" -or $original -match "(?m)^$name=\s*$") {
    throw "$name is missing from local .env. Add it locally, then run this script again."
  }
}
if ($original -match "(?m)^AI_ENABLED=true\s*$" -and $original -notmatch "(?m)^AI_CONSENT=true\s*$") {
  throw "AI_ENABLED=true requires AI_CONSENT=true."
}

$backup = "$envFile.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $envFile -Destination $backup
$text = $original

function Set-EnvValue([string]$text, [string]$name, [string]$value) {
  $line = "$name=$value"
  if ($text -match "(?m)^$name=.*$") {
    return [regex]::Replace($text, "(?m)^$name=.*$", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $line })
  }
  return $text.TrimEnd() + "`r`n" + $line + "`r`n"
}

$text = Set-EnvValue $text "RUN_EVERY_MINUTES" "30"
$text = Set-EnvValue $text "RUN_ON_START" "true"
$text = Set-EnvValue $text "DRY_RUN" "false"
$text = Set-EnvValue $text "NAUKRI_HEADLESS" "true"
$text = Set-EnvValue $text "NAUKRI_AUTO_LOGIN" "true"
Set-Content -LiteralPath $envFile -Value $text -Encoding utf8

try {
  & (Join-Path $PSScriptRoot "install-background.ps1")
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Background installer returned exit code $LASTEXITCODE." }

  $taskName = "Naukri Job Watcher 30min 24x7"
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
  Write-Host ""
  Write-Host "Production task installed and started." -ForegroundColor Green
  Write-Host "Task: $taskName"
  Write-Host "State: $($task.State)"
  Write-Host "Last run: $($info.LastRunTime)"
  Write-Host "Last result: $($info.LastTaskResult)"
  Write-Host "Config backup: $backup"
  Write-Host "Logs: $root\logs\background.out.log and $root\logs\background.err.log"
} catch {
  Copy-Item -LiteralPath $backup -Destination $envFile -Force
  Write-Host "Setup failed; the original .env was restored from backup." -ForegroundColor Yellow
  throw
}
