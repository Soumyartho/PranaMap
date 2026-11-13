<#
.SYNOPSIS
  Start PranaMap for development in one command: API on :8000, web app on :5173.

.DESCRIPTION
  First run creates backend/.venv, installs Python and Node dependencies and seeds the synthetic block.
  Later runs only reinstall when requirements.txt or package-lock.json changed. Ctrl+C stops both servers.

.PARAMETER Reseed
  Rebuild the synthetic database (drops all local data).

.PARAMETER Phone
  Serve the web app on the LAN over HTTPS for a real phone (see docs/PHONE_TESTING.md).

.EXAMPLE
  ./scripts/dev.ps1
  ./scripts/dev.ps1 -Reseed -Phone
#>
param([switch]$Reseed, [switch]$Phone)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$python = Join-Path $backend ".venv\Scripts\python.exe"

function Step($msg) { Write-Host "`n> $msg" -ForegroundColor Red }
function Stale($stamp, $source) { -not (Test-Path $stamp) -or (Get-Item $source).LastWriteTime -gt (Get-Item $stamp).LastWriteTime }

if (-not (Test-Path $python)) {
  Step "Creating backend/.venv"
  $py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
  & $py -m venv (Join-Path $backend ".venv")
}
$stamp = Join-Path $backend ".venv\.installed"
if (Stale $stamp (Join-Path $backend "requirements.txt")) {
  Step "Installing Python dependencies"
  & $python -m pip install --disable-pip-version-check -q -r (Join-Path $backend "requirements.txt")
  if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
  New-Item -ItemType File -Force $stamp | Out-Null
}
if ($Reseed -or -not (Test-Path (Join-Path $backend "pranamap.db"))) {
  Step "Seeding the synthetic block"
  Push-Location $backend
  try { $env:PYTHONIOENCODING = "utf-8"; & $python -m scripts.seed_synthetic } finally { Pop-Location }
}
$nodeStamp = Join-Path $frontend "node_modules\.package-lock.json"
if (Stale $nodeStamp (Join-Path $frontend "package-lock.json")) {
  Step "Installing Node dependencies"
  Push-Location $frontend
  try { npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm install failed" } } finally { Pop-Location }
}

Step "API on http://localhost:8000 (docs at /docs)"
$api = Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000", "--reload" `
  -WorkingDirectory $backend -NoNewWindow -PassThru
try {
  Step "Web app (Ctrl+C stops both)"
  Push-Location $frontend
  if ($Phone) { npm run dev:phone } else { npm run dev }
} finally {
  Pop-Location
  if (-not $api.HasExited) {
    # uvicorn --reload runs a child process: stop the whole tree.
    taskkill /PID $api.Id /T /F | Out-Null
  }
}
