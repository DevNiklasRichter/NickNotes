# NickNotes Projektarchitektur

## Zielbild

NickNotes ist eine lokale Desktop-App fuer eine portable, folder-basierte NoteBase. Die Inhalte sollen ohne App lesbar und editierbar bleiben. Notizen und eigenstaendige Tasks liegen deshalb als Markdown-Dateien vor; abgeleitete Indizes beschleunigen Suche, Dashboards und Graph, ersetzen aber nie die Markdown-Quelle.

Die App ist Windows-first, das Datenformat bleibt grundsaetzlich plattformunabhaengig und kann zum Beispiel in einem synchronisierten Ordner liegen.

## Technischer Stack

| Bereich | Technik |
| --- | --- |
| Desktop-App | Electron, JavaScript (`src/desktop`) |
| Frontend | React 19, TypeScript, Vite (`src/frontend`) |
| Editor | CodeMirror 6, Markdown, Live Preview |
| UI-Helfer | `lucide-react`, `react-markdown`, `remark-gfm` |
| Graph | Cytoscape |
| Backend | Python, FastAPI, Uvicorn (`src/backend`) |
| Lokaler Index | SQLite mit FTS5 |
| Tests/Qualitaet | Python `unittest`, TypeScript-Build, ESLint |

`npm run dev` startet Vite und Electron. Electron startet das Python-Backend lokal auf `http://127.0.0.1:8765`. `npm run build` erzeugt das Frontend-Bundle unter `dist/frontend`.

## Projektstruktur

```text
NickNotes/
  src/
    backend/
      api.py                    # FastAPI-Endpunkte und Runtime-State
      application_services.py   # Service-Fassade fuer API-Use-Cases und Vault-gebundene IO-Regeln
      use_cases.py              # Wiederverwendbare Use-Case-Orchestrierung
      contracts.py              # Geteilte API-Vertragsmodelle und validierte Request-/Response-Typen
      errors.py                 # Einheitliche Domain-Fehler und Fehlerkategorien
      operation_context.py      # Request-/Operation-Kontext fuer Trace, Diagnose und Rollback-Kontext
      config.py                 # Zentrale Runtime-, Sicherheits- und Infrastrukturkonfiguration
      server.py                 # Uvicorn-Start und Parent-Watchdog
      nicknotes_backend/
        vault.py                # NoteBase-Dateien, Migrationen, Tags, Tasks, Medien
        indexer.py              # SQLite-Projektion, Suche, Review-Daten
        todos.py                # Checkbox-To-dos aus Markdown
        graph_index.py          # Graph-Projektion aus Markdown
        graph_storage.py        # Graph-Index und UI-State
        graph_watcher.py        # Best-effort Polling fuer externe Aenderungen
        parser.py               # Quick-Capture-Parsing und Tag-Vorschlaege
        onenote_importer.py     # Lokaler OneNote-.onepkg-Import
        assistant_chat.py       # Read-only Assistant-Retrieval, Kontextaufbau, Chatantworten und Voice-Status-Anbindung
        assistant_changesets.py # Assistant-ChangeSet-Vorschlaege, Organisationsaktionen, Diffs, Hashes und Provider-/Fallback-Erzeugung
        assistant_embeddings.py # Embedding-Entscheidungsstatus, Retrieval-Vergleich und rebuildbare Projektionsregeln
        assistant_security.py   # Assistant-Config, Vault-Pfadregeln und externe Inhaltsfreigaben
        llm_providers.py        # Provider-neutrale LLM-Basisschicht, Secret-Referenzen und Redaction
        ai_client.py            # Kompatibler Smart-Tagging-Client auf der LLM-Basisschicht
      tests/
    desktop/
      main.mjs                  # Electron-Fenster, Backend-Prozess, Dialoge
      preload.cjs               # Schmale IPC-Bridge zum Frontend
    frontend/
      src/
        App.tsx                 # App-Orchestrierung
        assistant/              # Chat-Assistant UI, Chat-Hook und Assistant-API-Client
        editor/                 # Markdown-Editor und Eigenschaften
        explorer/               # Ordner-, Datei- und Tag-Navigation
        workspace/              # Tabs und Split-Editor
        todos/, tasks/          # Arbeitslisten
        focus/, review/         # Fokus- und Review-Dashboards
        graph/                  # Graph-Dashboard
        settings/, layout/      # Einstellungen und Shell
  doc/
    graph-feature.md
  package.json
  requirements.txt
  Start-NickNotes.ps1
```

## NoteBase-Struktur

Eine geoeffnete NoteBase wird von `VaultManager.ensure_structure()` vorbereitet:

```text
MeineNoteBase/
  daily/                        # Tagesnotizen, gruppiert nach YYYY.MM
  tags/                         # generierte Tag-Uebersichten
  tasks/                        # Task-Statusordner und Task-Verknuepfungen
    new_topic/
    open/
    in_progress/
    on_hold/
    done/
  <eigene Ordner>/              # frei organisierbare Markdown-Notizen und Tasks
  .media/                       # Medienassets
  .system/
    config.json                 # Core/Smart-/Assistant-Konfiguration und optionale Provider-Referenzen
    index.db                    # wiederherstellbare SQLite-Projektion
    tag_groups.json             # eindeutige Tag-Definitionen
    favorite_folders.json       # favorisierte Ordner
    ui_settings.json            # persistente UI-Einstellungen inkl. aktivem Theme
    task_status_links.json      # Hilfsindex fuer Task-Statusverknuepfungen
    graph-index.json            # wiederherstellbare Graph-Projektion
    graph-state.json            # gespeicherter Graph-UI-State
```

Alte Namen wie `01_daily`, `02_tags`, `03_tasks`, `system` oder `99_system` werden beim Oeffnen gezielt migriert oder tolerant gelesen. Neue Funktionen sollen die moderne Struktur verwenden.

## Markdown Als Datenbasis

Notizen und Tasks verwenden YAML-aehnliches Frontmatter und einen Markdown-Body. Beim Speichern normalisiert das Backend das Dokument und ergaenzt abgeleitete Felder.

```markdown
---
id: nt_20260602_120000_ab12
node_id: nt_20260602_120000_ab12
title: Beispielnotiz
type: note
status: open
priority: medium
due_date:
created_at: 2026-06-02T12:00:00
updated_at: 2026-06-02T12:00:00
tags:
  - projekt:nicknotes
tags_auto:
  - person:max
related:
  - Pfad/Andere Notiz
related_auto:
  - Noch eine Notiz
---

Text mit {tag:person/max} und [[Pfad/Andere Notiz]].
```

Wichtige Regeln:

- `type: note` und `type: task` sind beide Markdown-Dokumente.
- Manuelle Metadaten liegen in `tags` und `related`.
- Aus Body-Referenzen abgeleitete Metadaten liegen in `tags_auto` und `related_auto`.
- WikiLinks `[[...]]` und relative Markdown-Links werden bei Verschieben oder Umbenennen nachgezogen.
- Medien liegen unter `.media` und werden aus Markdown referenziert.
- Editor-Spaltenbreiten fuer Markdown-Tabellen duerfen direkt vor der Tabelle als HTML-Kommentar
  `<!-- nicknotes-table-widths: 30.0%, 45.0%, 25.0% -->` gespeichert werden; der Kommentar ist
  UI-Metadatum im Markdown, nicht fachliche Projektion.
- Tagesnotizen unter `daily/YYYY.MM/YYYY-MM-DD.md` sammeln Quick Captures, schnelle To-dos und bis zu drei MITs.

## Tagsystem

Das Tag-Vokabular liegt eindeutig in `.system/tag_groups.json`. Ein Tag besteht aus Gruppe und ID, zum Beispiel `projekt:nicknotes`; im Body wird er als `{tag:projekt/nicknotes}` referenziert.

Das Backend kann Gruppen und Tags anlegen, umbenennen, verschieben und loeschen. Referenzen in Markdown werden bei entsprechenden Aktionen aktualisiert. Unter `tags/` erzeugt das Backend lesbare Uebersichtsseiten. Diese Uebersichten und die SQLite-Tabellen `tags` sowie `note_tags` sind Ableitungen, nicht die Definitionsquelle.

Quick Capture erkennt explizite `gruppe:tag`-Angaben und schlaegt bekannte Tags deterministisch vor. Im optionalen Smart-Modus koennen zusaetzlich LLM-Vorschlaege geliefert werden; ohne Provider-Konfiguration, API-Key oder bei Fehlern bleibt die Kernfunktion erhalten. Bestehende OpenAI-Konfiguration bleibt kompatibel, neue Assistant-Arbeiten sollen jedoch provider-neutral geplant werden.

## Assistant-Zielerweiterung

NickNotes soll einen Chat-Assistenten fuer die geoeffnete NoteBase erhalten. Das Zielbild steht in `doc/assistant-feature-plan.md`. Der Assistant ist ein eigener Chat-Arbeitsbereich mit Quellen, Spracheingabe und pruefbaren ChangeSet-Vorschlaegen fuer Notizen, Tasks, Verschiebungen, Tags, Links und Ordnung.

Verbindliche Regeln fuer diese Erweiterung:

- Markdown bleibt die fachliche Quelle; Chatverlauf, Embeddings und LLM-Kontext sind keine fachliche Wahrheit.
- LLM-Provider werden ueber eine provider-neutrale Backend-Schicht angebunden, damit GPT, Claude, Gemini und OpenAI-kompatible lokale Endpunkte moeglich bleiben.
- API Keys, Tokens und Passwoerter duerfen nicht im Frontend liegen, nicht in `.system/config.json` als Klartext gespeichert werden und nicht in Logs oder Fehlerantworten erscheinen.
- Externe Inhaltsuebertragung an Provider muss pro NoteBase explizit aktivierbar sein; der Standard bleibt sicher und datenminimal.
- Assistant-Tools duerfen nur Vault-gebundene Operationen verwenden. Freie Host-Pfade, Shell-Kommandos oder direkte LLM-Dateischreibzugriffe sind nicht erlaubt.
- Spracheingabe startet als lokales Browser-Diktat mit kontrollierter Uebernahme in Chat-Eingabe oder Quick Capture. Providerbasierte Transkription darf erst nach denselben Assistant-Freigabe-, Provider- und Secret-Regeln sichtbar bzw. nutzbar werden.
- Schreibende Aktionen laufen ueber ChangeSets mit Diff, Content-Hash, Konfliktpruefung und Nutzerfreigabe. Erst danach werden bestehende Vault-, Tag-, Task-, Reindex-, Link-Rewrite- und Graph-Pfade verwendet.
- Optionale Embeddings sind nach `ASST-009` bewusst zurueckgestellt. `/assistant/embeddings/status` dokumentiert FTS-/Tag-/Graph-Vergleich, vorgeschlagene `.system`-Artefakte, Rebuild-/Quarantaeneregeln und externe Provider-Freigaben, ohne Inhalte zu uebertragen oder Embedding-Dateien zu erzeugen.

## Tasks Und To-dos

NickNotes unterscheidet zwei Arbeitsformen:

| Typ | Quelle | Verhalten |
| --- | --- | --- |
| Task | Markdown-Datei mit `type: task` | Eigenstaendiges Arbeitselement mit Status, Prioritaet, Faelligkeit, Schaetzung, Blockern und Follow-up |
| To-do | Checkbox-Zeile `- [ ] ...` in einer Markdown-Notiz | Leichtgewichtiger Eintrag, der direkt in der Ursprungsnotiz umgeschaltet und bei Bedarf zu einem Task hochgestuft wird |

Tasks koennen unter eigenen Ordnern liegen. Statusbezogene Dateien unter `tasks/` dienen teilweise als erzeugte Navigationsverknuepfungen. Checkbox-To-dos werden aus Markdown extrahiert; SQLite speichert nur die Projektion fuer Listen und Dashboards.

Quick Capture schreibt Inhalte in die heutige Tagesnotiz. Das Frontend bietet zusaetzlich Fokus-, Task-, To-do- und Review-Dashboards. Der Fokusbereich verwaltet MITs, offene Arbeit, Blocker, Wartezustaende und Kennzahlen.

## Backend

`src/backend/api.py` stellt die lokale REST-API bereit. Neue und refaktorierte Endpunkte sollen ihre
fachliche Arbeit ueber `BackendApiService`, `use_cases.py`, geteilte Contracts und Domain-Fehler
orchestrieren, statt Pfad-, IO- oder Fehlerlogik direkt im Routing zu duplizieren. Lesende und
OS-oeffnende Notiz-Dateizugriffe muessen immer an die geladene NoteBase gebunden bleiben.
Der aktuelle Entkopplungsstand nach `ARCH-022`: Die produktiven API-Use-Cases liegen im
`BackendApiService`; `api.py` bleibt fuer diese Pfade Route, Request-/Response-Mapping und
Kompatibilitaetswrapper.
Python-/TypeScript-Vertraege werden ueber `CONTRACT_SYNC_MODEL_MAP` in `src/backend/contracts.py`,
`CONTRACT_SYNC_TYPES` in `src/frontend/src/contracts/apiContracts.ts` und den Contract-Sync-Test
`src/backend/tests/test_contract_sync.py` abgeglichen. Zusaetzliche Response-Felder bleiben bewusst
forward-kompatibel erlaubt; stabile Top-Level-Felder kritischer Responses duerfen nicht still auseinanderlaufen.

Die Endpunkte decken insbesondere folgende Bereiche ab:

- NoteBase oeffnen, erstellen, umbenennen, loeschen und reindexieren
- Notizen laden, speichern, verschieben, umbenennen, loeschen und mit Medien versehen
- Ordner verwalten und favorisieren
- Quick Capture, Tagesnotizen und Fokusdaten
- Tasks, Checkbox-To-dos und Promotion von To-do zu Task
- Tag-Gruppen, Tags und gefuehrte Tag-Matches
- Suche, Explorer, Review und Graph
- Lokaler OneNote-`.onepkg`-Import
- Persistente UI-Einstellungen
- Provider-neutraler Assistant-Chat mit read-only Retrieval, Vault-relativen Quellen und gesichertem Voice-Provider-Status
- Assistant-ChangeSet-Vorschau und Apply fuer freigegebene Notizverbesserungen mit Diff, Hash-Konfliktpruefung und bestehendem Save-/Reindex-/Graph-Pfad
- Assistant-Organisationsvorschau fuer registrierte Aktionen wie neue Markdown-Notizen, neue Markdown-Tasks und Verschieben ueber bestehende Move-/Link-Rewrite-Pfade
- Assistant-Embedding-Status fuer die evaluierte, aktuell deaktivierte Embedding-Projektion mit Contract-Sync und ohne Provider-Probe

`VaultManager` besitzt die Dateisystemlogik. Mutierende Windows-Dateioperationen laufen ueber
kontrollierte Rename-/Delete-Helfer mit bounded Retry, damit kurzlebige Datei- und Scanner-Locks nicht
zu inkonsistenten Mutationen fuehren. `VaultIndexer` baut daraus `.system/index.db` mit `notes`,
`notes_fts`, `tags`, `note_tags`, `tasks` und `todos`. Ein Reindex muss die wesentlichen Projektionen
aus Markdown wiederherstellen koennen; stabile Todo-Zeitfelder werden bei Einzeldatei-Reindexen aus der
bisherigen Projektion uebernommen.

Der Graph wird ebenfalls aus Markdown abgeleitet. Er umfasst Datei- und Tag-Knoten sowie Link-, Tag-Nutzungs- und Shared-Tag-Kanten. Die Projektion `.system/graph-index.json` wird beim Oeffnen, Reindex, Speichern sowie bei Datei-, Ordner- und Tag-Aenderungen aus Markdown aktualisiert; die sichtbare Graph-Canvas kann davon unabhaengig eine aeltere geladene Kopie halten. Details stehen in `doc/graph-feature.md`.

## Frontend Und Desktop

Electron kapselt die App, startet und stoppt das Backend und bietet eine kleine IPC-Bridge fuer Ordnerauswahl, Importdateien, externe Links, Theme und den Dialog bei ungespeicherten Aenderungen.

Das React-Frontend bietet:

- Explorer fuer Ordner, Notizen, Tasks und Tags
- Assistant-Chat fuer read-only Fragen zur NoteBase mit Quellen, Diktat-Review, Quick-Capture-Uebergabe, ChangeSet-Diff-Review fuer aktuelle Notizen und kompakter Organisationsplanung
- CodeMirror-Markdown-Editor mit Tabs und Split-Ansicht
- Eigenschaften fuer Metadaten, Tags und Beziehungen
- Quick Capture
- Task-, To-do-, Fokus-, Review- und Graph-Dashboards
- Light/Dark Theme, eigene Themes und persistente Layout-Einstellungen

Farben werden im Frontend ueber zentrale CSS-Tokens wie `--text`, `--surface`, `--accent`, Statusfarben,
Highlight-Farbe und Graph-Farben gesteuert. Die eingebauten Themes `light` und `dark` bilden den aktuellen
Standard-Look ab. Benutzerdefinierte Themes liegen in `.system/ui_settings.json` unter `app.themes`;
`app.activeThemeId` speichert das zuletzt gewaehlte Theme. Das Backend normalisiert diese UI-Einstellungen
beim Schreiben, fachliche Daten bleiben davon unberuehrt.

`App.tsx` bleibt die oberste Shell-Komposition, soll aber keine neuen Zustandsmaschinen aufnehmen.
Cross-Cutting UI-Zustaende wie Operator-Meldungen liegen in `src/frontend/src/app/operatorNotifications.ts`;
Assistant-Zustaende wie der Tag-Match-Flow liegen in dedizierten Hooks wie
`src/frontend/src/app/tagMatchAssistantState.ts`; der Chat-Assistant inklusive ChangeSet-Review liegt als Feature-Modul in
`src/frontend/src/assistant`. Neue Frontend-Funktionen sollten vorhandene
Bereichsmodule, Hooks und Services nutzen und `App.tsx` nicht unnoetig weiter aufblaehen.
Der Chat-Assistant darf nicht als neue Zustandsmaschine in `App.tsx` wachsen.

## Konfiguration Und Betrieb

- Projektabhaengigkeiten: `package.json`, `package-lock.json`, `requirements.txt`
- TypeScript/Vite: `tsconfig*.json`, `vite.config.ts`
- Linting: `eslint.config.js`
- Dokumentation: `PROJECT_ARCHITECTURE.md` als Leitplanke, weitere Dokumentation in `doc/`
- NoteBase-Konfiguration: `<NoteBase>/.system/config.json`
- Optionale LLM-Nutzung: Smart-Modus/Assistant plus API-Key-Referenz aus Environment-Variable oder spaeter sicherem Secret-Store; Klartext-Keys gehoeren nicht in `.system/config.json`
- Entwicklungsstart: `npm run dev`
- Build: `npm run build`
- Backend separat: `npm run dev:backend`
- Windows-Komfortstart: `Start-NickNotes.ps1`

Lokale NoteBases, importierte Testdaten, `.tmp/`, `.venv/`, `node_modules/`, `dist/` und erzeugte Projektionen gehoeren nicht in das Repository. Ein frischer Checkout muss mit den getrackten Quellen, `package-lock.json`, `requirements.txt` und der Dokumentation weiterentwickelbar sein.

## Aenderungsleitlinien

1. Markdown bleibt die fachliche Quelle; Projektionen muessen ableitbar bleiben.
2. Eine Funktion soll genau einen klaren Weg haben. Abgeloesten Legacy-Code entfernen, statt eine weitere Variante daneben zu stellen.
3. Bei Dateipfad-Aenderungen Link-Rewrite, Medien, Index und Graph gemeinsam betrachten.
4. Bei Tag-Aenderungen Definitionen, Markdown-Referenzen, Tag-Uebersichten, Index und Graph gemeinsam betrachten.
5. Bei Task-Aenderungen Task-Markdown, Statusverknuepfungen, To-do-Promotion, Index und Dashboards gemeinsam betrachten.
6. UI-Aenderungen auf Verstaendlichkeit, direktes Feedback und moeglichst wenige Bedien-Schritte pruefen.
7. Dateizugriffe auf Notizen nicht mit freien Host-Pfaden implementieren; immer die gemeinsame Vault-Pfadauflösung verwenden.
