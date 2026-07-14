# Forward Metro (8081) and backend (8000) from phone to PC over USB.
$adbDir = "$env:LOCALAPPDATA\Android\Sdk\platform-tools"
$adb = Join-Path $adbDir 'adb.exe'

if (-not (Test-Path $adb)) {
  Write-Host "adb not found at $adb"
  Write-Host "Install Android SDK Platform-Tools or Android Studio."
  exit 1
}

Write-Host "Using $adb"
& $adb devices

$ports = @(
  @{ name = 'Metro'; phone = 8081; pc = 8081 },
  @{ name = 'Backend'; phone = 8000; pc = 8000 }
)

foreach ($p in $ports) {
  & $adb reverse "tcp:$($p.phone)" "tcp:$($p.pc)" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "OK  $($p.name): phone tcp:$($p.phone) -> PC tcp:$($p.pc)"
  } else {
    Write-Host "FAIL $($p.name) reverse (is the phone connected and USB debugging enabled?)"
    exit 1
  }
}

Write-Host ""
Write-Host "USB port forwarding ready."
Write-Host "Use EXPO_PUBLIC_BACKEND_URL=http://localhost:8000 in .env"
Write-Host "Then run: yarn start --localhost"
