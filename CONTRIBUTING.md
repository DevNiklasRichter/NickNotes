# Beiträge zu NickNotes

Danke, dass du mitmachen möchtest! Fehler und Ideen bitte als
[GitHub Issue](https://github.com/DevNiklasRichter/NickNotes/issues) melden.
Für Sicherheitsprobleme gilt [SECURITY.md](SECURITY.md). Der Umgang miteinander
richtet sich nach dem [Verhaltenskodex](CODE_OF_CONDUCT.md).

## Grundregeln

Vor Änderungen [PROJECT_ARCHITECTURE.md](doc/PROJECT_ARCHITECTURE.md) lesen.
Markdown-Dateien und die zentrale Tagdefinition bleiben die fachlichen Quellen;
Index und Graph müssen daraus wiederherstellbar sein. Änderungen klein halten
und vorhandene Konzepte erweitern. Neue Features zunächst in einem Issue klären.

## Entwicklungsumgebung einrichten

Voraussetzungen: Windows, Node.js 24.14.x mit npm und Python 3.13.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
npm ci
```

## Starten

```powershell
npm run dev
```

Das startet den Vite-Dev-Server, Electron und das lokale Python-Backend.
Alternativ geht `.\scripts\Start-NickNotes.ps1`. Zum Ausprobieren eignet sich die
[Beispiel-NoteBase](examples/demo-notebase).

Fenster und Schnellerfassungsentwurf starten vor der vollständigen Oberfläche und
dem Backend; Ladefehler erhalten eine Wiederholen-Aktion
([Start und Wiederherstellung](doc/startup-and-recovery.md)). Ein Kaltstart in der
Entwicklung ist langsamer als im fertigen Paket.

## Prüfen

```powershell
npm run check            # Tests, Lint und Build
npm run contracts:check  # API-Verträge zwischen Backend und Frontend
npm run icons:check      # generierte Icon-Namen
```

Weitere Prüfungen mit echter App und isolierten Testdaten:

| Befehl | Prüft |
| --- | --- |
| `npm run smoke:startup` | echter Entwicklungsstart mit isoliertem Profil und frischem Vite-Cache |
| `npm run smoke:commands` | Menüs, Tastenkürzel und dass im Leerlauf keine Save-/Refresh-Schleife entsteht |
| `npm run smoke:desktop` | das gepackte Windows-Paket |

## Windows-Paket bauen

```powershell
npm run package:win
npm run verify:package
npm run smoke:desktop
npm run release:checksums
```

Der Offline-Installer liegt danach unter `dist/installers`. Details, Signierung und
Releasegrenzen: [Windows-Auslieferung](doc/windows-release.md); was die
GitHub-Pipeline auf welchem Rechner tut: [GitHub-Pipeline](doc/github-pipeline.md).

## README-Bilder und GIFs aktualisieren

Alle Medien in `doc/media` entstehen aus der Beispiel-NoteBase:

```powershell
winget install Gyan.FFmpeg   # einmalig, nur für die GIFs
npm run readme:media         # oder: -- --stills / -- --gifs
```

## Projektstruktur

```text
NickNotes/
├── src/
│   ├── backend/     FastAPI, Use-Cases, Vault-/Index-/Import-Logik und Tests
│   ├── desktop/     Electron-Hauptprozess und Preload-Brücke
│   └── frontend/    React-App: Editor, Dashboards, Explorer, Graph
├── doc/             Architektur, Funktionen und Betriebsdokumentation
├── examples/        erfundene Beispiel-NoteBase
├── scripts/         Build-, Smoke-Test- und Release-Skripte
└── build/           Icons und Installer-Ressourcen
```

## Pull Requests

Für einen Pull Request einen Branch anlegen, Problem und resultierendes Verhalten
beschreiben und passende Prüfungen nennen. Vor dem Merge müssen `npm run check`,
`npm run contracts:check`, `npm run icons:check` und die Windows-CI bestehen.
Bei Desktop-/Frontendänderungen die betroffenen Smoke-Tests ausführen.
Änderungen, die man in der App bemerkt, bekommen eine Zeile im
[Changelog](CHANGELOG.md) unter `[Unreleased]`.

Nicht eingecheckt werden lokale Abhängigkeiten, Build-Ausgaben, Logdateien,
persönliche NoteBases, Profile und Secrets (`.venv/`, `node_modules/`, `dist/`,
`.tmp/`, `*NoteBase/`, `.system/index.db`).

Beiträge stehen unter der [MIT-Lizenz](LICENSE) des Projekts.
