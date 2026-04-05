# NickNotes v2

NickNotes ist jetzt auf einen modernen Desktop-Stack migriert:

- Frontend: React + TypeScript + Vite
- Backend: Python (FastAPI)
- Desktop Wrapper: Electron

## Projektstruktur

```text
NickNotes/
  src/
    backend/
      api.py
      server.py
      nicknotes_backend/
        ai_client.py
        indexer.py
        markdown_io.py
        models.py
        parser.py
        vault.py
    desktop/
      main.mjs
      preload.cjs
    frontend/
      index.html
      public/
      src/
        App.tsx
        App.css
        index.css
        main.tsx
  package.json
  vite.config.ts
  requirements.txt
  Start-NickNotes.ps1
```

## Voraussetzungen

- Node.js + npm
- Python 3.11+ (empfohlen)

## Installation

### 1) Python Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 2) Frontend + Electron

```powershell
npm install
```

## Entwicklung starten

```powershell
npm run dev
```

Das startet:

- Vite Dev Server (Frontend)
- Electron App
- Python Backend automatisch aus Electron (`python -m src.backend.server`)

Alternativ per Skript:

```powershell
.\Start-NickNotes.ps1
```

## Build

```powershell
npm run build
```

Das Frontend-Bundle wird nach `dist/frontend` erzeugt.

## Backend API (lokal)

Standardmäßig unter:

- `http://127.0.0.1:8765`

Wichtige Endpunkte:

- `POST /notebase/open`
- `POST /notebase/create`
- `POST /notebase/reindex`
- `POST /capture/preview`
- `POST /capture/save`
- `GET /tasks`
- `POST /tasks/{task_id}/done`
- `GET /search`
- `GET /notes/content`
- `POST /notes/open`
- `GET /review`
- `GET /tag-groups`
- `POST /tag-groups/add-group`
- `POST /tag-groups/add-tag`
- `POST /tag-groups/rename-tag`
- `POST /tag-groups/move-tag`
- `POST /tag-groups/delete-tag`

## Hinweise

- Das alte Tkinter-UI wurde durch React/Electron ersetzt.
- Die bestehende Python-Kernlogik wurde in `src/backend/nicknotes_backend` uebernommen.
