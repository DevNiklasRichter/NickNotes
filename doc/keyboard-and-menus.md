# Menues, Tastatur und Entwicklungsstart

Stand: 13. November 2026, Kandidat 2.1.0-rc.7.

## Bedienung

Die Fensterleiste enthaelt **Datei**, **Bearbeiten**, **Ansicht** und **Hilfe**.
Tastenkuerzel stehen an den Menuebefehlen und den entsprechenden Icons. Graue
Befehle sind im aktuellen Zustand nicht verfuegbar. Haken zeigen die sichtbaren
Bereiche und den Splitmodus. Ansichten sind Tabs im Arbeitsbereich; sie sind
keine weiteren Betriebssystemfenster.

| Befehl | Windows / Linux |
| --- | --- |
| Neue Notiz / neuer Task | Strg+N / Strg+Umschalt+N |
| Notiz suchen und oeffnen | Strg+O |
| App-Befehle suchen und ausfuehren | Strg+P |
| Andere NoteBase oeffnen | Strg+Umschalt+O |
| Heutige Tagesnotiz | Strg+Alt+D |
| Speichern / alle speichern | Strg+S / Strg+Umschalt+S |
| Aktuelle Datei loeschen | Strg+Umschalt+Entf, danach Bestaetigung |
| Aktive Ansicht schliessen | Strg+W oder Strg+F4 |
| Andere / alle Ansichten schliessen | Strg+Alt+W / Strg+Umschalt+W |
| Naechste / vorherige Ansicht | Strg+Tab / Strg+Umschalt+Tab |
| Editor teilen / Split beenden | Strg+\ oder F8 (auch auf deutschen Tastaturen einfach erreichbar) |
| Linke / rechte Editorgruppe | Strg+1 / Strg+2 |
| Zwischen vorhandenen Splitgruppen wechseln | F6 |
| Seitenleiste ein-/ausblenden | Strg+Umschalt+E |
| Editor ein-/ausblenden | Strg+Alt+E |
| Schreibmodus starten / beenden | F9 |
| Quick Capture ein-/ausblenden | Strg+Umschalt+Leertaste |
| Quick Capture oeffnen und fokussieren | Alt+Q |
| Notizen, To-dos, Tasks, Fokus, Tags, Review, Wissensgraph | Alt+1 bis Alt+7 |
| NoteBase-Seitenleiste | Alt+0 |
| In aktueller Notiz suchen | Strg+F |
| NoteBase durchsuchen | Strg+Umschalt+F |
| Markdown-Befehlspalette | Strg+Umschalt+P (bestehendes Strg+K bleibt erhalten) |
| Einstellungen | Strg+, |
| Vollbild | F11 |
| Tastaturhilfe mit Filter | F1 |

Strg+Z, Strg+Y beziehungsweise Strg+Umschalt+Z, Strg+X/C/V und Strg+A wirken im
fokussierten Textfeld. Die Menuebefehle verwenden im Markdown-Editor dessen
eigene Undo-Historie; in normalen Eingabefeldern die nativen Editierfunktionen.
Strg+B und Strg+I bleiben fuer Markdown-Formatierung erhalten. Ein einfaches Entf
loescht Text und niemals eine ganze Notiz. Auf macOS wird fuer Mod-Kuerzel Cmd
erkannt; eine eigene macOS-Paketabnahme ist damit nicht vorweggenommen.

Neue Dokumente werden im Ordner der aktiven Notiz angelegt, bei fehlendem
Dokumentkontext in der NoteBase-Wurzel. Die Explorer-Icons behalten ihren
ausgewaehlten Ordner als Kontext. Nach Anlegen und Oeffnen wird der Editor
fokussiert, damit unmittelbar weitergetippt werden kann.

Strg+O durchsucht Titel und Inhalt mit der vorhandenen Suche. Pfeiltasten waehlen,
Eingabe oeffnet, Esc bricht ab. Ohne geladene NoteBase bietet Strg+O zuerst deren
Auswahl an. Die Trefferliste ist auf 50 Eintraege begrenzt.
Die Titelleiste bietet denselben Dialog sichtbar an. Ohne Suchtext nennt er
zusaetzlich bis zu acht geoeffnete Notizen, die aktuelle zuerst. Mit `>` oder
Strg+P wechselt er zu den App-Befehlen aus demselben Menuekatalog. Die beiden
Bereichsbuttons und Strg+O/Strg+P wechseln auch innerhalb des Dialogs den Modus.
Gesperrte Befehle nennen ihren Grund und fuehren nichts aus. Eingabe und Klick
verwenden bestehende Aktionen samt Speicher-/Loeschschutz. Alte Suchanfragen
werden abgebrochen; Fehler besitzen eine Wiederholung. Escape gibt den Fokus
zurueck. Markdown-Kuerzel Strg+K und Strg+Umschalt+P bleiben unveraendert.
Aktuelle Nachweise: [Suche und App-Befehle](search-commands-2026-11-13.md).

Die linke Navigation gruppiert Schreiben, Aufgaben und Wissen. To-dos stehen
in ihren Ursprungsnotizen, Tasks sind eigene Markdown-Dateien. Dashboardziele
öffnen mit einem Klick denselben Tab wie ihr Tastenkürzel. Notizeigenschaften
sind zunächst gefaltet; Enter/Leertaste auf „Eigenschaften“ öffnet sie, ein
ungültiger Speicherversuch macht fehlerhafte Felder wieder sichtbar.

F9 oder „Schreiben“ in der Editortoolbar startet den Schreibmodus; Ansicht und
App-Befehlssuche bieten denselben Befehl mit aktivem Haken an. Navigation,
Sidebar, Eigenschaften und Capture sind darin ausgeblendet, ihre Entwürfe und
Layoutpräferenzen bleiben erhalten. F9 oder „Schreibmodus beenden“ stellt sie
wieder her. Escape schließt weiterhin lokale Menüs/Dialoge. Alt+1 bis Alt+7,
Alt+0, Alt+Q und ausdrückliches Einblenden von Sidebar/Capture verlassen den
Modus. Split, Speichern und die Rückfrage vor dem Schließen funktionieren weiter.
Nach NoteBase-Wechsel oder Neustart beginnt die normale Ansicht. F11 bleibt
der separate Vollbildbefehl. [Nachweise](navigation-writing-2026-11-13.md).

Alle speichern betrifft die geoeffneten Notiz-/Task-Drafts und geaenderte
Einstellungen; Quick Capture wird dadurch nicht abgeschickt. Vor Save und Close
werden noch gepufferte Editoreingaben uebernommen. Ein Speicherkonflikt beendet
den Sammelspeichervorgang; verbleibende Drafts bleiben erhalten. Alle/andere
Ansichten schliessen verwendet dieselbe Speichern-/Verwerfen-/Abbrechen-Abfrage
wie ein einzelner Tab. Datei loeschen fordert eine gesonderte Bestaetigung.
Mehrere ausdrueckliche Speicheranforderungen werden nacheinander ausgefuehrt,
auch wenn der vorherige Save noch Datenansichten aktualisiert. Bei einem Wechsel
der NoteBase werden wartende Speicherauftraege verworfen.
Der Editor meldet bei dieser expliziten Synchronisierung seinen aktuellen Text
auch dann erneut, wenn der Frame-Puffer bereits geleert wurde, React die
Aenderung aber noch nicht uebernommen hat.

F10 fokussiert das Menue. Alt+D/B/A/H oeffnet Datei/Bearbeiten/Ansicht/Hilfe.
Links/rechts wechselt Menues, hoch/runter navigiert Eintraege; Pos1/Ende und Esc
sind unterstuetzt. Die neuen Such-/Hilfedialoge halten den Tastaturfokus im Dialog
und geben ihn beim Schliessen zurueck.

Die Belegung orientiert sich fuer Notizen und Textbearbeitung an
[Obsidian](https://obsidian.md/help/manage-notes) und
[dessen Editierkuerzeln](https://obsidian.md/help/editing-shortcuts), fuer Tabs und
Editorgruppen an [VS Code](https://code.visualstudio.com/docs/reference/default-keybindings).
Taskanlage und Quick Capture sind NickNotes-spezifische Ergaenzungen. Nicht jede
Belegung ist identisch mit diesen Programmen.

## Reparatur des Entwicklungsstarts

Start bleibt `npm run dev`. Zwei verbundene Fehler erzeugten unnoetige Arbeit:

1. Die Layout-Speicherwirkung hing an Methoden einer bei Renderings neu erzeugten
   Serviceinstanz. Dadurch wurden unveraenderte Layouts erneut gespeichert.
2. Das Backend meldete diese Ansichtseinstellungen als fachliche Aenderung. Das
   externe Refresh lud daraufhin Dokument-/Listendaten und erzeugte weitere
   Renderings und neue Layout-Saves.

Jetzt reagiert Layout-Autosave auf echte Layoutwerte. UI- und Graph-Ansichts-
einstellungen erhoehen die fachliche Aenderungsversion nicht. Die normale
Zustandsabfrage alle 2,5 Sekunden bleibt fuer externe Markdown-/MCP-Aenderungen
bestehen. Das reine Request-Start/-Ende-Logging wurde von INFO auf DEBUG gesetzt;
dies ersetzt die Behebung der Rueckkopplung nicht. DevTools oeffnen sich nur noch
bei bewusst gesetztem `NICKNOTES_DEVTOOLS=1`.

## Pruefung

`npm run check` prueft Backend, Frontend, Lint und Build. `npm run smoke:commands`
startet Vite und Electron im Entwicklungsmodus wie `npm run dev`, aber mit eigenem
Profil, Port und synthetischen Notizen. Es prueft Leerlauf-Requests, Neuanlage,
sofortiges Speichern, mehrere Dirty-Drafts, Notizsuche, Undo/Redo ueber Menues,
Splitfokus, Quick Capture, geschuetztes Schliessen, Loeschbestaetigung, Tastatur-
menues und Hilfe. Ein Neustart prueft das automatische Wiedereroeffnen.
Eine gezielt zurueckgehaltene Speicherantwort prueft zwischenzeitliche Eingaben:
Der neuere Entwurf muss im Editor erhalten bleiben, darf noch nicht in der Datei
stehen und muss beim Schliessen die Speichern-/Verwerfen-/Abbrechen-Abfrage ausloesen.
Eine isolierte Editor-Fixture haelt ausserdem mehr als zwoelf lokale Text-Echos
zurueck: Alte Bestaetigungen duerfen neuere Eingaben nicht ersetzen; echte
externe Textwechsel muessen danach weiterhin uebernommen werden.
Beim Abbrechen und unmittelbaren Wiedereroeffnen des Loeschdialogs werden
Nullzeit-Timer kuenstlich verzoegert. Der Befehl muss trotzdem sofort erneut
verfuegbar sein; erst die folgende Bestaetigung darf die Testdatei loeschen.
Das ist keine Installer-Installation oder VM-Abnahme; diese bleibt beim Benutzer.

Historischer Nachweis vom 8. November: 87 Backendtests, elf Frontendtests, Build sowie Contract-/
Iconpruefung. ESLint meldet null Fehler und die 13 schon vorhandenen Hinweise.
Der echte Entwicklungstest besteht alle genannten Interaktionen einschliesslich
automatischem Wiedereroeffnen nach Neustart. In jeweils 8,5 Sekunden Leerlauf
wurden nur drei bis vier GET-Abfragen von `/state` und kein POST beobachtet;
es gibt keine JavaScript-Seitenfehler. Persoenliche NoteBases blieben unberuehrt.

Der Windows-CI-Workflow ist fuer denselben Entwicklungstest konfiguriert und
sammelt dessen Ergebnisdatei; ein neuer Remote-CI-Lauf ist hier nicht erfolgt.
Lokale Nachweise: `.tmp/commands-check.log`,
`.tmp/commands-contracts.log`, `.tmp/commands-smoke-result.json` sowie
`.tmp/commands-menu.png` und `.tmp/commands-help.png`.

Der lokale Windows-Kandidat `dist/installers/NickNotes-Setup-2.1.0-rc.2-x64.exe`
ist erstellt und nicht signiert. Installer: 129.902.837 Bytes; installierter
Paketbestand: 363.506.850 Bytes in 163 Dateien, davon 17 ASAR-Eintraege. Payload-
Allowlist und SHA-256-Pruefsummen sind geprueft. Auch der Start der gepackten EXE
mit eigenem Profil besteht Editor-, Konflikt-, Theme-, Split-, Dashboard- und
MCP-SDK-Pruefungen einschliesslich Neustart und Widerruf, ohne JavaScriptfehler.
Nachweis: `.tmp/commands-packaged-smoke.log`. Installation, Upgrade und
Deinstallation auf einem Zielsystem wurden damit nicht durchgefuehrt und bleiben
ausdruecklich beim Benutzer.
