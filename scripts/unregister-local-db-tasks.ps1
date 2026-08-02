$ErrorActionPreference = "Stop"

$taskNames = @(
  "VahanEY-Postgres",
  "VahanEY-PostgresBackup",
  "VahanEY-RtoCatalog",
  "VahanEY-RtoDaily",
  "VahanEY-RtoInsightsOsm",
  "VahanEY-RtoFactorDaily",
  "VahanEY-TrackedQueries"
)

foreach ($name in $taskNames) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Output "Removed $name"
  } else {
    Write-Output "Missing $name"
  }
}

$remaining = Get-ScheduledTask -TaskName "VahanEY-*" -ErrorAction SilentlyContinue
if ($remaining) {
  $remaining | Select-Object TaskName, State | Format-Table -AutoSize
  throw "One or more VahanEY scheduled tasks remain."
}

Write-Output "No VahanEY scheduled tasks remain."
