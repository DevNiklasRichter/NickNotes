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
`index.css` definiert gemeinsame Text-/Abstandsrollen und geometrische Tokens
einmal; Themes und vorhandene Farbprofile liefern die Farben. Der
[UI-Styleguide](doc/ui-styleguide.md) beschreibt deren Einsatz.
`layout/WorkbenchShell.css` besitzt Shell-Raster, Navigation, Sidebar und
Statusleiste. Die Breitenpraeferenz kommt als CSS-Variable aus `App.tsx`;
Zoom verkleinert die Navigation und begrenzt die Sidebar, ohne gespeicherte
Praeferenzen zu aendern. Explizite Gridspalten verhindern leere Restspalten
bei ausgeblendeter Sidebar. Dokumenttypografie bleibt von UI-Textrollen getrennt.

`npm run ux:baseline` erfasst die echte Entwicklungsoberflaeche mit eigenem
Profil und synthetischer NoteBase unter `.tmp/`. Der Aufruf nutzt dieselbe
Electron-/Playwright-Basis wie die vorhandenen Smokes und erzeugt Screenshots,
Layoutmesswerte sowie Bediennachweise fuer Suche, Task-Save, Split und echten
Revisionskonflikt. Recovery wird mit einem lokalen Testjournal dargestellt;
Randkoordinatenproben sind ausdruecklich synthetisch. Das ist eine UX-Baseline,
keine Installerabnahme oder vollstaendige Accessibilityfreigabe. Sichtpruefung,
Nachweise und Grenzen: [UX-Baseline](doc/ux-baseline-2026-11-10.md).
`npm run ux:baseline -- --foundations` prueft zusaetzlich 150 % Zoom,
Sidebarwechsel mit ungespeichertem Entwurf und Persistenz eines eigenen
Farbprofils nach Reload. Screenshots kommen aus Electrons Compositor, damit
Zoomaufnahmen die vollstaendige Fensterflaeche zeigen; Layoutmesswerte bleiben
in CSS-Pixeln. Nachweis: [Gestaltungsgrundlage](doc/ui-foundations-2026-11-10.md).

`ui/ContextMenu.tsx` besitzt die flachen Explorer-, Tab-, Tag-, Graphknoten- und Editormenues:
Portal unter `document.body`, Fensterbegrenzung, Scrollen, Tastaturfokus und
Dismiss-Verhalten. `ui/contextMenuAnchor.ts` beschreibt nur den fluechtigen
Bildschirmanker samt Ausloeser und Fokusfallback, keine gespeicherten Daten.
Fachaktionen bleiben beim jeweiligen Aufrufer; `ContextMenuItem` stellt vor ihrem Aufruf
den Ausloeserfokus wieder her, damit bestehende Dialoge den Fokus uebernehmen
koennen. Entfernte Ausloeser fallen auf Explorer bzw. Editorgruppe zurueck.
Die globalen App-Shortcuts greifen nicht in fokussierte Kontextmenues ein.
Der vorhandene Explorer-Eingabe-/Bestaetigungsdialog gibt beim Schliessen den
Fokus zurueck, begrenzt die Tabfolge und loest sein Ergebnis ohne Timer auf.
Bei Loeschbestaetigungen liegt der Standardfokus auf Abbrechen. Weitere
Popover, Dialoge und Tooltips folgen in eigenen Schnitten.
`npm run ux:baseline -- --foundations --menus` prueft zusaetzlich konkrete
Menueaktionen, deaktivierte Eintraege, Tastatur-/Dialogfokus und sehr kleine
Testfenster. Die reduzierte Fenstermindestgroesse gilt ausschliesslich fuer
das isolierte Testprofil. Details: [Kontextmenues](doc/context-menus-2026-11-10.md).
`TagSidebarV2.tsx` nutzt denselben Baustein fuer Baum-, Gruppen- und Tagaktionen.
Die bisherigen Explorer-Kontextmenue-Styles sind entfernt; Icongeometrie liegt
beim gemeinsamen Menue. `TagActionDialogModal.tsx` besitzt Initialfokus,
Tabbegrenzung und Rueckgabe des Fokus fuer Tagformulare und gemeinsame
Auswahldialoge. Enter auf Buttons fuehrt deren eigene Aktion aus; nur Enter in
Textfeldern bestaetigt ein Formular. Auswahldialoge beginnen auf Abbrechen.
Die Identitaet des Dialogabschlusses steuert den Fokuseffekt, damit Eingaben
nicht bei jedem Render ihren Fokus verlieren. `--tags` ergaenzt den UX-Runner
um echte synthetische Tag-Saves, Abbruchschutz und den gemeinsamen Dirty-Dialog.
Nachweise: [Tagmenues](doc/tag-menus-2026-11-10.md).
`GraphNetworkView.tsx` uebersetzt Canvas-Knotenpositionen bzw. echte
Clientkoordinaten in denselben Fensteranker. Der fokussierbare Canvas waehlt
sichtbare Knoten per Pfeilen/Home/End und oeffnet deren Aktionen mit
Shift+F10/Menuetaste. Auswahl, Hervorheben und die vorhandenen Dateiaktionen
teilen dieselben Callbacks wie die Mausbedienung. Tagknoten besitzen weiterhin
keine Dateiaktionen. Ein Statushinweis nennt Auswahl und Tastaturweg.
Eine reine Auswahl baut bei unveraendertem Linkgraphen und abgeschalteten
Shared-Tag-Kanten keine neue Filterprojektion auf; so bleiben Pan/Zoom erhalten.
Tatsaechlich geaenderte Filter, Daten und Fokusgraphen behalten ihre vorhandene
Neuberechnung. `--graph` prueft echte Canvas-Klicks/Pan/Zoom, Dateiaktionen und
ausdruecklich synthetische Randkoordinaten. Die Graphprojektion und ihr
Dateiformat bleiben unveraendert. Nachweise: [Graphmenues](doc/graph-menus-2026-11-10.md).

`CodeMirrorMarkdownEditor.tsx` uebergibt Auswahl- und Tabellenaktionen an dasselbe
React-Portal. CodeMirror bleibt Besitzer von Textselektion, Cursor und Undo.
Die Auswahlaktion ersetzt nur im noch gueltigen Editor-/Dokumentsnapshot;
verspaetete Tagdialogabschluesse melden einen abgelehnten Ersatz sichtbar.
`markdownLivePreview.ts` haelt Tabellenentwuerfe am jeweiligen Widget-DOM und
uebergibt lediglich fluechtige Menueaktionen. Menuefokus loest keinen vorzeitigen
Blur-Commit aus; Escape gibt den Fokus zurueck, Aussenfokus uebernimmt den Entwurf.
Vor einem expliziten Editor-Snapshot werden auch noch aktive Tabellenfelder in
CodeMirror uebernommen. Strukturaktionen bilden getrennte Undo-Schritte;
Schreibschutz und Widget-Lebensdauer werden vor Mutationen geprueft.
Reine Link-/Tagkontextaktualisierungen verwenden unveraenderte Tabellen-DOMs
weiter, ohne aktive Felder oder Menues abzubauen. Einspaltige Tabellen bleiben
gerendert. Es gibt keine zweite Inhaltsquelle oder Formatmigration.
`--editor-menus` erweitert den UX-Runner um diese Ablaeufe, echte Markdown-Saves,
Undo/Redo und eine isolierte Komponentenprobe fuer Schreibschutz und veraltete
Auswahlcallbacks. Nachweise: [Editormenues](doc/editor-menus-2026-11-10.md).

`ui/MenuButton.tsx` ergaenzt den gemeinsamen Menuebaustein um einen expliziten
Ausloeser mit `aria-haspopup`/`aria-expanded`, Klick-Toggle und Tastaturoeffnung.
Pfeil nach unten/oben startet beim ersten/letzten Eintrag. Nur solche Ausloeser
nehmen ihren eigenen Pointer-/Fokuswechsel vom Aussen-Dismiss aus; andere
Kontextmenues behalten ihr bisheriges Verhalten. Der Baustein besitzt keine
Fachaktionen oder Persistenz. Explorer-/Tagsortierung verwendet Radioeintraege
mit unabhaengiger Auswahl von Modus und Richtung. Bestehende Exploreroptionen
und die lokale Tagsortierung bleiben deren Zustandsquellen.
`WorkbenchSidebarContent.tsx` verwendet dieselben Buttons fuer aktive und
zuletzt geoeffnete NoteBases; ein entfernter Historieneintrag faellt beim Fokus
auf die NoteBase-Seitenleiste zurueck. Umbenennen, Oeffnen, Entfernen und Loeschen
laufen weiterhin ueber den bestehenden Lifecycle-Service samt Dialogen und
Draftschutz. Die alten Sortier- und Hover-Menues sind entfernt. `--sidebar-menus`
prueft Reihenfolgen, Menuetoggle, bestaetigungspflichtige Dialoge, Historie und
Wechsel zwischen zwei isolierten NoteBases. Nachweise:
[Sortierung und NoteBase-Menues](doc/sidebar-menus-2026-11-10.md).

Tagvorschlaege in Quick Capture verwenden denselben Kontextmenuebaustein.
Hover oeffnet ohne Fokusuebernahme; eine kurze Schliessverzoegerung erlaubt den
Pointeruebergang zum Portal. Shift+F10/Menuetaste am Cursor und Rechtsklick auf
eine freie Vorschlagsstelle oeffnen mit Aktionsfokus. CodeMirror-Markierungen
und eine Editorbeschreibung nennen den Tastaturweg. Bereits eingefuegte
`{tag:gruppe/tag}`-Bereiche sind keine freien Vorschlagsstellen.
Aktionen halten einen fluechtigen Editor-/Dokument-/Vorschlagssnapshot und
pruefen ihn vor jeder Uebernahme. Neue Vorschlagslisten, Dokument-/Auswahl- und
Schreibschutzwechsel verwerfen offene Aktionen. Uebernehmen ist ein eigener
Undo-Schritt; Verwerfen verwendet weiterhin den Capture-Service ohne Textersatz.
Der gemeinsame Menuebaustein gibt bei externem Abbau eines fokussierten Menues
den Fokus an seinen noch vorhandenen Ausloeser zurueck. Normale Kontextmenues
behalten ihre initiale Fokusuebernahme.
Die Rueckgabe wartet auf tatsaechlichen DOM-Abbau und respektiert zwischenzeitlich
fokussierte Controls; StrictMode-Probedurchlaeufe loesen sie nicht aus. Der
Vorschlagseditor bleibt auch bei Schreibschutz per Tab erreichbar.
Der statische `tag_payload`-Formatierer besitzt keine Servicesperre; Preview und
Save bleiben unter ihrer bestehenden Koordination. Ein versehentlicher
Sessionzugriff dieses Helfers hatte nichtleere Capture-Vorschauen verhindert.
`--suggestions` prueft echte Vorschau-/Capture-Saves und isolierte Propwechsel.
Nachweise: [Tagvorschlags-Aktionen](doc/tag-suggestions-2026-11-10.md).

`layout/CreateNoteBaseDialog.tsx` besitzt Darstellung und Tastaturbedienung der
NoteBase-Neuanlage statt des bisherigen Inline-Dialogs in `App.tsx`. Formular-
werte und Fehler liegen weiter in App/Lifecycle-Service. Der Dialog verwendet
`ui/useDialogFocus.ts` gemeinsam mit Notizsuche und Shortcut-Hilfe: Initialfokus,
Tabbegrenzung, Fokuscontainment und Rueckgabe nach tatsaechlichem Abbau und
nativer Pointeraktion. Eine ueberlagerte Speicherabfrage setzt das Formular
unsichtbar und inert; nur der oberste Dialog nimmt Fokus an. Bei inzwischen fokussierten
Controls wird kein Fokus zurueckgestohlen, StrictMode bleibt aktiv.
Der Lifecycle-Service sperrt Neuanlage und Ordnerwahl bereits vor ihren
asynchronen Schritten ueber eine aktuelle Pending-Ref. Validierung und
Requestfehler bleiben im Dialog sichtbar; die bisherige Ansicht wird vor
erfolgreicher Neuanlage nicht abgebaut. Eine erfolgreiche Erstellung wird von
nachfolgenden Settings-/Refreshfehlern unterschieden. Die Anrede wird ueber den
vorhandenen UI-Settings-Pfad gespeichert, bevor die neuen Einstellungen geladen
werden. Keine Formatmigration oder neue Schreibschnittstelle.
`--create-dialog` prueft Start-/Workspace-Abbruch, echte Speicherabfragen,
Directory-Picker-Stub, langsame Requests, echte Namensablehnung, Wiederholung
und synthetische Neuanlage samt Anrede und Rueckkehr zur vorherigen NoteBase.
Nachweise: [NoteBase-Erstellungsdialog](doc/create-notebase-dialog-2026-11-10.md).

`tags/TagMatchDialog.tsx` besitzt die Tag-Matching-Vorschau samt komponentennahen
Styles statt des bisherigen Inline-Modals. Dialogtitel, Vorher-/Nachherregionen,
benannte Navigation und lokale Fehler-/Statusbereiche verwenden die gemeinsame
Fokussteuerung. Tab bleibt im Dialog, Escape/Aussenklick geben den Fokus zurueck;
Vorschauregionen behalten ihre eigene Pfeil-/Scrollbedienung. Kleine Fenster
scrollen innerhalb der begrenzten Dialogflaeche.
`app/tagMatchWorkflowState.ts` behaelt Treffer, Auswahl und uebersprungene IDs.
Eine synchrone Operations-Ref sperrt doppelte Aufrufe vor dem naechsten Render.
Suchanfragen besitzen einen AbortController; Schliessen bricht den Transport ab,
und nur die weiterhin aktuelle Suche darf Ergebnisse oder Fehler uebernehmen.
Schreibende Uebernahmen sperren Suche, Navigation und Abbruch bis zum Abschluss.
App synchronisiert vor der Dirty-Pruefung beide Editorpuffer. Geaenderte
Zielnotizen werden nicht ueberschrieben; ein inzwischen geaenderter Tab wird
auch nach der Antwort nicht pauschal clean gesetzt. Der bestehende Apply-Endpunkt
und das Ereignis `notes-batch-updated` bleiben fuer Datei-, Index-, Graph- und
Ansichtsaktualisierung zustaendig. Null- und Teiluebernahmen verlangen eine
erneute Suche statt unbestaetigte Treffer als erledigt zu entfernen. Eine
bereits erfolgreiche Schreibung bleibt von einem nachfolgenden Refreshfehler
unterscheidbar. Keine neue Fachpersistenz, Dependency oder Formatmigration.
`--tag-matching` prueft den Dialog in einer eigenen synthetischen NoteBase mit
verzoegerten echten Antworten, absichtlichen HTTP-Fehlern und realen Ersetzungen.
Nachweise: [Tag-Matching-Dialog](doc/tag-matching-dialog-2026-11-10.md).

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
