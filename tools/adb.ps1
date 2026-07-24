$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  Write-Error "adb not found at $adb. Install Android SDK Platform-Tools."
  exit 1
}
& $adb @args
exit $LASTEXITCODE
