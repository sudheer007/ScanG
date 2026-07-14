$ip = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.PrefixOrigin -ne 'WellKnown'
  } |
  Sort-Object -Property InterfaceMetric |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $ip) {
  Write-Host "No LAN IPv4 address found."
  exit 1
}

Write-Host "Use this in frontend-v2/.env:"
Write-Host "EXPO_PUBLIC_BACKEND_URL=http://$ip`:8000"
Set-Clipboard -Value "http://${ip}:8000"
Write-Host ""
Write-Host "Copied to clipboard."
