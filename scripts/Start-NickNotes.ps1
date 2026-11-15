$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$requirementsFile = Join-Path $projectRoot "requirements.txt"
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [string]$ErrorMessage = "Befehl ist fehlgeschlagen."
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw $ErrorMessage
    }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "Erstelle virtuelle Umgebung (.venv) ..."
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    $pyCmd = Get-Command py -ErrorAction SilentlyContinue

    if ($pythonCmd) {
        Invoke-Checked -Executable $pythonCmd.Source -Arguments @("-m", "venv", ".venv") -ErrorMessage "Konnte virtuelle Umgebung nicht erstellen (python)."
    } elseif ($pyCmd) {
        Invoke-Checked -Executable $pyCmd.Source -Arguments @("-3", "-m", "venv", ".venv") -ErrorMessage "Konnte virtuelle Umgebung nicht erstellen (py -3)."
    } else {
        throw "Kein Python gefunden. Bitte Python 3 installieren."
    }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Virtuelle Umgebung wurde nicht korrekt erstellt: $venvPython"
}

Write-Host "Installiere Python-Backend-Abhaengigkeiten ..."
Invoke-Checked -Executable $venvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip") -ErrorMessage "Konnte pip nicht aktualisieren."
Invoke-Checked -Executable $venvPython -Arguments @("-m", "pip", "install", "-r", $requirementsFile) -ErrorMessage "Konnte Python-Abhaengigkeiten nicht installieren."

Write-Host "Installiere Node-Abhaengigkeiten ..."
Invoke-Checked -Executable "npm" -Arguments @("install") -ErrorMessage "Konnte Node-Abhaengigkeiten nicht installieren."

Write-Host "Starte NickNotes Desktop (Electron + React + Python Backend) ..."
Invoke-Checked -Executable "npm" -Arguments @("run", "dev") -ErrorMessage "NickNotes konnte nicht gestartet werden."
