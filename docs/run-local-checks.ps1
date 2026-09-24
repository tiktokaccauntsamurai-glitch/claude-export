# Локальная проверка БЕЗ виртуализации/песочницы (T00 + verify). Запуск из папки проекта:
#   powershell -ExecutionPolicy Bypass -File docs\run-local-checks.ps1 [-Since 20]
# Пишет результат в docs\local-checks.log и docs\verify-local.json (без содержимого чатов).
param([int]$Since = 20)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
$log = Join-Path $PSScriptRoot 'local-checks.log'
"=== local checks $(Get-Date -Format s) ===" | Set-Content $log -Encoding utf8
function Step($name, $cmd) {
  "`n--- $name ---" | Add-Content $log -Encoding utf8
  $out = cmd /c "$cmd 2>&1"
  $code = $LASTEXITCODE
  $out | Add-Content $log -Encoding utf8
  "[$name] exit=$code" | Add-Content $log -Encoding utf8
  Write-Host "[$name] exit=$code"
}
Step 'npm test'   'npm test'
Step 'npm lint'   'npm run lint'
Step 'npm build'  'npm run build'
$dl = Join-Path $HOME 'Downloads\ClaudeExport'
if (Test-Path $dl) {
  Step 'verify' "npm run verify -- --since $Since --json docs\verify-local.json"
} else {
  "`n[verify] пропущено: нет $dl (сначала сделайте экспорт в Firefox)" | Add-Content $log -Encoding utf8
  Write-Host "verify пропущен: нет папки экспорта"
}
Write-Host "Готово. Лог: $log"
