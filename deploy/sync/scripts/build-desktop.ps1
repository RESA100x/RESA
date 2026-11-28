# Builds a RESA desktop installer that already knows its sync server.
#
# The endpoint and public key are baked into the binary at compile time, so the
# account screen only ever asks for an email and a password. Run this from the
# repo root after `docker compose up -d` in deploy/sync:
#
#   pwsh deploy/sync/scripts/build-desktop.ps1
#   pwsh deploy/sync/scripts/build-desktop.ps1 -Endpoint http://192.168.1.20:8000
#
# Use the LAN address (not localhost) when phones on the same network must reach
# the same server.
param(
  [string]$Endpoint = "",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "../../..")
$envFile = Join-Path $PSScriptRoot "../.env"
if (-not (Test-Path $envFile)) { throw "deploy/sync/.env is missing; run the stack setup first." }

$settings = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z_]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim() }
}
$secret = $settings['JWT_SECRET']
if (-not $secret) { throw "JWT_SECRET missing from deploy/sync/.env" }

$port = if ($settings['GATEWAY_PORT']) { $settings['GATEWAY_PORT'] } else { '8000' }
if (-not $Endpoint) { $Endpoint = "http://localhost:$port" }

$keys = node (Join-Path $PSScriptRoot "keys.mjs") $secret
$anon = ($keys | Where-Object { $_ -like 'ANON_KEY=*' }) -replace '^ANON_KEY=', ''

$env:RESA_SYNC_ENDPOINT = $Endpoint
$env:RESA_SYNC_ANON_KEY = $anon

Write-Host "Building with sync endpoint $Endpoint"
Push-Location $root
try {
  npm run tauri build
} finally {
  Pop-Location
}
