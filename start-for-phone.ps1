# Запуск локального сервера для доступа с телефона в той же Wi-Fi сети
$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

$Port = 3000

function Get-LocalIPv4 {
    $candidates = @()

    try {
        $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notlike '127.*' -and
                $_.PrefixOrigin -ne 'WellKnown' -and
                $_.InterfaceAlias -notmatch 'Loopback|Virtual|VMware|Hyper-V|vEthernet'
            }
    }
    catch {
        # Fallback for systems without Get-NetIPAddress
    }

    if (-not $candidates) {
        try {
            $candidates = Get-NetIPConfiguration -ErrorAction Stop |
                Where-Object { $_.IPv4Address -and $_.IPv4Address.IPAddress -notlike '127.*' } |
                ForEach-Object { [PSCustomObject]@{ IPAddress = $_.IPv4Address.IPAddress; InterfaceAlias = $_.InterfaceAlias } }
        }
        catch { }
    }

    if (-not $candidates) { return $null }

    $sorted = $candidates | Sort-Object @{
        Expression = {
            if ($_.InterfaceAlias -match 'Wi-Fi|Wireless|WLAN|Беспровод') { 0 }
            elseif ($_.InterfaceAlias -match 'Ethernet|Подключение по локальной сети') { 1 }
            else { 2 }
        }
    }, @{ Expression = { $_.InterfaceAlias } }

    return ($sorted | Select-Object -First 1).IPAddress
}

$ip = Get-LocalIPv4

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Трекер целей — доступ с телефона" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($ip) {
    Write-Host "  На телефоне откройте в браузере:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    http://${ip}:${Port}" -ForegroundColor Green
    Write-Host ""
}
else {
    Write-Host "  Не удалось определить IP. Проверьте Wi-Fi." -ForegroundColor Red
    Write-Host "  Попробуйте: ipconfig  (ищите IPv4-адрес)" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "  Важно:" -ForegroundColor Yellow
Write-Host "  • Телефон и компьютер — в одной Wi-Fi сети" -ForegroundColor White
Write-Host "  • Окно не закрывайте — пока оно открыто, сервер работает" -ForegroundColor White
Write-Host "  • Данные на телефоне и ПК хранятся отдельно (localStorage)" -ForegroundColor White
Write-Host ""
Write-Host "  Если не открывается — разрешите доступ в брандмауэре Windows." -ForegroundColor DarkYellow
Write-Host ""
Write-Host "  Локально на этом ПК: http://localhost:${Port}" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Запуск сервера..." -ForegroundColor Cyan
Write-Host "  (Ctrl+C — остановить)" -ForegroundColor DarkGray
Write-Host ""

function Start-PythonServer {
    Write-Host "  Используем Python..." -ForegroundColor Yellow
    & python -m http.server $Port --bind 0.0.0.0
}

$usedFallback = $false
$npx = Get-Command npx -ErrorAction SilentlyContinue
$python = Get-Command python -ErrorAction SilentlyContinue

if ($npx) {
    & npx --yes serve . -l "tcp://0.0.0.0:${Port}"
    if ($LASTEXITCODE -ne 0) {
        $usedFallback = $true
    }
}
else {
    $usedFallback = $true
}

if ($usedFallback) {
    if ($python) {
        Start-PythonServer
    }
    else {
        Write-Host ""
        Write-Host "  Ошибка: нужен Node.js (npx) или Python." -ForegroundColor Red
        Write-Host "  Установите Node.js: https://nodejs.org" -ForegroundColor Yellow
    }
}

Write-Host ""
Read-Host "Сервер остановлен. Нажмите Enter для выхода"
