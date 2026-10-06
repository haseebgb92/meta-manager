$ErrorActionPreference = "Stop"
$OutDir = Join-Path $PSScriptRoot "..\src-tauri\resources\windows"
$NodeExe = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item $NodeExe (Join-Path $OutDir "node.exe") -Force
Write-Host "Bundled Node runtime from $NodeExe"
