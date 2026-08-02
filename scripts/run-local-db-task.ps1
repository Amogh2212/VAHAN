param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("postgres", "tracked", "backup", "rto-catalog", "rto-daily", "rto-insights-osm", "rto-factor-daily")]
  [string]$Job
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repoRoot "logs\local-jobs"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logFile = Join-Path $logDirectory "$Job.log"

function Write-JobLog {
  param([string]$Message)
  "[$(Get-Date -Format o)] $Message" | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Ensure-LocalPostgres {
  $preflight = Join-Path $PSScriptRoot "ensure-local-postgres.ps1"
  & $preflight -LogFile $logFile
  if ($LASTEXITCODE -ne 0) {
    throw "Local PostgreSQL preflight failed with exit code $LASTEXITCODE."
  }
}

$scriptArgs = @()
$script = if ($Job -eq "postgres") {
  Join-Path $PSScriptRoot "start-local-postgres.mjs"
} elseif ($Job -eq "tracked") {
  Join-Path $PSScriptRoot "run-tracked-queries.mjs"
} elseif ($Job -eq "rto-catalog") {
  $scriptArgs = @("--mode", "rto-catalog")
  Join-Path $PSScriptRoot "vahan-scraper.mjs"
} elseif ($Job -eq "rto-daily") {
  $scriptArgs = @("--work-queue", "--time-budget-minutes", "55")
  Join-Path $PSScriptRoot "run-rto-daily-snapshots.mjs"
} elseif ($Job -eq "rto-insights-osm") {
  $scriptArgs = @("--write", "--download", "--refresh-source", "--refresh", "--limit", "2000")
  Join-Path $PSScriptRoot "import-geofabrik-rto-signals.mjs"
} elseif ($Job -eq "rto-factor-daily") {
  $scriptArgs = @("--write")
  Join-Path $PSScriptRoot "run-rto-factor-daily-automation.mjs"
} else {
  Join-Path $PSScriptRoot "backup-local-db.mjs"
}

Push-Location $repoRoot
$exitCode = 0
try {
  Write-JobLog "Starting $Job"
  if ($Job -in @("rto-daily", "rto-insights-osm", "rto-factor-daily")) {
    Ensure-LocalPostgres
  }
  $envFile = ".env"
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & node --env-file=$envFile $script @scriptArgs 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
} catch {
  $exitCode = 1
  Write-JobLog "Failed ${Job}: $($_.Exception.Message)"
  $_ | Out-String | Out-File -FilePath $logFile -Append -Encoding utf8
} finally {
  Write-JobLog "Finished $Job with exit code $exitCode"
  Pop-Location
}
exit $exitCode
