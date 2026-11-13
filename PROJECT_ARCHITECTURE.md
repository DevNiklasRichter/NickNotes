# NickNotes Projektarchitektur

Stand: 13. November 2026, Windows-Kandidat 2.1.0-rc.4. Der
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
    index.db                     SQLite-Projektion, Schema 4
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

Mutationen laufen unter gemeinsamer Sperre und Sessionpruefung. Schreiboperationen
deklarieren ihre Wirkung am Application-Service mit `@coordinated(mutation=True)`;
Ansichtseinstellungen verwenden zusaetzlich `invalidate=False`, eigenstaendige
NoteBase-Lifecycleoperationen `lifecycle=True`. Methodennamen entscheiden nicht
mehr ueber Schreibschutz, Journal oder Aenderungsversion. Dokument-Saves
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
Seit Indexschema 4 teilt jede Volltextzeile die Zeilen-ID ihrer Notiz; Notizen,
Tasks und To-dos sind nach Pfad indiziert. Ein einzelner Reindex durchsucht damit
nicht mehr die gesamte Volltexttabelle. Bestehende `index.db` werden beim Oeffnen
einmalig umgeschluesselt, ohne Markdown zu lesen oder zu aendern.

Alle Quellschreibungen laufen ueber `file_io.atomic_write_*` und damit durch das
Journal, auch Tag-Uebernahme und Task-Abschluss. Kein `Path.write_text` auf
Notizen im Application-Service.

Eine NoteBase wird nie direkt geloescht: `trash.py` verschiebt den Ordner in den
Windows-Papierkorb. Voraussetzung ist eine `.system/config.json` mit `vault_id`;
Ordner ohne diese Kennung, ohne Papierkorb (z. B. Netzlaufwerk) oder bei einem
Fehler bleiben unveraendert und die Ursache wird gemeldet.

Der Graph speichert explizite Links und Tag-Nutzung, keine Shared-Tag-Allpaare.
`related_files` bewertet eine Nachbarschaft bei Bedarf (50, maximal 200 Treffer),
mit Begruendung und Trunkierung. Die Abfrage scannt derzeit linear die
Dateieintraege. Die UI begrenzt globale Ausschnitte auf 500 Knoten/1.500 Kanten.
Details und Messwerte: [Graph](doc/graph-feature.md).

Ein einfacher Polling-Watcher verarbeitet externe Aenderungen unter derselben
Sperre, buendelt SQLite-/Graph-Updates und meldet eine Aenderungsversion.
Fehler bleiben sichtbar; ein manuelles Reindex ist weiterhin moeglich.
`BackendChangeEvent` ist der additive Pydantic-/OpenAPI-Vertrag fuer Version,
Operation, betroffene Pfade und Trunkierung. Der Renderer verwendet Pfade nur bei
einer vollstaendigen, unmittelbar aufeinanderfolgenden Version; Luecken und
unvollstaendige Ereignisse loesen weiter den vollstaendigen Dokumentabgleich aus.

## Frontend

`App.tsx` komponiert die Shell. Dokument-/Taboperationen liegen in
`workspace/useNoteDocuments.ts`, reine Draft-Uebergaenge in `documentState.ts`.
Jeder Tab besitzt Inhalt, eigene gespeicherte Revision und Dirty-Zustand.
`app/useMutationRefresh.ts` besitzt die Ansichtsaktualisierung anhand des
vorhandenen Ereigniskatalogs in `mutationEvents.ts`. Ueberlappende Sidebar-,
Such- und Dashboardplaene werden einmal expandiert; das Fokusaggregat liefert
Tasks/To-dos bereits mit. Ein voller Workspace-Refresh braucht sechs statt zehn
Projektionsabfragen (synthetischer Transportvergleich, keine Latenzzusage).
Suchantworten duerfen nur ihre aktuelle Anfrage aktualisieren; Eingaben lesen
nicht jedes Mal erneut den gesamten Notizkatalog. Externe Abgleiche arbeiten in
Gruppen von acht Requests, beruecksichtigen Abbruch/Sessionwechsel und laden auch
die Tagdefinitionen nach.
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
Popover und Dialoge sind in den nachfolgenden Schnitten beschrieben.
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

`ui/TooltipLayer.tsx` besitzt genau eine fluechtige Hinweisflaeche pro App.
Deklarative Controls liefern `data-tooltip`; ihre Namen und Fachaktionen bleiben
bei den Controls, Shortcuttexte beim Befehlskatalog. Hover und sichtbarer
Tastaturfokus oeffnen zeitversetzt einen nichtfokussierbaren manuellen Popover.
Der vorhandene Positionierungshelfer begrenzt ihn auf das Fenster. Der Hinweis
bleibt beim Ueberfahren erreichbar, nimmt keinen Fokus und verbraucht keine
Tastaturereignisse. Escape, Eingabe, Klick, Scrollen und Fensterwechsel schliessen
ihn; der eigene `aria-describedby`-Verweis wird neben vorhandenen Beschreibungen
gesetzt und gezielt wieder entfernt. Menues, Auswahlpopover und modale Dialoge
begrenzen die erlaubten Ausloeser. Ausgeblendete/abgebaute Ausloeser entfernen
ihren Hinweis. Observer und Listener bleiben innerhalb des Bausteins; keine
Persistenz, Dependency oder Fachmutation. CodeMirror-/Markdown-Inhaltstitel
bleiben beim Editor. `--tooltips` prueft Bedienung und ausdruecklich synthetische
Rand-/Lebensdauerproben. Details: [Tooltips](doc/tooltips-2026-11-13.md).

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

`settings/SettingsEditorPanel.tsx` verwendet dieselbe Dialogfokussteuerung.
Bereichsbuttons besitzen einen aktiven Zustand und Pfeil-/Home-/End-Navigation;
Inhalte bleiben als benannte Region erreichbar. Eigene Styles werden zusammen
mit der bereits verzoegert geladenen Komponente geladen. Kleine Fenster und
Zoom verwenden eine begrenzte Scrollflaeche statt einer festen Mindesthoehe.
Die bisherige globale Escape-Behandlung ist entfernt. Bei der gemeinsamen
Speichern-/Verwerfen-/Abbrechen-Abfrage ist der untere Dialog unsichtbar und
inert. Verwerfen setzt den Fokus auf die aktuelle Rubrik, bevor sein eigener
Button deaktiviert wird.
`AppSettingsService` behaelt den bestehenden UI-Settings-Schreibweg. Eine in App
gehaltene gemeinsame Save-Promise sperrt Doppelaufrufe und erlaubt anderen
Save-/Close-Auftraegen, den tatsaechlichen Abschluss abzuwarten. Gespeicherte
Vergleichswerte werden vor der Freigabe wartender Befehle synchron veroeffentlicht;
unveraenderte Einstellungen erzeugen keinen erneuten Save. Fehler bleiben im
Dialog sichtbar und lassen den Entwurf stehen. App synchronisiert das aktive
Theme-Feld ueber seinen bisherigen Blur-Commit und verwendet danach den im
Layout-Effect aktualisierten Service. So speichern Buttons, Strg+S und der
Schliessen-Abschluss denselben aktuellen Stand. Die Anrede behaelt Leerzeichen
beim Tippen und wird erst beim Speichern normalisiert. Strg+S gilt waehrend
eines Modals nur fuer den aktiv fokussierten, nicht inerten Einstellungsdialog.
OneNote-Picker/-Vorschau/-Import verhindern waehrend ihres Wartens den Dialogabbau;
die Wartephase unterscheidet diese Vorgaenge und fragt Importfortschritt nur
waehrend eines tatsaechlichen Imports ab. Native `summary`-Elemente gehoeren
zur gemeinsamen Tabfolge, auch im bestehenden Recovery-Bereich.
Import, Recovery und Agentenfreigaben behalten ihre vorhandenen Fachpfade.
Keine neue Persistenz, Backend- oder Formatmigration. `--settings-dialog` prueft
die Dialog- und Speicherwege ausschliesslich im isolierten Testprofil.
Nachweise: [Einstellungsdialog](doc/settings-dialog-2026-11-11.md).

`ui/MultiSelectPicker.tsx` besitzt die gemeinsame Mehrfachauswahl der To-do- und
Taskfilter sowie der Editor-Tags/-Verknuepfungen: benannter nichtmodaler HTML-Popover im Body-Portal, echte Checkboxen,
Suche, Tastaturnavigation und Fokusabschluss. Chromiums Popover-API uebernimmt
Top-Layer, exklusives Oeffnen und Aussenklick. Die Fensterbegrenzung teilen
Filter und Kontextmenues ueber `ui/placeFloatingSurface.ts`. Lange Optionen
umbrechen; kleine Fenster scrollen, ohne die Sidebar als Begrenzung zu verwenden.
Tab verlaesst die Auswahl, Escape/Fertig fuehren zum Ausloeser zurueck.
Globale Appbefehle greifen nicht in fokussierte offene Popover ein.
`WorkbenchSidebarContent.tsx` liefert weiterhin Optionen, ausgewaehlte Werte und
die vorhandenen Filtercallbacks. Gruppenauswahl bereinigt Tags weiterhin ueber
denselben Fachpfad; der gemeinsame Baustein besitzt keine Filterengine oder
Persistenz. Doppelte Renderer, Suchzustaende, Listener und Popupstyles sind
entfernt. `--filters` prueft echte Dashboardtreffer, unveraenderte Markdown-
Dateien und erhaltene Editorentwuerfe im isolierten Testprofil.
Nachweise: [Mehrfachfilter](doc/multiselect-filters-2026-11-12.md).

`editor/NotePropertiesPanel.tsx` liefert Tag-/Related-Auswahl an denselben Picker.
Vorhandene Tagdefinitionen und Notizziele sind Optionen; freie Werte werden nur
ueber Hinzufuegen an die bestehenden Normalisierungs-/Dokumentcallbacks gegeben.
Suche und Abbruch erzeugen keine Dokumentmutation. Der Picker speichert keine
fachlichen Werte selbst. Die alten Inline-Datalists und vier App-Zustaende fuer
deren Oeffnung/Eingaben sind entfernt. Felder, Typauswahl und Chipaktionen sind
benannt; Validierungsfehler besitzen Feldbezug und Alertsemantik. Lange Chips
umbrechen innerhalb der verfuegbaren Flaeche.
Ein benannter CSS-Container schaltet unter 360 px Panelbreite auf gestapelte
Feldnamen und Eingaben; sonst stehen fuer die deutschen Beschriftungen 128 px
bereit. Das Titelfeld beobachtet seine Groesse und passt seine Hoehe nach
Breitenwechseln im naechsten Frame an, ohne den Dokumententwurf zu veraendern.
Das bestehende Workspace-Raster begrenzt die dargestellte Capture-Hoehe auf
45 % seiner Hoehe. Die CSS-Praeferenz bleibt erhalten; kleine/gezoomte Fenster
behalten damit eine scrollbar bedienbare Editorflaeche neben Quick Capture.
Die vorhandenen lokalen Eigenschaftsentwuerfe verwenden die stabile Markdown-ID
statt des umbenennbaren Dateipfads als Identitaet. Jedes montierte Panel meldet
seinen aktuellen Commit im Layout-Effect an eine gemeinsame Ref-Map; der Eintrag
verfaellt beim Abbau. `flushNoteInputs` synchronisiert diese Puffer und beide
CodeMirror-Editoren gemeinsam in `flushSync` vor Save, Close und NoteBase-/Tab-/
Ansichtswechsel. Dokumentrevalidierung uebernimmt nur die Eigenschaftspuffer:
Direkt nach einem Save darf kein noch nicht aktualisierter CodeMirror-Puffer
die normalisierte Save-Antwort wieder dirty machen. Die bestehende Feldvalidierung
liefert ihren Erfolg zurueck; ungueltige Werte sperren Save statt still verworfen
zu werden. Escape setzt lokale Taskfeldentwuerfe auf ihren Dokumentstand zurueck.
Die native Close-Pruefung erkennt auch solche noch fokussierten Eingaben.
Der sichtbare Speichern-Button verwendet dieselbe Befehlsfreigabe wie Strg+S;
ein noch nicht durch Blur uebernommener Feldpuffer darf ihn nicht deaktivieren.
Ein Save ordnet seine Antwort ueber die stabile Workspace-Tab-ID zu. Ein vorher
erfolgtes Pfadremapping mit anderer Windows-Slashschreibweise darf weder die neue
Revision noch den Schutz inzwischen weiterbearbeiteter Entwuerfe auslassen.
Backend-Normalisierung, Link-Rewrite und Projektionen bleiben zustaendig.
Ein Titel-Blur uebernimmt nur den lokalen Dokumententwurf. Dateiname und Links
werden beim revisiongesicherten Save normalisiert. Der zusaetzliche Blur-Rename
ist entfernt: Fokussieren/Verlassen eines unveraenderten Titels darf keine
Markdown-Datei schreiben oder ihre Revision entwerten. Explizites Umbenennen
im Explorer bleibt ein eigener bestaetigter Nutzerauftrag.
`--properties` prueft reale Saves, verzögerte Titel-Saves mit Pfadwechsel,
Tag-/Related-Projektionen und native Close-Abfrage ausschliesslich synthetisch.
Nachweise: [Editor-Eigenschaften](doc/editor-properties-2026-11-12.md).

`app/commands.ts` ist der gemeinsame Katalog fuer Menueeintraege, Tastaturkuerzel,
Hilfeseite und Tooltip-Texte. `useAppCommands.ts` fuehrt freigegebene Befehle aus;
`layout/AppMenuBar.tsx` stellt das per Tastatur bedienbare Fenstermenue dar.
`layout/CommandDialogs.tsx` erweitert denselben Quick-Open-Dialog um den
`>`-Befehlsmodus. Die Titelleiste besitzt einen sichtbaren Sucheinstieg,
Strg+O bleibt Notizsuche, Strg+P oeffnet App-Befehle. Die Markdown-Palette behaelt
Strg+K und Strg+Umschalt+P. Notiztreffer kommen weiterhin aus `/search`; bis zu
acht bereits geoeffnete Notizen sind eine eigene Gruppe aus den vorhandenen Tabs,
aktuelle zuerst. Keine neue fachliche Datenquelle oder gespeicherte History.
Befehle verwenden exakt dieselben `AppCommand`s samt Freigabe und Sperrgrund
wie das Menue. Der Dialog wird vor ihrer Ausfuehrung synchron abgebaut und der
urspruengliche Eingabefokus wiederhergestellt. Der Mausausloeser erhaelt dazu wie
die Menueleiste den vorherigen Feld-/Editorfokus. Der bestehende Command-Runner
besitzt weiterhin Fachaktionen, Fehler, Saves und Schutzabfragen.
Suchantworten sind an Query, NoteBase und Verbindungsgeneration gebunden;
Abbruch und sofortiges Ausblenden alter Treffer verhindern stale Enter und
spaete Uebernahmen. Fehler bleiben mit Wiederholung im Dialog. Die gemeinsamen
Dialogfokusregeln und eigene begrenzte Ergebnisflaeche gelten fuer beide Modi.
Nachweise: [Suche und App-Befehle](doc/search-commands-2026-11-13.md).

`operatorNotifications.ts` behaelt Fehler und kritische Hinweise bis zur
ausdruecklichen Bestaetigung; leere Statussetter und spaetere Erfolge loeschen sie
nicht. Identische wiederholte Fehler werden zusammengefasst. `NotificationCenter`
zeigt einen immer erreichbaren Titelzeileneinstieg, einen Alert ausserhalb der
abschaltbaren Statusmeldung und lesbare Details im gemeinsamen Dialogfokus.
Es gibt keine automatische Schreibwiederholung. Die vorhandenen lokalen
Requestfehler/Wiederholungen bleiben bei ihren Formularen. `SaveProgress` meldet
einen noch laufenden Save erst nach 400 ms; der Dokumententwurf bleibt editierbar.
Save und Refreshfehler werden unterschieden. Die alte Launcher-Sonderdarstellung
ist entfernt. `public/motion.css` gilt bereits fuer Startansicht und React:
140-ms-Farbuebergaenge, keine neuen Layoutanimationen, gemeinsame reduzierte
Bewegung. Navigationsicons kommen aus dem Katalog, Standardicons bleiben im
kleinen Core. Nachweise: [Restmodernisierung](doc/remaining-modernization-2026-11-13.md).

`layout/ActivityRail.tsx` gruppiert Schreiben, Aufgaben und Wissen, benennt die
aktive NoteBase und unterscheidet Checkbox-To-dos in Notizen von eigenstaendigen
Task-Dateien. Sichtbare Zielnamen stammen aus dem Befehlskatalog. Dashboardziele
oeffnen beim ersten Klick denselben Tab wie ihr Tastaturbefehl; Notizen, Tags und
NoteBase behalten ihre Sidebarbedienung.
`NotePropertiesPanel` laesst den Titel sichtbar und fasst Metadaten in einer
zunaechst geschlossenen nativen `details`-Disclosure zusammen. Feldentwuerfe und
Committer bleiben montiert; ungueltige Saves oeffnen die Felder wieder.
Der Schreibmodus (F9, Ansicht, Palette, Toolbar) ist ein fluechtiger, an die
Verbindungsgeneration gebundener React-Zustand. CSS blendet Rail, Sidebar,
Eigenschaften und Capture aus, ohne Editoren oder Entwuerfe abzubauen und ohne
Layoutpraeferenzen umzuschreiben. Split, Save-/Close-Schutz und Statushinweise
bleiben bestehen. Sichtbares Beenden oder F9 stellt das vorherige Layout wieder
her; explizite Bereichsnavigation bzw. Sidebar/Capture-Oeffnen beendet den Modus.
NoteBase-Wechsel und Neustart uebernehmen ihn nicht. Keine neue API oder Persistenz.
Inhaltssynchronisierung aendert nur das Dokument: Die aktive Editorgruppe wird
ueber Pane-Fokus gesetzt, nicht ueber `onChange`, das auch beim expliziten Flush
aller Editoren aufgerufen wird. So behaelt eine Suche oder Save im rechten Pane
seinen Kontext. Nachweise: [Navigation und Schreibraum](doc/navigation-writing-2026-11-13.md).

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
- Windows-CI trennt Aenderungsauswahl, Qualitaetspruefung und Paketbau. Reine
  Dokumentation startet keine teuren Tests oder Pakete; Testskriptaenderungen
  brauchen keinen Installer. Tags/manuelle Laeufe werden vollstaendig geprueft.
  Stabile, zur Paketversion passende Tags
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
macOS-/Linux-Entwicklung ist auf Wunsch des Benutzers vom 13. November
zurueckgestellt. Dieser Stand fuehrt keine nativen Buildziele oder Pipelines ein.
Die verbesserte Windows-Paketpruefung erfasst interne Symlinks im Manifest und
kann reine Laufzeitbauten mit `--runtime-only` von einem Installer unterscheiden.

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
