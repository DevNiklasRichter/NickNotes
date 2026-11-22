# NickNotes Projektarchitektur

Stand: 13. November 2026, Windows-Kandidat 2.1.0-rc.7. Dieses Dokument beschreibt
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
    templates/                   Vorlagen als Markdown, nie indexiert
    migrations/                  Konfigurationssicherungen und Nachweise

%LOCALAPPDATA%/NickNotes/notebases/<Name>-<Pfad-Hash>/   geraetelokal
    index.db                     SQLite-Projektion, Schema 6
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

Der OneNote-Import (`onenote_importer.py`) laesst OneNote Desktop eine `.onepkg`
per COM exportieren und schreibt pro Seite eine Notiz unter
`<Ziel>/<Notizbuch>/<Abschnittsgruppen>/<Abschnitt>/`. `created_at`/`updated_at`
stammen aus der Seite; zusaetzliche Frontmatter-Felder `onenote_notebook`,
`onenote_section`, `onenote_page_id` (stabile Seiten-GUID, verhindert doppelte
Importe und loest Seitenlinks auf), `onenote_page_level` (Unterseiten) und
`onenote_authors` (nur bei mehreren Autoren). OneNote-Aufgaben werden To-dos mit
Zeitmarker, andere OneNote-Kategorien Inline-Tags `{tag:onenote/...}`, deren
Definition der Import in `tag_groups.json` (Gruppe `onenote`) eintraegt. Bilder
und Anhaenge liegen im Medienordner der Notiz. Papierkorbseiten werden
uebersprungen; jede Seite wird unter eigenem `SourceJournal` geschrieben.

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

Beim Senden der Schnellerfassung wird eine Textzeile mit `@2026-11-20` direkt zu
einer Task mit diesem Faelligkeitsdatum (kein To-do); die Zeile bleibt als Text in
der Tagesnotiz. Ein To-do (`- [ ] ... @2026-11-20`) bleibt ein To-do und erzeugt
keine Task. Von Hand getippte `@20.11.2026` oder `@20.11.` werden beim Speichern
zu ISO normalisiert; nicht existierende Tage bleiben Text und erzeugen nichts
(`_normalize_capture_dates`). Der Editor unterschlaengelt solche Tage rot
(`invalidDateMarks.ts`). Ein Wiederholungswort macht die Zeile zu einer
wiederkehrenden Task (`repeat` im Frontmatter): `@taeglich`, `@werktags`,
`@woechentlich`, `@zweiwoechentlich`, `@monatlich`, `@vierteljaehrlich`,
`@jaehrlich` (Umlaute oder ae/oe/ue) oder `@alle-N-tage|wochen|monate|jahre`
(`parse_capture_repeat`). Ohne Datum ist sie heute faellig, `werktags` am
naechsten Werktag. Das `@`-Menue bietet diese Woerter nur in den
Schnellerfassungen an (`offerRepeats`), ebenso eine Uhrzeit: `@9:00` oder `@18uhr`
(`parse_capture_time`) macht die Zeile zur Task und setzt `remind_at` auf diese
Uhrzeit am Faelligkeitstag; ohne Datum heute, nach dieser Uhrzeit morgen. In anderen Notizen ist `@Datum` nur Text. Im Editor (auch in der Schnellerfassung) schlagen `[[`
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

Wiederkehrende Tasks tragen `repeat` im Frontmatter (`daily`, `weekdays`,
`weekly`, `monthly`, `yearly` oder `every N days|weeks|months|years`, N bis 365;
Regeln in `recurrence.py`), optional `repeat_from: completion`. Wechselt eine
solche Task auf `done` – beim Speichern (`save_note_document`, also auch per
MCP) oder ueber `POST /tasks/{id}/done` –, legt `create_repeat_successor` die
naechste Instanz als neue offene Task-Datei an: gleicher Titel, Text mit
zurueckgesetzter Checkliste, Tags, Verknuepfungen, Prioritaet, Schaetzung und
naechster Schritt, `repeat_previous` = alte ID; Wiedervorlage, Warten und
Blockierungen werden nicht uebernommen. Faellig ist sie ab der alten
Faelligkeit im festen Rhythmus, immer nach dem Erledigungstag (verpasste
Termine stauen sich nicht); mit `repeat_from: completion` oder ohne Faelligkeit
ab dem Erledigungstag. Monatsenden werden geklemmt (31. → 28./29.). Die erledigte
Task bekommt `repeat_next` = neue ID; erneutes Erledigen nach dem Wiederoeffnen
legt deshalb keine zweite Instanz an. Antworten tragen die neue Task als
`repeatTask` (Speichern) bzw. `nextTask` (Done). Der Index fuehrt die Regel als
`tasks.repeat_rule` (Schema 5; aeltere Indexe bekommen die Spalte und lesen ihre
Task-Dateien beim naechsten Abgleich neu), `GET /tasks` liefert sie als `repeat`;
Task-Liste und Fokus zeigen daran ein Wiederholungssymbol (`TaskTitleMarks`).

Erinnerungen stehen als `remind_at` im Task-Frontmatter, lokale Zeit
`YYYY-MM-DD HH:MM` (`reminders.py`, lesend auch mit `T` oder Sekunden). Der Index
fuehrt sie als `tasks.remind_at` (Schema 6, Nachruesten wie bei `repeat_rule`);
`GET /tasks/reminders` liefert offene Tasks mit Erinnerung, frueheste zuerst.
Das Hauptfenster fragt das alle 30 Sekunden ab (`useTaskReminders`) und zeigt
erreichte Erinnerungen als Windows-Benachrichtigung (Web-`Notification`) plus
Statusmeldung; ein Klick holt das Fenster (`window:action` `show`) und oeffnet
die Task. Welche Erinnerung schon gezeigt wurde, merkt sich das Geraet in
`localStorage` (Schluessel ID + Zeitpunkt, sechs Wochen) - nie im Markdown; eine
geaenderte Zeit meldet sich neu. Verpasste Erinnerungen kommen beim naechsten
Start, mehrere zusammen als eine Meldung. Die naechste Instanz einer
wiederkehrenden Task bekommt die Erinnerung mit gleichem Abstand zur
Faelligkeit und gleicher Uhrzeit (`shift_remind_at`). Der optionale
Tagesueberblick (`dailyOverview` in `desktop-settings.json`, Standard aus)
meldet einmal am Tag nach der gewaehlten Uhrzeit die heute faelligen und
ueberfaelligen Tasks. Erinnerungen setzen eine laufende App voraus (auch
verborgen im Infobereich); der Hintergrunddienst allein meldet nichts.

Vorlagen sind Markdown-Dateien in `.system/templates/` (`templates.py`,
`TemplateStore`). Sie liegen in `.system`, damit sie mit der NoteBase reisen,
aber nie Quelle von Index, Graph oder Tag-Seiten werden. Das Frontmatter einer
Vorlage traegt nur `type` und wiederholbare Felder (`tags`, `priority`,
`estimate_minutes`, `repeat`, `repeat_from`). `POST /templates/save` macht aus einer
gespeicherten Notiz eine Vorlage, benannt nach ihrem Titel. Ihre eigene
Ueberschrift wird dabei zu `{{titel}}`. Aus einer Tagesnotiz wird die Vorlage
„Tagesnotiz“, die `_ensure_daily_note` fuer jede neue Tagesnotiz nutzt.
`/note-groups/add-note` nimmt `template` an: Die Vorlage bestimmt dann die Art
(Notiz/Task) und bringt Text und Felder mit. Platzhalter `{{titel}}`,
`{{datum}}`, `{{wochentag}}` und `{{uhrzeit}}` (auch englisch) werden beim
Anlegen gefuellt, bei Tagesnotizen mit deren Tag. Unbekannte bleiben stehen.

To-dos von heute sind die mit heutigem Erstellzeitpunkt (ohne `created=` gilt
der der Notiz) oder aus der heutigen Tagesnotiz; heute abgehakte bleiben
durchgestrichen an ihrem Platz. „Heute
wichtig“ (hoechstens drei `task:`/`todo:`-Schluessel) bleibt im Frontmatter
`mit` der Tagesnotiz. Kontext laedt erst auf Knopfdruck ueber `/graph/related`.

Die Fokuszeit (`focus/focusTimerModel.ts`, `focus/useFocusTimer.ts`) ist ein
einziger App-weiter Countdown im Frontend. Er rechnet mit Zeitstempeln statt mit
Ticks, gehoert zur geoeffneten NoteBase und verschwindet beim Wechsel. Gestartet
wird er an Tasks, To-dos und „Heute wichtig“ im Fokus, ohne Aufgabe ueber den
Knopf „Fokuszeit“ in der Leiste ueber dem Editor oder den Befehl „Fokuszeit
starten“. Verkleinert bleibt er als verschiebbares kleines Fenster sichtbar
(Position geraetelokal im `localStorage`). Eine Fokusrunde ab einer Minute
(abgelaufen, beendet oder durch eine neue ersetzt) schickt `POST /focus/sessions`;
das Backend haengt genau eine Zeile an die Tagesnotiz ihres Starttages (Uhrzeiten im
mitgeschickten Zeitzonenversatz, nicht in dem des Dienstes):
`- Fokuszeit 09:30–09:55 (25 min): [[<Dateiname>|<Titel>]]`. Bei einer Task
verlinkt die Zeile die Task-Datei, bei einem To-do steht dessen Text mit einem
Link auf die Notiz, frei ohne Ziel nur der optionale Text. Verlinkt wird ueber den
Dateinamen, damit der Link den Umzug nach `tasks/done` uebersteht; `{tag:...}` und
`[[` aus dem Text werden entschaerft, damit die Zeile keine Tags oder Links
erfindet. Es gibt keinen weiteren Speicher fuer Fokuszeiten; Pausen werden nicht
protokolliert. Format und Auslesen der Zeile stehen zusammen in `focus_log.py`.
`VaultIndexer.focus_minutes_by_day` summiert die Minuten aus dem indizierten
Text der Tagesnotizen (auch von Hand getippte Zeilen mit Bindestrich, keine
To-dos oder Fliesstext); `/focus/dashboard` liefert `focusMinutes` fuer den Tag,
der Rueckblick `focus_minutes` je Tag und in der Zusammenfassung. Gedanken aus der Vollansicht schickt `POST /focus/thoughts` als
schlichten Listenpunkt (`- Text`, kein To-do): mit `taskId` ans Ende der Task
ueber den normalen Speicherpfad (Revision, Reindex, Graph), sonst an die
Tagesnotiz. Bei Tasks waehlt ein Umschalter das Ziel, bei To-dos und freien
Timern ist es immer die Tagesnotiz.

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
| `editor/` | CodeMirror-Editor, Live-Vorschau, Eigenschaften-Panel (mit „Verlinkt von“: eingehende Links ueber `GET /graph/context`, dieselbe Nachbarschaft wie `get_note_context` per MCP; geladen erst beim Aufklappen). |
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

Schnellerfassung von ueberall: Ein systemweites Kuerzel (Vorgabe Strg+Alt+N,
waehlbar oder aus) oeffnet `capture.html`, ein kleines rahmenloses Fenster
(`quick-capture-window.mjs`) immer im Vordergrund. Es wird beim ersten Kuerzel
erzeugt und danach nur ein- und ausgeblendet. Die Seite (`src/quickCapture/`)
nutzt denselben Markdown-Editor und speichert ueber `/capture/save` in die
Tagesnotiz der gerade geoeffneten NoteBase (also auch `@Datum` → Task). Bei jedem
Einblenden liest sie die NoteBase neu und beginnt eine neue API-Sitzung. Ihr
Entwurf liegt getrennt von der Schnellerfassung im Hauptfenster als
`quick-capture-draft.md` im Profil. IPC fuer dieses Fenster ist auf
Backend-URL/-Token, den eigenen Entwurf und Ausblenden beschraenkt. Ein Symbol
im Infobereich bietet Schnellerfassung, Fokuszeit (`app:command` an das
Hauptfenster, nur freigegebene Befehle), Oeffnen und Beenden. Kuerzel,
„Beim Schliessen im Infobereich weiterlaufen“ und der Tagesueberblick stehen geraetelokal in
`desktop-settings.json` (`desktop-settings.mjs`); mit dem Schalter verbirgt der
Close-Guard das Fenster statt es zu schliessen, Beenden ueber das Symbol und
Update-Neustarts schliessen regulaer. Die App setzt unter Windows ihre
AppUserModelID (`local.nicknotes.desktop`, wie `appId`), damit Benachrichtigungen
erscheinen.

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
