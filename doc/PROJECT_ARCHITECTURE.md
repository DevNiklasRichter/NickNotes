# NickNotes Projektarchitektur

Stand: 13. November 2026, Windows-Kandidat 2.1.0-rc.6. Dieses Dokument beschreibt
den Ist-Zustand: Grenzen, Zustaendigkeiten und Regeln. Verlauf, Messwerte und
Abnahmenachweise einzelner Aenderungen stehen in den verlinkten Dokumenten unter
`doc/` und in der Git-Historie, nicht hier.

## Produkt und Datenhoheit

NickNotes ist eine lokale Windows-first Desktop-App fuer eine portable Markdown-
NoteBase. Notizen und eigenstaendige Tasks sind Markdown-Dateien, Checkbox-To-dos
stehen in ihren Ursprungsnotizen. Die Dateien bleiben ohne App lesbar.
`.system/tag_groups.json` definiert Tags eindeutig als `gruppe:tag`; im Text gilt
`{tag:gruppe/tag}`. SQLite, Graph, Task-Links und Tag-Uebersichten sind ableitbar.
Keine fachlichen Daten ausschliesslich in einer Projektion speichern.

Es gibt keinen eingebauten Chat-, Voice- oder Provider-Assistant. Externe Agenten
greifen ueber einen geschuetzten lokalen MCP-Endpunkt auf denselben Kern wie die
UI zu. Deterministische Tagvorschlaege und Tag-Matching bleiben erhalten.

## Laufzeit und Grenzen

```text
Electron (Fenster, Ressourcen, Prozesslebensdauer, vertrauensgebundene IPC)
  React / CodeMirror / Cytoscape -- authentifizierte REST-API --+
  Externer Agent -- eigene Freigabe -- MCP /mcp/ -------------+
                                                           |
                        BackendApiService / Commands / Session
                                      |
                      VaultManager + Schreibkoordination
                                      |
                           Markdown / Tags / Medien
                                      |
                     SQLite FTS5 / Graph / Uebersichten
```

Ein Backendprozess pro Windows-Benutzer: der NickNotes-Dienst
(`server.py --service`). Die App startet ihn nicht als Kind, sondern verbindet
sich ueber `service.json` im Benutzerprofil (Port, PID, App-Token, Version) und
startet ihn nur, wenn keiner laeuft oder eine andere Version laeuft. So schreibt
weiterhin genau ein Prozess in jede NoteBase. Die App zeigt eine aktive NoteBase;
`SessionRegistry` haelt daneben NoteBases offen, die Agenten-Freigaben
benoetigen, und schliesst sie nach 10 Minuten ohne Zugriff.

**Hintergrundbetrieb** (nur installierte Windows-App, Schalter unter
MCP, beim ersten Anlegen einer Freigabe eingeschaltet): Autostart
per `HKCU\…\Run` („NickNotes Dienst“), der Dienst laeuft nach dem Schliessen der
App weiter. Ist er aus, setzt die App ihre PID als Besitzer (`/service/owner`);
der Dienst endet dann mit ihr. Installer und Updater beenden den Dienst vor dem
Ersetzen der Dateien; die Deinstallation entfernt den Autostart.

| Modul (`src/backend`) | Zustaendigkeit |
| --- | --- |
| `api.py` | FastAPI-Transport: Routen, Fehleruebersetzung, CORS. Eine Route pro Operation (`/notebase/*`), keine Aliasrouten. |
| `mcp_server.py`, `mcp_grants.py` | MCP-Transport (offizielles SDK, Streamable HTTP) und widerrufbare Freigaben. |
| `security.py` | Loopback-Grenze: Host, Origin, App-Token, Eingabegroesse. |
| `application_services.py` | Transportunabhaengige Operationen. Importiert weder FastAPI noch Routing. |
| `use_cases.py` | Mehrschrittige Ablaeufe: Oeffnen, Speichern, Umbenennen, Verschieben, Fokus, Import. |
| `session.py` | `RuntimeState`, `VaultSession`, `SessionRegistry`, Operationssperre, Sessiongeneration, `@coordinated`, `ProgressTracker`. |
| `server.py`, `service_control.py` | Dienstmodus, `service.json`, Besitzer-Watchdog, geordnetes Beenden. |
| `commands.py`, `contracts.py`, `errors.py` | Eingaben, Antworten, Domain-Fehler. |
| `nicknotes_backend/vault.py` | Fachlogik auf Dateien: Notizen, Tasks, Tags, Medien, Link-Rewrite, Migration. |
| `nicknotes_backend/indexer.py` | SQLite-Projektion und Volltextsuche. |
| `nicknotes_backend/graph_*.py` | Graph-Projektion, Speicherung, Polling-Watcher. |
| `nicknotes_backend/file_io.py`, `source_journal.py`, `recovery.py` | Atomares Schreiben, Journal, Wiederherstellung. |
| `nicknotes_backend/trash.py` | Verschieben einer NoteBase in den Windows-Papierkorb. |

Kein zweiter Fachkern fuer MCP und kein allgemeines Serviceframework.

**Sicherheit.** Uvicorn lauscht nur auf Loopback (Standardport 8765). Ein
zufaelliger App-Schluessel entsteht im Dienst, liegt in `service.json` im
Benutzerprofil und geht ueber eng begrenzte IPC an den Renderer; Vertrauensgrenze
ist der angemeldete Windows-Benutzer. Host, Origin, Pfade und Eingabegroessen werden
geprueft. Electron verwendet Context Isolation, Sandbox, CSP und `nicknotes://app`;
IPC akzeptiert nur den App-Hauptframe. Fremde Prozesse auf belegten Ports werden
nicht beendet. Ohne Hintergrundbetrieb beendet der Besitzer-Watchdog den Dienst mit der App.

**MCP.** Eine Freigabe gilt genau fuer eine NoteBase und besitzt getrenntes
Schreibrecht; sie erreicht ihre NoteBase auch, wenn die App eine andere zeigt.
`search_notes` sortiert Volltexttreffer nach dem Link-Graphen nach,
`get_note_context` liefert Links, Backlinks und Tag-Nachbarn.
Nur Token-Hashes liegen im geraetelokalen Profil; Rechte werden bei jedem Aufruf
geprueft. Keine Shell, freie Host-Dateioperationen oder NoteBase-Loeschung per
MCP. Erstellen/Anhaengen besitzen persistente Wiederholungsbelege; mehrdeutig
unterbrochene Wiederholungen werden als Konflikt gemeldet. Per MCP angelegte
To-dos verwenden dieselbe Referenz `^nn-todo_…` wie die Oberflaeche.
Details: [MCP](mcp-connections.md).

## NoteBase und Format

```text
MeineNoteBase/
  daily/YYYY.MM/                 Tagesnotizen, Quick Capture, MITs
  tasks/                         Tasks und generierte Statusverknuepfungen
  tags/                          generierte Uebersichten
  <eigene Ordner>/                Notizen und eigenstaendige Tasks
  .media/                        Medien; keine automatische Save-Bereinigung
  .system/
    config.json                  Formatversion 2, stabile vault_id
    tag_groups.json              einzige Tagdefinitionsquelle
    ui_settings.json             Farbschema (hell/dunkel) und portable UI-Einstellungen
    favorite_folders.json
    graph-state.json             Graph-Anordnung und -Filter, Version 2
    migrations/                  Konfigurationssicherungen und Nachweise

%LOCALAPPDATA%/NickNotes/notebases/<Name>-<Pfad-Hash>/   geraetelokal
    index.db                     SQLite-Projektion, Schema 4
    graph-index.json             Graph-Projektion, Version 2
    task_status_links.json       abgeleiteter Task-Pfad-Index
    recovery/                    Schreibjournale und Wiederherstellung
    mcp-operations/              Wiederholungsbelege, keine zweite Inhaltsquelle
```

Projektionen und Journale liegen bewusst ausserhalb der NoteBase, damit ein
Sync-Ordner (z. B. OneDrive als Backup) nur Inhalte hochlaedt. Eine verschobene
oder kopierte NoteBase baut sie beim Oeffnen neu auf; Altdateien in `.system/`
werden dabei entfernt, offene Journale uebernommen.

Frontmatter wird mit sicherem YAML gelesen. Unbekannte verschachtelte Felder
bleiben erhalten; doppelte Schluessel und unsichere Typen werden abgelehnt.
Datei-, Frontmatter-, Tiefe- und Aliaslimits begrenzen die Verarbeitung. Stabile
`id` und `node_id` identifizieren Dokumente; doppelte IDs verhindern den Reindex.
Manuelle `tags`/`related` und aus dem Body abgeleitete `tags_auto`/`related_auto`
werden gemeinsam projiziert. Task-Typen gelten unabhaengig vom Ordner.

To-dos erhalten beim Bearbeiten und bei der Schnellerfassung im Fokus dieselben
stabilen Blockreferenzen und Zeitfelder im Markdown
(`<!-- nn:todo created=... --> ^nn-todo_...`). `completed=...` wird nur mit einem
Erledigungszeitpunkt geschrieben. Bestehende Marker mit leerem `completed=`
bleiben lesbar.
Historisch unbekannte Zeitpunkte bleiben unbekannt: Ein beim Speichern
vorgefundenes To-do ohne Zeitfeld bekommt `created=` leer, nicht "jetzt". Nur die
Projektion `todos.created_at` datiert solche To-dos auf `created_at` ihrer Notiz,
damit Auswertungen jedes To-do einem Tag zuordnen koennen. Neue Zeitstempel
enthalten einen Offset; Dashboards verwenden den lokalen Kalendertag. Promotion
verweist im Quelldokument auf den erzeugten Task. Reindex darf keine Historie
erfinden.

Der Rueckblick (`GET /review/dashboard`, `VaultIndexer.review_dashboard`)
rekonstruiert den Zeitraum aus dem aktuellen Stand der Quellen: Erstell- und
Erledigt-Zeitpunkte aus Task-Frontmatter und To-do-Zeitfeldern. Es gibt kein
Ereignisprotokoll; geloeschte Eintraege verschwinden daher auch rueckwirkend.
Zu Tasks gemachte To-dos zaehlen nur als Task, Checklisten in Tasks werden nicht
als To-dos indiziert. Die Antwort enthaelt Tagesreihe (offen/neu/erledigt),
Zusammenfassung, Aufmerksamkeitsgruppen (ueberfaellig, Wiedervorlage faellig,
wartend/blockiert, To-dos aelter als `REVIEW_STALE_TODO_DAYS`; jeder Task in
hoechstens einer Gruppe) und die erledigten Eintraege. Die Wochenbuendelung fuer
lange Zeitraeume passiert im Frontend (`review/reviewSeries.ts`).

Beim Senden der Schnellerfassung wird ein offenes To-do mit Termin
(`- [ ] Angebot schicken @2026-11-20`) per Promotion zur Task mit diesem
Faelligkeitsdatum; die Zeile bleibt in der Tagesnotiz stehen. In anderen Notizen
ist `@Datum` nur Text. Im Editor (auch in der Schnellerfassung) schlagen `[[`
Notizen, `#` definierte Tags und `@` Termine vor (`inlineSuggestions.ts`, ueber
dieselbe Palette wie `/`). Der Graph zeigt standardmaessig die Umgebung der
gerade bearbeiteten Notiz (1 oder 2 Ebenen, optional nach einem Tag gefiltert).

Der Fokus (`focus/focusDashboardModel.ts`) leitet alles aus Tasks, To-dos und
Notizzeilen von `/focus/dashboard` ab; das Backend liefert keine eigenen
Kennzahlen. Heute dran sind offene Tasks, die faellig oder ueberfaellig sind,
`in_progress` stehen oder deren Wiedervorlage (`follow_up_date`) erreicht ist.
Eine Wiedervorlage in der Zukunft stellt eine Task bis zu diesem Tag zurueck,
auch wenn sie ueberfaellig ist; `on_hold` kommt nur ueber eine Wiedervorlage
zurueck. `POST /tasks/{id}/follow-up` setzt oder loescht das Feld ueber den
normalen Speicherpfad (`save_note_content`, Revision, Reindex, Graph).
To-dos von heute sind die mit heutigem Erstellzeitpunkt (ohne `created=` gilt
der der Notiz) oder aus der heutigen Tagesnotiz; heute abgehakte bleiben
durchgestrichen an ihrem Platz. „Heute
wichtig“ (hoechstens drei `task:`/`todo:`-Schluessel) bleibt im Frontmatter
`mit` der Tagesnotiz. Kontext laedt erst auf Knopfdruck ueber `/graph/related`.

Die Ordnernamen `daily`, `tags`, `tasks`, `.media` und `.system` sind fest. Die
frueheren Namen (`system`, `99_system`, `01_daily`, `02_tags`, `03_tasks`) werden
nicht mehr erkannt: Eine NoteBase mit altem Systemordner wird vor jeder Aenderung
mit einem Hinweis abgelehnt, gleichnamige eigene Ordner sind normale Ordner.
Alte Konfigurationen (`config.json` vor Formatversion 2) werden weiterhin gezielt
migriert. Aeltere Ordnerlayouts (`00_inbox`, `daily/notes`, Tagesnotizen direkt
unter `daily/`) werden nicht mehr umgezogen; solche Dateien bleiben normale Notizen. Widerspruechliche Tagquellen und unbekannte kuenftige Formate brechen
vor inhaltlichen Aenderungen ab. Downgrade ist nicht unterstuetzt.

## Schreiben und Projektionen

Operationen deklarieren ihre Wirkung am Application-Service mit `@coordinated`:
`mutation=True` fuer Schreibvorgaenge, zusaetzlich `invalidate=False` fuer reine
Ansichtseinstellungen und `lifecycle=True` fuer NoteBase-Lifecycleoperationen.
Alle laufen unter einer gemeinsamen Sperre mit Sessionpruefung.

- **Ein Wiederherstellungsweg.** Jede Mutation oeffnet ein `SourceJournal`. Es
  sichert Originale vor dem ersten Schreiben, stellt sie bei einem Fehler wieder
  her und setzt den dirty-Marker, der die Projektionen beim naechsten Aufruf
  repariert. Es gibt keine zusaetzlichen Rollbacks pro Schritt.
- **Ein Schreibweg.** Quelldateien werden ausschliesslich ueber
  `file_io.atomic_write_*` geschrieben (Nachbardatei, fsync, atomarer Replace);
  nur so erfasst das Journal sie. Kein `Path.write_text` auf Notizen.
- **Revisionen.** Dokument-Saves verwenden erwartete Inhaltsrevisionen; ein
  veralteter Stand wird nicht still ueberschrieben.
- **Unterbrochene Vorgaenge** werden beim Oeffnen sichtbar und sperren weitere
  Mutationen bis zur bewussten Wiederherstellung oder Uebernahme.
- **NoteBase loeschen** verschiebt den Ordner in den Windows-Papierkorb und
  verlangt eine `.system/config.json` mit `vault_id`. Ohne Kennung, ohne
  Papierkorb oder bei einem Fehler bleibt der Ordner unveraendert.

Dateipfadaktionen beruecksichtigen Link-Rewrite, Medien, Index und Graph.
WikiLinks, Related-Felder und uebliche relative Markdown-Links werden angepasst;
Codebeispiele bleiben unveraendert. Medien werden beim Save weder global
verschoben noch nach vermeintlicher Nichtverwendung geloescht.

`inventory.py` liefert ein gemeinsames, beschnittenes Dateiinventar ohne System-,
Medien- und generierte Dateien. SQLite-Vollaufbau und Einzeldatei-Reindex nutzen
denselben Pfad, WAL und gebuendelte Transaktionen. Jede Volltextzeile teilt die
Zeilen-ID ihrer Notiz; Notizen, Tasks und To-dos sind nach Pfad indiziert.
Dateistatistiken erlauben beim Wiedereroeffnen die Wiederverwendung
unveraenderter Projektionen.

Der Graph speichert explizite Links und Tag-Nutzung, keine Shared-Tag-Allpaare.
`related_files` bewertet eine Nachbarschaft bei Bedarf (50, maximal 200 Treffer)
und scannt dafuer linear die Dateieintraege. Die UI begrenzt globale Ausschnitte
auf 500 Knoten/1.500 Kanten. Details: [Graph](graph-feature.md).

Ein Polling-Watcher verarbeitet externe Aenderungen unter derselben Sperre und
meldet eine Aenderungsversion. `BackendChangeEvent` nennt Version, Operation,
betroffene Pfade und Trunkierung. Der Renderer verwendet Pfade nur bei einer
lueckenlosen Version; sonst folgt der vollstaendige Dokumentabgleich.

Der Watcher liest alle zwei Sekunden Zeit und Größe aus dem Verzeichnislisting,
ohne Dateien zu öffnen, und bestätigt nur scheinbare Änderungen an der Datei.
Fragt 30 Sekunden kein Client `/state` ab (verstecktes Fenster), prüft er nur
noch alle zehn Sekunden; der Renderer pausiert seine Abfrage, solange das Fenster
verborgen ist. Der eingelesene Graph bleibt im Speicher, solange
`graph-index.json` unverändert ist. Ein Save ohne Änderung an ID, Titel, Tags
oder Verweisen fasst den Graph nicht an; Umbenennen und Verschieben
aktualisieren nur die betroffenen Dateien (ab neun umgeschriebenen Notizen
Vollaufbau). Der Erstaufbau liest Quelldateien stapelweise parallel.
`scripts/benchmark-notebase.py` misst Öffnen, Speichern und Umbenennen auf einem
synthetischen Bestand.

Bekannte Grenzen: Ein Save mit geänderten Tags oder Verweisen löst alle Verweise
neu auf und schreibt `graph-index.json` vollständig. Link-Rewrite beim
Umbenennen liest jede Notiz.

## Frontend

`App.tsx` komponiert die Shell. Die Zustaendigkeiten liegen in:

| Bereich (`src/frontend/src`) | Zustaendigkeit |
| --- | --- |
| `app/apiClient.ts` | Token, Timeouts, Abbruch, Sessionwechsel; verspaetete Antworten alter NoteBases werden verworfen. |
| `app/commands.ts`, `useAppCommands.ts` | Ein Befehlskatalog fuer Menue, Tastenkuerzel, Befehlssuche, Hilfe und Tooltips. |
| `app/useMutationRefresh.ts`, `mutationEvents.ts` | Ansichtsaktualisierung nach Mutationen; ueberlappende Plaene werden einmal ausgefuehrt. |
| `app/useExternalChanges.ts` | Abgleich externer und MCP-Aenderungen. |
| `app/operatorNotifications.ts` | Fehler bleiben bis zur Bestaetigung; keine automatische Schreibwiederholung. |
| `workspace/useNoteDocuments.ts`, `documentState.ts` | Tabs, Drafts, Revisionen, Dirty-Zustand. |
| `editor/` | CodeMirror-Editor, Live-Vorschau, Eigenschaften-Panel. |
| `explorer/`, `sidebar/`, `tags/`, `tasks/`, `todos/`, `focus/`, `review/`, `graph/` | Fachansichten. |
| `layout/` | Shell-Raster, Navigation, Fenstermenue, Suche/Befehle, Dialoge, Statusleiste. |
| `settings/` | Einstellungen, Agentenfreigaben, Recovery; verzoegert geladen. |
| `ui/` | Gemeinsame Bausteine: `ContextMenu`, `MenuButton`, `MultiSelectPicker`, `TooltipLayer`, `useDialogFocus`, `placeFloatingSurface`. |
| `contracts/` | Aus OpenAPI/Pydantic erzeugte Transporttypen; `contracts:check` erkennt Drift. |

Regeln, die Aenderungen einhalten muessen:

- **Drafts gehen nicht verloren.** Speichern laesst zwischenzeitliche Eingaben
  stehen; externe Aenderungen aktualisieren saubere Tabs und markieren Konflikte
  bei Dirty-Tabs. Vor Save, Close, Tab-, Ansichts- und NoteBase-Wechsel werden
  Editor- und Eigenschaftspuffer synchron uebernommen (`flushNoteInputs`).
- **Antworten gehoeren zu ihrer Anfrage.** Save-Antworten werden ueber die
  stabile Tab-ID zugeordnet; Suchantworten nur ihrer aktuellen Query, NoteBase
  und Verbindungsgeneration.
- **Ein Baustein pro Bedienmuster.** Neue Menues, Popover, Dialoge und Tooltips
  verwenden die Bausteine unter `ui/`; keine eigenen Fenster-, Fokus- oder
  Dismiss-Listener daneben. Fachaktionen bleiben beim Aufrufer.
- **Titel benennt erst beim Save um.** Titel-Blur aendert nur den Entwurf;
  explizites Umbenennen im Explorer bleibt ein eigener, bestaetigter Auftrag.
- **Speichern laeuft ueber eine Warteschlange** fuer Menue, Tasten und Icon.
  Natives Fensterschliessen fragt denselben synchronen Editor-Snapshot ab
  (`window-close-guard.mjs`); fehlende Antworten erteilen keine Freigabe.
- **Ansichtszustand ist fluechtig oder UI-Setting.** Schreibmodus, Filter und
  Layout erzeugen keine fachliche Aenderungsversion und schreiben kein Markdown.
- **Gestaltung** folgt den Tokens in `index.css` und dem
  [UI-Styleguide](ui-styleguide.md). Es gibt genau zwei Themes (hell, dunkel);
  Farben stehen nur in `index.css`, Buttons, Eingaben und Auswahlfelder sind dort
  einmal definiert. `layout/WorkbenchShell.css` besitzt das
  Shell-Raster; keine Reparaturregeln am Ende von `App.css` ergaenzen.

`npm run ux:baseline` erfasst die echte Entwicklungsoberflaeche mit eigenem
Profil und synthetischer NoteBase unter `.tmp/` (Screenshots, Layoutmesswerte,
Bediennachweise). Schalter wie `--menus`, `--settings-dialog` oder `--properties`
pruefen einzelne Bereiche. Das ist eine UX-Baseline, keine Installerabnahme oder
vollstaendige Accessibilityfreigabe.

Bedienung: [Tasten und Menues](keyboard-and-menus.md).

## Start und Desktop

Der Desktop registriert IPC und oeffnet sein Fenster vor der Backend-
Bereitschaft. `index.html` und das abhaengigkeitsfreie `public/startup.js`
stellen eine kleine Schnellerfassung bereit; erst danach laedt `bootstrap.ts`
React und die Editoren. Nach der ersten gezeichneten Eingabe (Fallback nach drei
Sekunden) verbindet sich `backend-service.mjs` mit dem laufenden Dienst oder
startet ihn ueber `backend-worker.mjs` losgeloest ausserhalb des
Electron-Hauptthreads. Laeuft der Dienst schon (Autostart), entfaellt der
Python-Kaltstart. Die Backend-URL wird vor der Bereitschaft ermittelt, der Token
erst danach freigegeben. Das gepackte Backend hat kein Konsolenfenster und
schreibt im Dienstmodus nach `service.log`.

Ein noch nicht abgesendeter Quick-Capture-Entwurf liegt als `capture-draft.md`
im geraetelokalen Profil (`capture-draft-store.mjs`). Erst **Senden** schreibt
ueber den Capture-Service in die NoteBase. Das Theme liegt als Startcache in
`window-state.json`. Details: [Startverhalten](startup-and-recovery.md).

`update-service.mjs` koordiniert ausschliesslich veroeffentlichte stabile
Updates im Hauptprozess. Download und Installation sind getrennte
Benutzeraktionen; vor der Installation wird ueber den Close-Guard gespeichert.
Unsignierte Kandidaten aktivieren den Updater nicht. Pruefsummen und Windows-
Signatur werden vor Installationsbereitschaft geprueft. Der Renderer erhaelt nur
Status, die Release Notes der angebotenen Version als Klartext und feste
IPC-Aktionen.

`CHANGELOG.md` ist fuer Anwender geschrieben und wird ins Frontend gebuendelt.
**Hilfe → Was ist neu** zeigt den Abschnitt der laufenden Version; nach einem
Versionswechsel oeffnet er sich einmal von selbst (zuletzt gesehene Version im
`localStorage`, Erstinstallation bleibt still). Der Update-Dialog zeigt den
Release-Text der angebotenen Version vor dem Download.

## Entwicklung und Auslieferung

- Stack: Electron, React 19, TypeScript, Vite, CodeMirror 6, Cytoscape,
  Python 3.13, FastAPI/Uvicorn, SQLite FTS5, offizielles MCP-Python-SDK.
- `npm ci`, `.venv/Scripts/python -m pip install -r requirements-dev.txt`.
- `npm run dev`; Pruefung: `npm run check`, `contracts:check`, `icons:check`.
- `npm run package:win`: PyInstaller onedir + Electron/NSIS x64, offline, pro
  Benutzer. Auf dem Zielgeraet sind Node/Python nicht erforderlich. Profil
  standardmaessig `%APPDATA%/NickNotes`, NoteBase separat gewaehlt.
- `stage:app` nimmt nur die expliziten Desktop-Abhaengigkeiten `electron-updater`,
  `semver`, `yaml` auf. `verify:package`, `smoke:desktop`, `release:checksums`
  pruefen den Kandidaten.
- Windows-CI trennt Aenderungsauswahl, Qualitaetspruefung und Paketbau; Actions
  sind auf Commits gepinnt. Stabile Tags auf `main` erzeugen einen leeren
  Release-Entwurf. Signierung erfolgt ausschliesslich auf dem Release-Laptop des
  Benutzers; die Veroeffentlichung bleibt eine ausdrueckliche Aktion in GitHub.
- `release:prepare -- <Version>` macht aus `[Unreleased]` den Abschnitt der
  naechsten Version und setzt Paket- und Lockversion. Dependabot schlaegt
  woechentlich gebuendelte npm-/pip-Updates und monatlich Action-Updates vor.
- macOS-/Linux-Entwicklung ist zurueckgestellt.
- `examples/demo-notebase` ist eine erfundene Beispiel-NoteBase (nur Markdown und
  `.system/tag_groups.json`, keine Projektionen). `npm run readme:media` startet
  die echte App darauf und erzeugt die Screenshots und GIFs in `doc/media` (GIFs
  brauchen ffmpeg). README und `doc/media` zeigen immer diese NoteBase.
- Anwender-Einstieg ist `README.md`; Entwicklerdetails stehen in `CONTRIBUTING.md`.

Details: [Windows-Auslieferung](windows-release.md),
[GitHub-Pipeline](github-pipeline.md).

Persoenliche NoteBases, `.tmp`, `.venv`, `node_modules`, `dist`, Profile und
generierte Projektionen gehoeren nicht ins Repository. Tests verwenden nur
synthetische Bestaende.

## Leitlinien fuer weitere Aenderungen

1. Zweck, Quelle, Seiteneffekte und Zusammenspiel vor Implementierung klaeren.
2. Markdown-first und zentrale Tagdefinition respektieren.
3. Vorhandene Pfade erweitern, ersetzten Code entfernen; keine Parallelvarianten.
4. Bei Markdown/Task/Tag/Pfadaenderungen Reindex, Links, Graph und Altbestaende pruefen.
5. UI aus Nutzersicht pruefen: klare Begriffe, sichtbares Feedback, sichere Drafts.
6. Keine zusaetzlichen Frameworks oder abstrakten Schichten ohne konkreten Nutzen.
7. Dieses Dokument beschreibt den Ist-Zustand und bleibt kurz: Grenzen,
   Zustaendigkeiten und Regeln hier, Verlauf und Nachweise in `doc/`.
