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

- Node.js mit npm
- Python 3.11 oder neuer

## Installation

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
npm install
```

## Entwicklung

```powershell
npm run dev
```

Das startet den Vite-Dev-Server, Electron und das lokale Python-Backend. Alternativ kann `.\Start-NickNotes.ps1` genutzt werden.

## Pruefung

```powershell
npm run build
python -m unittest discover src/backend/tests
```

## Repo-Hygiene

Nicht eingecheckt werden lokale Abhaengigkeiten, Build-Ausgaben, Test-Runtimes, Logdateien, lokale NoteBases und generierte Projektionen wie `.venv/`, `node_modules/`, `dist/`, `.tmp/`, `*NoteBase/` oder `.system/index.db`.
