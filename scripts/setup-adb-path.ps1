# Ensures adb is on PATH (user + optional system) and works in new terminals.
$ErrorActionPreference = 'Stop'

$adbDir = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools'
$adb = Join-Path $adbDir 'adb.exe'
$toolsDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools'

if (-not (Test-Path $adb)) {
  Write-Host "adb not found at $adb"
  Write-Host "Install Android Studio -> SDK Manager -> SDK Platform-Tools"
  exit 1
}

function Add-ToPath([string]$scope, [string]$dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', $scope)
  if ($current -split ';' | Where-Object { $_ -eq $dir }) {
    Write-Host "[$scope] already contains: $dir"
    return
  }
  $updated = if ($current) { "$current;$dir" } else { $dir }
  [Environment]::SetEnvironmentVariable('Path', $updated, $scope)
  Write-Host "[$scope] added: $dir"
}

Add-ToPath 'User' $adbDir
Add-ToPath 'User' $toolsDir

# Refresh PATH in the current shell session
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')

Write-Host ""
& $adb version
Write-Host ""
& $adb devices
Write-Host ""
Write-Host "adb is ready. If an old terminal still fails, close it and open a new one."
Write-Host "From repo root you can also run: .\tools\adb.cmd devices"
