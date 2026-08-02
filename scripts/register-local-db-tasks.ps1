param(
  [ValidateSet("Daily", "Insights", "Factor", "Local")]
  [string]$TaskSet = "Daily",
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$FactorRunTime = "21:30"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot "run-hidden-local-db-task.vbs"
$wscript = (Get-Command wscript.exe).Source
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$activeDatabaseLine = Get-Content (Join-Path $repoRoot ".env") |
  Where-Object { $_ -match '^DATABASE_URL=' } |
  Select-Object -First 1
if (-not $activeDatabaseLine) { throw "The active .env has no DATABASE_URL." }
$activeDatabaseUrl = [Uri](($activeDatabaseLine -split '=', 2)[1])
if ($activeDatabaseUrl.Host -notin @("localhost", "127.0.0.1", "::1")) {
  throw "Refusing to register local jobs while active DATABASE_URL points to $($activeDatabaseUrl.Host)."
}

function Register-VahanTask {
  param(
    [string]$Name,
    [switch]$Every15Minutes,
    [switch]$WeeklySunday,
    [string]$DailyAt,
    [string]$Job,
    [int]$ExecutionTimeLimitHours = 1,
    [string]$Description
  )

  $arguments = "`"$launcher`" $Job"
  $action = New-ScheduledTaskAction -Execute $wscript -Argument $arguments -WorkingDirectory $repoRoot
  $trigger = if ($Every15Minutes) {
    $now = Get-Date
    $minutesToNextQuarter = 15 - ($now.Minute % 15)
    $nextQuarter = $now.AddMinutes($minutesToNextQuarter)
    $nextQuarter = $nextQuarter.AddSeconds(-$nextQuarter.Second).AddMilliseconds(-$nextQuarter.Millisecond)
    New-ScheduledTaskTrigger `
      -Once `
      -At $nextQuarter `
      -RepetitionInterval (New-TimeSpan -Minutes 15)
  } elseif ($WeeklySunday) {
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 2:00AM
  } elseif ($DailyAt) {
    $timeParts = $DailyAt.Split(":")
    $scheduledAt = (Get-Date).Date.AddHours([int]$timeParts[0]).AddMinutes([int]$timeParts[1])
    if ($scheduledAt -le (Get-Date)) { $scheduledAt = $scheduledAt.AddDays(1) }
    New-ScheduledTaskTrigger -Daily -At $scheduledAt
  } else {
    throw "Register-VahanTask requires a supported schedule."
  }
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours $ExecutionTimeLimitHours) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
  $settings.Hidden = $true
  $principal = New-ScheduledTaskPrincipal `
    -UserId $taskUser `
    -LogonType Interactive `
    -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $Name `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $Description `
    -Force | Out-Null
}

if ($TaskSet -in @("Daily", "Local")) {
  Register-VahanTask `
    -Name "VahanEY-RtoDaily" `
    -Job "rto-daily" `
    -Every15Minutes `
    -Description "Run a hidden bounded two-worker RTO and ARTO rotation every 15 minutes."
}

if ($TaskSet -in @("Insights", "Local")) {
  Register-VahanTask `
    -Name "VahanEY-RtoInsightsOsm" `
    -Job "rto-insights-osm" `
    -WeeklySunday `
    -ExecutionTimeLimitHours 4 `
    -Description "Refresh RTO Insights OpenStreetMap signals from the weekly Geofabrik India extract."
}

if ($TaskSet -eq "Factor") {
  Register-VahanTask `
    -Name "VahanEY-RtoFactorDaily" `
    -Job "rto-factor-daily" `
    -DailyAt $FactorRunTime `
    -ExecutionTimeLimitHours 1 `
    -Description "Refresh factor-source review queues and run eligible-event validations as review-only drafts."
}

Get-ScheduledTask -TaskName $(if ($TaskSet -eq "Daily") { "VahanEY-RtoDaily" } elseif ($TaskSet -eq "Insights") { "VahanEY-RtoInsightsOsm" } elseif ($TaskSet -eq "Factor") { "VahanEY-RtoFactorDaily" } else { "VahanEY-*" }) |
  Select-Object TaskName, State, @{
    Name = "Triggers"
    Expression = {
      ($_.Triggers | ForEach-Object {
        $repeat = if ($_.Repetition.Interval) { " repeat=$($_.Repetition.Interval)" } else { "" }
        "$($_.StartBoundary)$repeat"
      }) -join "; "
    }
  }, @{
    Name = "Action"
    Expression = { ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join "; " }
  }, @{
    Name = "Hidden"
    Expression = { $_.Settings.Hidden }
  }
