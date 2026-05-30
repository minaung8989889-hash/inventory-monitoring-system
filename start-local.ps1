# Start local MongoDB, Flask backend, and Node-RED for the inventory monitoring project.
# Run this from the repo root: .\start-local.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Join-Path $repoRoot 'backend'
$nodeRedDir = Join-Path $repoRoot 'node_red'

Write-Host 'Starting local inventory monitoring environment...'

function Start-ProcessWindow($script, $title) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $script -WindowStyle Normal -WorkingDirectory $repoRoot -Verb RunAs
}

$powershellExe = $PSHOME

# Start mongod if available
try {
    $mongodPath = Get-Command mongod -ErrorAction Stop | Select-Object -ExpandProperty Source
    $mongoDbPath = Join-Path $repoRoot 'data\db'
    if (-Not (Test-Path $mongoDbPath)) {
        New-Item -ItemType Directory -Path $mongoDbPath -Force | Out-Null
    }
    Write-Host "Starting mongod from $mongodPath using dbpath $mongoDbPath"
    Start-Process -FilePath $powershellExe -ArgumentList '-NoExit', '-Command', "& { Set-Location -Path '$repoRoot'; mongod --dbpath '$mongoDbPath' }" -WindowStyle Normal
} catch {
    Write-Warning 'mongod not found in PATH; please start MongoDB manually if needed.'
}

# Start Flask backend
$venvRoot = Join-Path $repoRoot '.venv'
$activatePath = Join-Path $venvRoot 'Scripts\Activate.ps1'
if (-Not (Test-Path $activatePath)) {
    Write-Warning "Virtual environment not found at $activatePath. Please create it with 'python -m venv .venv' and install requirements."
}

$flaskScript = "& { Set-Location -Path '$backendDir'; if (Test-Path '$activatePath') { . '$activatePath' }; python app.py }"
Start-Process -FilePath $powershellExe -ArgumentList '-NoExit', '-Command', $flaskScript -WindowStyle Normal
Write-Host 'Started Flask backend in a new terminal.'

# Start Node-RED
$nodeRedScript = "& { Set-Location -Path '$nodeRedDir'; npx node-red --userDir . -p 1881 }"
Start-Process -FilePath $powershellExe -ArgumentList '-NoExit', '-Command', $nodeRedScript -WindowStyle Normal
Write-Host 'Started Node-RED in a new terminal.'

Write-Host 'Note: If mongod was not found, start MongoDB manually and then rerun this script.'
