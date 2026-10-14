# Meta Manager Windows connectivity check. Read-only; does not collect or print credentials.
$ErrorActionPreference = "Continue"
Write-Host "=== Meta Manager Windows diagnostics ==="
Write-Host "Checked: $(Get-Date -Format o)"
Write-Host "Windows: $([Environment]::OSVersion.VersionString)"
Write-Host ""
function Test-LocalMcp {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:38939/health" -TimeoutSec 4
    Write-Host "MCP health: OK ($($response.service))"
  } catch {
    Write-Host "MCP health: FAILED ($($_.Exception.GetType().Name))"
    Write-Host "  Action: Open Meta Manager; check Settings -> Local Services."
  }
}
Test-LocalMcp
Write-Host ""
$running = @(Get-Process | Where-Object { $_.ProcessName -match "meta.?manager|mcp.?bridge" })
if ($running.Count -gt 0) {
    $running | Select-Object ProcessName, Id | Format-Table -AutoSize
} else {
    Write-Host "No Meta Manager / MCP Bridge process name detected."
}
$appData = Join-Path $env:APPDATA "com.advertpreneur.metamanager"
Write-Host "Meta Manager app-data exists: $(Test-Path $appData)"
$certPath = Join-Path $appData "certs\localhost.crt"
Write-Host "Local OAuth TLS certificate exists: $(Test-Path $certPath)"
$logPath = Join-Path $appData "meta-manager-mcp.log"
if (Test-Path $logPath) {
    Write-Host ""
    Write-Host "Meta Manager MCP startup log (last 10 lines; review before sharing):"
    Get-Content $logPath -Tail 10 | ForEach-Object {
        if ($_ -match 'token|secret|password|bearer|sk-proj') {
            Write-Host "  [redacted sensitive-looking log line]"
        } else { Write-Host "  $_" }
    }
} else {
    Write-Host "MCP startup log: not created (v0.1.22 and older may not log startup)."
}
try {
    $broker = Invoke-WebRequest -Uri "https://meta-manager-auth.vercel.app/api/exchange" -Method Get -TimeoutSec 8 -UseBasicParsing
    Write-Host "OAuth broker HTTPS: reachable (HTTP $($broker.StatusCode))"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 404 -or $status -eq 405) {
        Write-Host "OAuth broker HTTPS: reachable (GET is not an exchange request)"
    } else {
        Write-Host "OAuth broker HTTPS: error ($($_.Exception.GetType().Name))"
    }
}
Write-Host ""
Write-Host "For social authorization errors, copy the exact error on the final callback page. Do not share its full URL if it contains code=, state=, or access_token=."
