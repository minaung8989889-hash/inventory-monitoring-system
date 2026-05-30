<#
Simple build script to create packaged static builds for 'user' (v1) and 'developer' (v3).
Usage:
  .\scripts\build-web.ps1 -Profile user
  .\scripts\build-web.ps1 -Profile developer -Version 3.0.0-dev
#>
param(
    [ValidateSet('user','developer')]
    [string]$Profile = 'user',
    [string]$Version
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
# Repo root is the parent of the script directory
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

if (-not $Version) {
    if ($Profile -eq 'developer') { $Version = '3.0.0-dev' } else { $Version = '1.0.0' }
}

$buildDir = Join-Path $repoRoot "build\$Profile-v$($Version)"
if (Test-Path $buildDir) { Remove-Item -Recurse -Force $buildDir }
New-Item -ItemType Directory -Path $buildDir | Out-Null

# Copy static assets
$staticSrc = Join-Path $repoRoot 'static'
$templatesSrc = Join-Path $repoRoot 'backend\templates'
$staticDst = Join-Path $buildDir 'static'
$templatesDst = Join-Path $buildDir 'templates'

Write-Host "Building $Profile package -> $buildDir"

Copy-Item -Path $staticSrc -Destination $staticDst -Recurse -Force
Copy-Item -Path $templatesSrc -Destination $templatesDst -Recurse -Force

# Create a version file the frontend can read
$versionInfo = @{ version = $Version; profile = $Profile; built = (Get-Date).ToString('o') }
$versionJson = $versionInfo | ConvertTo-Json -Depth 3
$versionPath = Join-Path $staticDst 'js\version.json'

# Ensure folder exists
$versionFolder = Split-Path $versionPath -Parent
if (-not (Test-Path $versionFolder)) { New-Item -ItemType Directory -Path $versionFolder | Out-Null }

Set-Content -Path $versionPath -Value $versionJson -Encoding UTF8

Write-Host "Build complete. Output: $buildDir"
Write-Host "Version file written to: $versionPath"

# Optional: create a zip
$zipPath = "$buildDir.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($buildDir, $zipPath)
Write-Host "Zipped build at: $zipPath"
