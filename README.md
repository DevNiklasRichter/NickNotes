# NickNotes

NickNotes ist eine lokale Windows-first Desktop-App fuer portable Markdown-NoteBases. Notizen und eigenstaendige Tasks bleiben als Markdown-Dateien lesbar; Indizes, Graphen und Uebersichten sind nur wiederherstellbare Projektionen.

## Download und erster Start

Freigegebene Installer stehen unter
[GitHub Releases](https://github.com/DevNiklasRichter/NickNotes/releases).
Solange dort noch keine stabile Version freigegeben ist, gibt es ausschließlich
Testkandidaten. RCs und Actions-Artefakte sind Testfassungen.

Für Windows x64 den Installer `NickNotes-Setup-<Version>-x64.exe` herunterladen
und ausführen. Die Installation erfolgt pro Benutzer mit wählbarem Zielordner;
Node.js und Python müssen auf dem Zielgerät nicht installiert werden. Danach
NickNotes starten und eine NoteBase anlegen oder einen bestehenden Ordner öffnen.
Die NoteBase liegt separat von der Installation und bleibt bei der Deinstallation
erhalten. Vor einem Versionswechsel eine Sicherung der eigenen NoteBase anlegen.

NickNotes arbeitet lokal und offline. **Hilfe → Nach Updates suchen** zeigt die
installierte Version und den Updatestatus. Signierte öffentliche Pakete prüfen
nach dem Start und regelmäßig auf veröffentlichte stabile Versionen. Download
und Installationsneustart benötigen eine bewusste Aktion; RCs werden nicht als
stabiles Update angeboten. In unsignierten Testpaketen sind Updates deaktiviert.
Ein manueller neuer Installer bleibt als Updateweg verfügbar.

Notizen und Tasks sind Markdown-Dateien, Tags stehen in `.system/tag_groups.json`.
SQLite und Graph-Dateien sind wiederherstellbare Projektionen. MCP-Freigaben und
der noch nicht abgesendete Capture-Entwurf liegen im lokalen App-Profil und
werden nicht mit der NoteBase übertragen. Details: [Windows-Auslieferung](doc/windows-release.md).

## Hilfe und Beiträge

- Fehler und Vorschläge: [Issues](https://github.com/DevNiklasRichter/NickNotes/issues).
- Sicherheitsmeldungen: [SECURITY.md](SECURITY.md).
- Änderungen und bekannte Grenzen: [Changelog](CHANGELOG.md).
- Beiträge: [CONTRIBUTING.md](CONTRIBUTING.md).
- Lizenz: [MIT](LICENSE); mitgelieferte Drittanbieterhinweise bleiben gültig.

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

Das Fenster und ein lokal gesicherter Schnellerfassungsentwurf starten vor der
vollstaendigen Oberflaeche und dem Backend. Danach uebernimmt Quick Capture den
Text; **Senden** speichert ihn in der gewaehlten NoteBase. Ladefehler erhalten eine
Wiederholen-Aktion. [Start und Wiederherstellung](doc/startup-and-recovery.md).
`npm run smoke:startup` prueft den echten Entwicklungsstart mit isoliertem Profil
und frischem Vite-Cache. Ein Entwicklungs-Kaltstart ist langsamer als das fertige Paket.

## Pruefung

```powershell
npm run check
npm run contracts:check
npm run icons:check
```

## Tastatur und Menues

Datei, Bearbeiten, Ansicht und Hilfe sind direkt in der Titelleiste verfuegbar.
Haeufige Aktionen: **Strg+N** neue Notiz, **Strg+Umschalt+N** neuer Task,
**Strg+O** Notiz suchen/oeffnen, **Strg+S** speichern,
**Strg+Umschalt+S** alle Notizen speichern, **Strg+W** aktive Ansicht schliessen.
**F1** zeigt alle Befehle, **F10** fokussiert das Menue. Icons zeigen ihre
Tastenkuerzel beim Darueberfahren. [Vollstaendige Bedienung](doc/keyboard-and-menus.md).

Entwicklungspruefung mit isolierter synthetischer NoteBase: `npm run smoke:commands`.
Sie prueft auch, dass keine Save-/Refresh-Schleife im Leerlauf entsteht.

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
[Was die GitHub-Pipeline auf welchem Rechner macht](doc/github-pipeline.md).

Der eingebaute Assistant wurde durch einen lokalen, authentifizierten MCP-Zugang
ersetzt. **Einstellungen → Agent-Verbindungen** erstellt widerrufbare Freigaben
mit getrenntem Schreibrecht. [MCP-Anleitung](doc/mcp-connections.md).

## Repo-Hygiene

Nicht eingecheckt werden lokale Abhaengigkeiten, Build-Ausgaben, Test-Runtimes, Logdateien, lokale NoteBases und generierte Projektionen wie `.venv/`, `node_modules/`, `dist/`, `.tmp/`, `*NoteBase/` oder `.system/index.db`.
