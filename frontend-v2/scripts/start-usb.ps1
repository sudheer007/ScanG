# USB workflow: forward ports, then start Expo for a connected Android phone.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

& (Join-Path $PSScriptRoot 'usb-setup.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Location $root
Write-Host ""
Write-Host "Starting Expo (localhost mode for USB)..."
yarn start --localhost
