# NickNotes Projektarchitektur

Stand: 10. November 2026, Windows-Kandidat 2.1.0-rc.4. Der
[Implementierungsplan](doc/implementation-plan.md) dokumentiert Umsetzung und
Restabnahme; [Releasepruefung](doc/release-candidate-2026-11-08.md),
[Windows-Auslieferung](doc/windows-release.md) und [MCP](doc/mcp-connections.md)
beschreiben Betrieb und Nachweise.
Die nachfolgende Erweiterung fuer Menues, Tastaturbedienung und den reparierten
Entwicklungsstart ist unter [Tasten und Menues](doc/keyboard-and-menus.md) beschrieben.

## Produkt und Datenhoheit

NickNotes ist eine lokale Windows-first Desktop-App fuer eine portable Markdown-
NoteBase. Notizen und eigenstaendige Tasks sind Markdown-Dateien, Checkbox-To-dos
stehen in ihren Ursprungsnotizen. Die Dateien bleiben ohne App lesbar.
`.system/tag_groups.json` definiert Tags eindeutig als `gruppe:tag`; im Text gilt
`{tag:gruppe/tag}`. SQLite, Graph, Task-Links und Tag-Uebersichten sind ableitbar.
Keine fachlichen Daten ausschliesslich in einer Projektion speichern.

Es gibt keinen eingebauten Chat-, Voice- oder Provider-Assistant mehr. Externe
Agenten greifen ueber einen geschuetzten lokalen MCP-Endpunkt auf denselben Kern
wie die UI zu. Deterministische Tagvorschlaege und Tag-Matching bleiben erhalten.

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

Ein Backendprozess und eine aktive NoteBase pro Appinstanz. `api.py` ist der
FastAPI-Transport, `mcp_server.py` der SDK-Transport. `application_services.py`
importiert weder FastAPI noch API-Routing; `session.py` besitzt RuntimeState,
VaultSession, Operationssperre und Sessiongeneration. `commands.py` definiert
Eingaben, `contracts.py` Antworten. Domain-Fehler werden am Transport uebersetzt.
Kein zweiter Fachkern fuer MCP und kein allgemeines Serviceframework.

Die App startet Uvicorn nur auf Loopback (Standardport 8765). Ein zufaelliger
App-Schluessel geht ueber die Prozesspipe an das Backend und ueber eng begrenzte
IPC an den Renderer. Host, Origin, Pfade und Eingabegroessen werden geprueft.
Electron verwendet Context Isolation, Sandbox, CSP und `nicknotes://app`.
Fremde Prozesse auf belegten Ports werden nicht beendet. Pipe und Parent-Watchdog
beenden den eigenen Backendprozess mit der App.

MCP verwendet das offizielle Python-SDK, Streamable HTTP und eigene widerrufbare
Tokens. Freigaben gelten fuer eine NoteBase und besitzen getrenntes Schreibrecht.
Nur Token-Hashes liegen im geraetelokalen Profil. Rechte werden bei jedem Aufruf
geprueft. Keine Shell, freie Host-Dateioperationen oder NoteBase-Loeschung per MCP.
Erstellen/Anhaengen besitzen persistente Wiederholungsbelege; mehrdeutig
unterbrochene Wiederholungen werden als Konflikt gemeldet.

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
    ui_settings.json             Themes und portable UI-Einstellungen
    favorite_folders.json
    index.db                     SQLite-Projektion, Schema 3
    graph-index.json             Graph-Projektion, Version 2
    graph-state.json             Graph-UI-Zustand, Version 2
    migrations/                  Konfigurationssicherungen und Nachweise
    recovery/                    Schreibjournale und Wiederherstellung
    mcp-operations/               Wiederholungsbelege, keine zweite Inhaltsquelle
```

Frontmatter wird mit sicherem YAML gelesen. Unbekannte verschachtelte Felder
bleiben erhalten; doppelte Schluessel und unsichere Typen werden abgelehnt.
Datei-, Frontmatter-, Tiefe- und Aliaslimits begrenzen die Verarbeitung. Stabile
`id` und `node_id` identifizieren Dokumente; doppelte IDs verhindern den Reindex.
Manuelle `tags`/`related` und aus dem Body abgeleitete `tags_auto`/`related_auto`
werden gemeinsam projiziert. Task-Typen gelten unabhaengig vom Ordner.

To-dos erhalten beim Bearbeiten stabile Blockreferenzen und Zeitfelder direkt
im Markdown (`<!-- nn:todo created=... completed=... --> ^nn-todo_...`).
Historisch unbekannte Zeitpunkte bleiben unbekannt. Neue Zeitstempel enthalten
einen Offset; Dashboards verwenden den lokalen Kalendertag. Promotion verweist
im Quelldokument auf den erzeugten Task. Reindex darf keine Historie erfinden.

Alte Konfigurationen und Systemordner werden gezielt migriert. Widerspruechliche
Tagquellen und unbekannte kuenftige Formate brechen vor inhaltlichen Aenderungen
ab. Vorhandene Inhalte werden nicht durch geratenes Zusammenfuehren ersetzt.
Downgrade auf alte Fassungen ist nicht unterstuetzt; dafuer gesicherte NoteBase
und passende Programmfassung verwenden.

## Schreiben und Projektionen

Mutationen laufen unter gemeinsamer Sperre und Sessionpruefung. Dokument-Saves
verwenden erwartete Inhaltsrevisionen. Ein veralteter Stand wird nicht still
ueberschrieben. Einzeldateien werden ueber Nachbardatei, fsync und atomaren
Replace geschrieben. Mehrdateioperationen sichern Originale vor dem ersten
Schreiben in einem begrenzten Journal. Fehler kompensieren Quellen; offene
Vorgaenge werden beim Oeffnen sichtbar und sperren weitere Mutationen bis zur
bewussten Wiederherstellung oder Uebernahme. Wiederherstellung sichert den
aktuellen Stand erneut. Einstellungen bieten diesen Ablauf an.

Dateipfadaktionen beruecksichtigen Link-Rewrite, Medien, Index und Graph.
WikiLinks, Related-Felder und uebliche relative Markdown-Links werden angepasst;
Codebeispiele bleiben unveraendert. Medien werden beim Save weder global
verschoben noch nach vermeintlicher Nichtverwendung geloescht.

`inventory.py` liefert ein gemeinsames, beschnittenes Dateiinventar einschliesslich
Wurzelnotizen und ohne System-/Medien-/generierte Dateien. SQLite-Vollaufbau und
Einzeldatei-Reindex nutzen denselben Pfad, WAL und gebuendelte Transaktionen.
Dateistatistiken erlauben beim Wiedereroeffnen die Wiederverwendung unveraenderter
Projektionen. Ein dirty-Marker ermoeglicht Reparatur nach Projektionsfehlern.

Der Graph speichert explizite Links und Tag-Nutzung, keine Shared-Tag-Allpaare.
`related_files` bewertet eine Nachbarschaft bei Bedarf (50, maximal 200 Treffer),
mit Begruendung und Trunkierung. Die Abfrage scannt derzeit linear die
Dateieintraege. Die UI begrenzt globale Ausschnitte auf 500 Knoten/1.500 Kanten.
Details und Messwerte: [Graph](doc/graph-feature.md).

Ein einfacher Polling-Watcher verarbeitet externe Aenderungen unter derselben
Sperre, buendelt SQLite-/Graph-Updates und meldet eine Aenderungsversion.
Fehler bleiben sichtbar; ein manuelles Reindex ist weiterhin moeglich.

## Frontend

`App.tsx` komponiert die Shell. Dokument-/Taboperationen liegen in
`workspace/useNoteDocuments.ts`, reine Draft-Uebergaenge in `documentState.ts`.
Jeder Tab besitzt Inhalt, eigene gespeicherte Revision und Dirty-Zustand.
Speichern laesst zwischenzeitliche Eingaben stehen; externe Aenderungen
aktualisieren saubere Tabs und markieren Konflikte bei Dirty-Tabs.
Der Save-Abgleich vergleicht das aktuelle geparste Dokument mit dem tatsaechlich
abgesendeten Markdown-Snapshot. `tab.content` allein erkennt Body-/Property-
Aenderungen nicht, da es bis zum Save noch den alten Dateistand enthalten kann.
Eine verspaetete Speicherantwort aktualisiert die Revision, laesst neuere Drafts
aber dirty und behaelt damit die Schliessen-Rueckfrage bei.
CodeMirror behaelt ausstehende lokale Text-Snapshots bis zum zugehoerigen React-
Echo. Sie verfallen weder nach Zeit noch nach einer festen Anzahl weiterer
Eingaben. Bestaetigte Snapshots werden entfernt; echte externe Ersetzungen
leeren die ausstehende Liste und aktualisieren den Editor.

`app/apiClient.ts` zentralisiert Token, Timeouts, Abbruch und Sessionwechsel.
Verspaetete Antworten einer alten NoteBase werden verworfen. OpenAPI/Pydantic
erzeugen TypeScript-Transporttypen; `contracts:check` erkennt Drift. Graph,
Einstellungen und der vollstaendige Iconkatalog werden verzoegert geladen.
Vorhandene CSS-Tokens und Themes sind die gestalterische Grundlage.

`npm run ux:baseline` erfasst die echte Entwicklungsoberflaeche mit eigenem
Profil und synthetischer NoteBase unter `.tmp/`. Der Aufruf nutzt dieselbe
Electron-/Playwright-Basis wie die vorhandenen Smokes und erzeugt Screenshots,
Layoutmesswerte sowie Bediennachweise fuer Suche, Task-Save, Split und echten
Revisionskonflikt. Recovery wird mit einem lokalen Testjournal dargestellt;
Randkoordinatenproben sind ausdruecklich synthetisch. Das ist eine UX-Baseline,
keine Installerabnahme oder vollstaendige Accessibilityfreigabe. Sichtpruefung,
Nachweise und Grenzen: [UX-Baseline](doc/ux-baseline-2026-11-10.md).

`app/commands.ts` ist der gemeinsame Katalog fuer Menueeintraege, Tastaturkuerzel,
Hilfeseite und Tooltip-Texte. `useAppCommands.ts` fuehrt freigegebene Befehle aus;
`layout/AppMenuBar.tsx` stellt das per Tastatur bedienbare Fenstermenue dar.
Speichern und Alle speichern teilen eine Warteschlange fuer Menue, Tasten und
das Speicher-Icon. Jeder Auftrag behaelt seinen angeforderten Dokumentkontext;
weitere Saves werden waehrend eines laufenden Saves nicht still verworfen.
Ein NoteBase-Wechsel oder Abbau des Command-Hooks verwirft wartende Auftraege.
Andere Befehle behalten ihren Schutz gegen gleichzeitige Doppelaufrufe.
Fachaktionen verwenden die bestehenden Dokument-/Explorerfunktionen. Schliessen
fragt Dirty-Drafts ab, Loeschen verlangt eine Bestaetigung. Vor Save und Close
werden gepufferte Editor-Aenderungen synchron in den Dokumentzustand uebernommen.
Die explizite Editor-Synchronisierung meldet den aktuellen Text auch bei leerem
Frame-Puffer erneut innerhalb von `flushSync`, damit noch ausstehende
React-Updates bei Dirty-Pruefung und Sammelspeichern nicht uebersehen werden.
Dialogabschluesse loesen ihr Ergebnis ohne Timer auf und entfernen sofort die
aktive Dialogreferenz. So ist ein abgebrochener Befehl vor dem naechsten
Eingabeereignis wieder frei; doppelte Abschluesse bleiben wirkungslos.
Auch natives Fensterschliessen (X/Alt+F4) fordert vor der Dirty-Pruefung einen
synchronen Editor-Snapshot an. `window-close-guard.mjs` koordiniert diese
Abfrage und anschliessendes Speichern mit eindeutigen Anfrage-IDs. Waehrend
Pruefung und Save ist die Fenstereingabe gesperrt; Abbrechen, Fehler und
Timeout lassen das Fenster wieder bedienbar offen. Fehlende oder veraltete
Antworten erteilen keine Schliessfreigabe. Vor dem React-Start gibt es noch
keinen Notizeditor; die Schnellerfassung nutzt ihren eigenen Profilentwurf.
Nach dem React-Start uebernimmt dieselbe Abfrage auch den gepufferten Capture-
Text und wartet auf dessen lokale Sicherung. Scheitert sie, ist Schliessen nur
nach erneut erfolgreichem Speichern oder ausdruecklichem Verwerfen moeglich.
CodeMirror behaelt seine Textbearbeitung und Undo-Historie; native Eingabefelder
nutzen ausschliesslich erlaubte Editierbefehle ueber die vertrauensgebundene IPC.

Layout-Autosave reagiert auf geaenderte Layoutwerte statt auf neu erzeugte
Servicefunktionen. UI-/Graph-Ansichtseinstellungen erzeugen keine fachliche
Aenderungsversion. So loesen Einstellungen weder Dokumentrevalidierung noch eine
Save-/Refresh-Rueckkopplung aus. Routine-Requestlogs haben DEBUG-Level; Fehler
bleiben sichtbar. DevTools werden nur mit `NICKNOTES_DEVTOOLS=1` automatisch geoeffnet.
Pfadhelfer und Tagdialog-Callbacks besitzen stabile Referenzen. Lifecycle- und
Settings-Service werden mit dem aktuellen Render-Snapshot erzeugt; ihre ueber
Save-Callbacks gekoppelte Instanziierung wird nicht wirkungslos memoisiert.
Refs fuer offene Tabs, Workspace und ungespeicherte Einstellungen werden nach
dem Commit im Layout-Effect aktualisiert. Im Render gilt der aktuelle State.
An Service-Konstruktoren sind Compiler-Ausnahmen eng begrenzt und kommentiert:
Diese speichern Callbacks nur, statt sie waehrend des Renderns auszufuehren
oder zu veraendern. Hook-Reihenfolge und vollstaendige Abhaengigkeiten bleiben
geprueft. Ref-Inhalte sind keine reaktiven Abhaengigkeiten.

Der Desktop registriert IPC und oeffnet sein Fenster vor der Backend-Bereitschaft.
`index.html` und das abhaengigkeitsfreie `public/startup.js` stellen eine kleine
Schnellerfassung bereit. Erst danach laedt `bootstrap.ts` React und die Editoren;
`mountApp.tsx` meldet Renderfehler an die sichtbare Startansicht. Die eigentliche
App erscheint nach Render- und Backend-Bereitschaft. Die Backend-URL wird vorher
ermittelt, der Token wartet auf die Startfreigabe: keine vorzeitigen Anfragen an
einen geratenen Standardport.
Der Pythonprozess startet nach der ersten gezeichneten Eingabe; ein Fallback nach
drei Sekunden verhindert einen dauerhaft blockierten Backendstart bei UI-Fehlern.
Das Laden von React und die Freigabe der Hauptoberflaeche warten bevorzugt auf
zwei Paint-Callbacks, besitzen aber einen einmaligen 500-ms-Timer-Fallback.
Ausbleibende Frames in verdeckten Fenstern blockieren dadurch den Start nicht.
`quick-entry-enabled` meldet DOM-Bereitschaft; `quick-entry-ready` bleibt die
getrennte Markierung fuer beobachtete Paint-Callbacks.
`backend-worker.mjs` besitzt den Prozessstart und die Kontrollpipe. Ein unter
Windows synchron blockierender `spawn` laeuft dadurch ausserhalb des Electron-
Hauptthreads. Readiness, Fehler und Ende werden an Main gemeldet; Shutdown und
Parent-Watchdog bleiben erhalten. Es gibt weiterhin nur einen Backendprozess.

Ein noch nicht abgesendeter Quick-Capture-Entwurf liegt als `capture-draft.md` im
geraetelokalen Profil. `capture-draft-store.mjs` serialisiert atomare Ersetzungen
mit einem Groessenlimit; `useCaptureDraft.ts` uebernimmt denselben Entwurf nach
dem Start. Dies ist keine zweite NoteBase-Schreibschnittstelle: Erst **Senden**
verwendet den vorhandenen Capture-Service, schreibt in die gewaehlte NoteBase
und leert den Profilentwurf nach Erfolg. Dieser Entwurf wird nicht ueber die
NoteBase synchronisiert. Das Theme liegt als reiner Fenster-Startcache in
`window-state.json`.

`scripts/dev.mjs` akzeptiert ausschliesslich die Bereitschaftsmeldung seines eigenen
Vite-Prozesses. Rendererfehler erscheinen im Terminal. `smoke:startup` prueft den
echten npm-Start mit frischem Vite-Cache, blockierter Hauptoberflaeche, absichtlichem
Modulfehler und Entwurfsuebernahme bis ins Markdown.
`scripts/vite-readiness.mjs` erkennt die lokale Vite-URL fuer Entwicklungsstarter
und Menue-Smoke gemeinsam und entfernt dabei ANSI-Steuerzeichen. Die
Readiness-Regressionen pruefen auch farbige und ueber mehrere Chunks verteilte Ausgabe.
`NICKNOTES_STARTUP_DIAGNOSTICS=1` protokolliert Startmarken im Testprofil und
aktiviert nur im Entwicklungsmodus einen zufaelligen lokalen Debug-Port.
Details: [Startverhalten](doc/startup-and-recovery.md) und
[GitHub-Pipeline erklaert](doc/github-pipeline.md).

## Entwicklung und Auslieferung

- Stack: Electron, React 19, TypeScript, Vite, CodeMirror 6, Cytoscape,
  Python 3.13, FastAPI/Uvicorn, SQLite FTS5, offizielles MCP-Python-SDK.
- `npm ci`, `.venv/Scripts/python -m pip install -r requirements-dev.txt`.
- `npm run dev`; Pruefung: `npm run check`, `contracts:check`, `icons:check`.
- Runtime-, Dev- und Build-Locks sind getrennt; nur Buildlaufzeit wird gepackt.
- `npm run package:win`: PyInstaller onedir + Electron/NSIS x64, offline,
  pro Benutzer. Auf dem Zielgeraet sind Node/Python nicht erforderlich.
- Ressourcen ueber `process.resourcesPath`, keine Abhaengigkeit vom Arbeitsordner.
  Profil standardmaessig `%APPDATA%/NickNotes`, NoteBase separat gewaehlt.
- Projektlizenz MIT, Metadaten und Drittanbieterhinweise im Paket; eigenes
  Vektor-/Windows-Icon unter `build`, Export mit `scripts/generate-app-icon.ps1`.
- `stage:app` nimmt nur die expliziten Desktop-Abhaengigkeiten `electron-updater`,
  `semver`, `yaml` und ihren aufgeloesten Laufzeitbaum auf. Ein Paketmanifest
  erlaubt diesen Baum; gebuendelte Renderer-Abhaengigkeiten bleiben draussen.
- `verify:package`, `smoke:desktop`, `release:checksums` pruefen den Kandidaten.
  Der Paket-Smoke haelt einen Notiz-Leseaufruf gezielt zurueck und wartet danach
  auf den geladenen Notiz-Editor. Er prueft Speichern bis in die Markdown-Datei
  sowie die tatsaechlichen HTTP-Antworten 200 bzw. 409 bei einem Revisionskonflikt.
- Windows-CI baut und prueft Kandidaten. Stabile, zur Paketversion passende Tags
  auf `main` erzeugen nach bestandenen Pruefungen einen leeren Release-Entwurf.
  Die Signierung erfolgt auf Wunsch des Benutzers ausschliesslich auf seinem
  anderen Laptop. `package:release`, `release:verify` und `release:draft` sind
  fuer diesen Ablauf vorbereitet; hier wurde keine Signierung ausgefuehrt.
- CI-Actions sind auf offizielle Commits gepinnt; der Kandidaten-Upload nutzt
  `actions/upload-artifact` 7.0.0 mit Node-24-Laufzeit.
- Die CI installiert vor den Pruefungen die zum Lockfile gehoerende Electron-
  Laufzeit explizit. Nur dieser Installationsschritt wird bei Fehlern bis zu
  dreimal versucht (10/20 Sekunden Pause, fuenf Minuten Gesamtlimit); EXE und
  Version werden danach geprueft. Smoke-Tests werden nicht automatisch wiederholt.

Persoenliche NoteBases, `.tmp`, `.venv`, `node_modules`, `dist`, Profile und
generierte Projektionen gehoeren nicht ins Repository. Tests verwenden nur
synthetische Bestaende. Fuer die oeffentliche Windows-Auslieferung sind Quellcode
und Downloads im selben oeffentlichen GitHub-Repository vorgesehen. Signierte
Assets werden erst nach Pruefung an den Entwurf angehaengt; die Veroeffentlichung
bleibt eine ausdrueckliche Aktion in GitHub. Main-Pushes veroeffentlichen nichts.
App-ID und Profilpfad bleiben stabil. Installer-/Upgradeabnahme bleibt beim Benutzer.
Linux/macOS und eigene Synchronisation benoetigen spaeter eigene Abnahme.

`update-service.mjs` koordiniert ausschliesslich veroeffentlichte stabile Updates
im Hauptprozess. Import und automatische Pruefung erfolgen erst nach dem Start
(30 Sekunden nach Backend-Bereitschaft, danach alle vier Stunden). Download und
Installation sind getrennte Benutzeraktionen. Der Renderer erhaelt nur Status und
feste IPC-Aktionen; keine Feed-URL, Pfade oder Zugangstokens. Die Bridge vertraut
weiterhin nur dem App-Hauptframe. Verfuegbare Updates erscheinen als Hinweis in
der Titelleiste; **Hilfe → Nach Updates suchen** zeigt Version und Fortschritt.

Unsignierte Kandidaten aktivieren den Updater nicht. Signierte Pakete benoetigen
die festgelegte Herausgeberkonfiguration. Vor Installation wird ueber denselben
Close-Guard synchronisiert und gegebenenfalls gespeichert; erst nach Zustimmung
enden Backend und App. Automatische Installation beim normalen Beenden ist aus.
Pruefsummen und Windows-Signatur werden vor Installationsbereitschaft geprueft;
fehlende Signaturpruefung, falscher Herausgeber und Timeout werden abgelehnt.
Kein privater GitHub-Token wird an Benutzer ausgeliefert.
Der Signaturhelfer liest sein festes Pruefskript aus ASAR und uebergibt nur
Dateinamen/Herausgeber als Daten an Windows PowerShell. Der Systempfad ist
explizit, ein geerbter PowerShell-7-Modulpfad wird nur fuer diesen Unterprozess
entfernt. So braucht der Zielrechner weder Entwickler-PATH noch PowerShell 7.

## Leitlinien fuer weitere Aenderungen

1. Zweck, Quelle, Seiteneffekte und Zusammenspiel vor Implementierung klaeren.
2. Markdown-first und zentrale Tagdefinition respektieren.
3. Vorhandene Pfade erweitern, ersetzten Code entfernen; keine Parallelvarianten.
4. Bei Markdown/Task/Tag/Pfadaenderungen Reindex, Links, Graph und Altbestaende pruefen.
5. UI aus Nutzersicht pruefen: klare Begriffe, sichtbares Feedback, sichere Drafts.
6. Keine zusaetzlichen Frameworks oder abstrakten Schichten ohne konkreten Nutzen.
7. Dieses Dokument bei relevanten Architektur-/Format-/Funktionsaenderungen anpassen.
