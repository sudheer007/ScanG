# Low-memory Android dev build for physical devices (USB).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$jbr = 'C:\Program Files\Android\Android Studio\jbr'
if (Test-Path $jbr) {
  $env:JAVA_HOME = $jbr
  Write-Host "JAVA_HOME=$env:JAVA_HOME"
  & "$jbr\bin\java.exe" -version
} else {
  Write-Host "Warning: Android Studio JBR not found. Using system Java."
}

$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (Test-Path $adb) {
  $devices = & $adb devices | Select-String 'device$'
  if ($devices) {
    Write-Host 'Setting up USB port forwarding...'
    & $adb reverse tcp:8081 tcp:8081 | Out-Null
    & $adb reverse tcp:8000 tcp:8000 | Out-Null
    Write-Host 'USB reverse: 8081 (Metro), 8000 (backend)'
  }
}

if (Test-Path (Join-Path $root 'android\gradlew.bat')) {
  Write-Host 'Stopping old Gradle daemons...'
  Push-Location (Join-Path $root 'android')
  .\gradlew.bat --stop 2>$null
  Pop-Location
}

Write-Host ''
Write-Host 'Starting Android build (single arch, low memory)...'
Write-Host 'Close other apps to free RAM. First build may take 15-25 min.'
Write-Host ''

yarn expo run:android -- --no-parallel -PreactNativeArchitectures=arm64-v8a
