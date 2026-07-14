# Start API server reachable from Android devices on the same Wi-Fi.
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
  & $venvPython -m uvicorn server:app --reload --host 0.0.0.0 --port 8000
} else {
  uvicorn server:app --reload --host 0.0.0.0 --port 8000
}
