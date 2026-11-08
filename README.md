# NickNotes

NickNotes ist eine lokale Windows-first Desktop-App fuer portable Markdown-NoteBases. Notizen und eigenstaendige Tasks bleiben als Markdown-Dateien lesbar; Indizes, Graphen und Uebersichten sind nur wiederherstellbare Projektionen.

## Stack

- Frontend: React, TypeScript, Vite
- Desktop: Electron
- Backend: Python, FastAPI, Uvicorn
- Suche/Projektionen: SQLite mit FTS5

## Repository

```text
NickNotes/
  src/
    backend/       # FastAPI, Use-Cases, Vault-/Index-/Import-Logik, Tests
    desktop/       # Electron Main Process und Preload Bridge
    frontend/      # React-App, Editor, Dashboards, Explorer, Graph
  doc/             # Architektur-, API- und Backlog-Dokumentation
  PROJECT_ARCHITECTURE.md
  package.json
  package-lock.json
  requirements.txt
  Start-NickNotes.ps1
```

`PROJECT_ARCHITECTURE.md` ist die verbindliche Kurzleitplanke fuer Architektur- und Strukturentscheidungen. Weitere Details liegen in `doc/`.

## Voraussetzungen

- Entwicklung: Node.js 24.14.x mit npm und Python 3.13
- Fertiges Windows-Paket: keine zusaetzliche Node-/Python-Installation

## Installation

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
npm ci
```

## Entwicklung

```powershell
npm run dev
```

Das startet den Vite-Dev-Server, Electron und das lokale Python-Backend. Alternativ kann `.\Start-NickNotes.ps1` genutzt werden.

## Pruefung

```powershell
npm run check
npm run contracts:check
npm run icons:check
```

## Windows-Paket und externe Agenten

```powershell
npm run package:win
npm run verify:package
npm run smoke:desktop
npm run release:checksums
```

Der vollstaendige Offline-Installer liegt unter `dist/installers`. Ressourcen und
Backendlaufzeit sind enthalten. [Build, Installation und Releasegrenzen](doc/windows-release.md)
beschreiben den noch nicht signierten Windows-Kandidaten.

Der eingebaute Assistant wurde durch einen lokalen, authentifizierten MCP-Zugang
ersetzt. **Einstellungen → Agent-Verbindungen** erstellt widerrufbare Freigaben
mit getrenntem Schreibrecht. [MCP-Anleitung](doc/mcp-connections.md).

[Umsetzungsplan](doc/implementation-plan.md) und
[Pruefbericht](doc/release-candidate-2026-11-08.md) dokumentieren den aktuellen Stand.

## Repo-Hygiene

Nicht eingecheckt werden lokale Abhaengigkeiten, Build-Ausgaben, Test-Runtimes, Logdateien, lokale NoteBases und generierte Projektionen wie `.venv/`, `node_modules/`, `dist/`, `.tmp/`, `*NoteBase/` oder `.system/index.db`.
