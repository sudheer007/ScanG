# Prints the debug keystore SHA-1 for Firebase / Google Cloud Android OAuth setup.
# IMPORTANT: this project's android/app/build.gradle signs debug builds with a
# project-local keystore (android/app/debug.keystore), NOT the global
# ~/.android/debug.keystore. Always use the project-local one for Firebase/Google
# Cloud OAuth setup, or Google Sign-In will fail with DEVELOPER_ERROR.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectLocalKeystore = Join-Path $scriptDir '..\android\app\debug.keystore'
$globalKeystore = Join-Path $env:USERPROFILE '.android\debug.keystore'

if (Test-Path $projectLocalKeystore) {
  $keystore = $projectLocalKeystore
} elseif (Test-Path $globalKeystore) {
  Write-Host "WARNING: using global keystore ($globalKeystore) - project-local android/app/debug.keystore not found."
  $keystore = $globalKeystore
} else {
  Write-Host "Debug keystore not found at $projectLocalKeystore or $globalKeystore"
  Write-Host "Run 'npx expo run:android' once to generate it, then rerun this script."
  exit 1
}

$output = keytool -list -v -keystore $keystore -alias androiddebugkey -storepass android -keypass android 2>&1
$sha1 = ($output | Select-String -Pattern 'SHA1:\s*(.+)' | ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() } | Select-Object -First 1)

Write-Host ""
Write-Host "ScanG Android package: com.scang.frontend"
Write-Host "Debug SHA-1: $sha1"
Write-Host ""
Write-Host "Add this SHA-1 in Firebase Console:"
Write-Host "  Project settings -> Your apps -> Android (com.scang.frontend) -> Add fingerprint"
Write-Host ""
Write-Host "Then create an Android OAuth client in Google Cloud (if not auto-created):"
Write-Host "  APIs & Services -> Credentials -> Create OAuth client ID -> Android"
Write-Host "  Package: com.scang.frontend"
Write-Host "  SHA-1:   $sha1"
Write-Host ""
Write-Host "Copy the Android client ID into frontend-v2/.env as EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID"
Write-Host ""

if ($sha1) {
  Set-Clipboard -Value $sha1
  Write-Host "SHA-1 copied to clipboard."
}
