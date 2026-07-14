# Allow inbound TCP 8000 for ScanG backend (run PowerShell as Administrator).
#Required for Expo Go on a physical phone to reach the API on your PC.

$ruleName = 'ScanG Backend 8000'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Firewall rule already exists: $ruleName"
  exit 0
}

New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 | Out-Null
Write-Host "Added firewall rule: $ruleName (TCP 8000 inbound)"
