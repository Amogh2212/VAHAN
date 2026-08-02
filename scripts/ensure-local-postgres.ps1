param(
  [string]$LogFile
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $LogFile) {
  $logDirectory = Join-Path $repoRoot "logs\local-jobs"
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  $LogFile = Join-Path $logDirectory "postgres-preflight.log"
}

function Write-PreflightLog {
  param([string]$Message)
  "[$(Get-Date -Format o)] $Message" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

function Get-LocalDatabaseUrl {
  $envPath = Join-Path $repoRoot ".env"
  $activeDatabaseLine = Get-Content $envPath |
    Where-Object { $_ -match '^DATABASE_URL=' } |
    Select-Object -First 1
  if (-not $activeDatabaseLine) { throw "The active .env has no DATABASE_URL." }
  $databaseUrl = [Uri](($activeDatabaseLine -split '=', 2)[1])
  if ($databaseUrl.Host -notin @("localhost", "127.0.0.1", "::1")) {
    throw "Refusing to start local PostgreSQL while active DATABASE_URL points to $($databaseUrl.Host)."
  }
  $databaseUrl
}

function Test-LocalPostgresReady {
  Push-Location $repoRoot
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & node --env-file=.env (Join-Path $PSScriptRoot "local-db-check.mjs") *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }
}

function Start-HiddenLocalPostgres {
  $powershell = (Get-Command powershell.exe).Source
  $runner = Join-Path $PSScriptRoot "run-local-db-task.ps1"
  $arguments = @(
    "-WindowStyle", "Hidden",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$runner`"",
    "-Job", "postgres"
  )
  Start-Process `
    -FilePath $powershell `
    -ArgumentList $arguments `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden | Out-Null
}

Get-LocalDatabaseUrl | Out-Null
if (Test-LocalPostgresReady) {
  Write-PreflightLog "Local PostgreSQL preflight ok"
  exit 0
}

Write-PreflightLog "Local PostgreSQL is not reachable; starting hidden local server"
Start-HiddenLocalPostgres
for ($attempt = 1; $attempt -le 30; $attempt += 1) {
  Start-Sleep -Seconds 2
  if (Test-LocalPostgresReady) {
    Write-PreflightLog "Local PostgreSQL became ready after $attempt poll(s)"
    exit 0
  }
}

Write-PreflightLog "Local PostgreSQL did not become ready within 60 seconds"
throw "Local PostgreSQL did not become ready within 60 seconds."
