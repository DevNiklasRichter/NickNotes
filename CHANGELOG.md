# Changelog

Hier steht, was sich in NickNotes ändert, so geschrieben, dass man es ohne
Programmierkenntnisse versteht. Der Abschnitt einer Version erscheint in der App
unter **Hilfe → Was ist neu** und im Update-Dialog.

Jede Änderung, die man in der App bemerkt, bekommt eine Zeile unter
`[Unreleased]`, einsortiert unter **Neu**, **Verbessert**, **Behoben** oder
**Wichtig beim Umstieg**. `npm run release:prepare -- <Version>` macht daraus den
Abschnitt der nächsten Version.

## [Unreleased]

### Neu

- Tasks lassen sich **zurückstellen**: Mit „Wiedervorlage“ ruht eine Task bis zu
  einem Tag deiner Wahl und erscheint erst dann wieder im Fokus – auch wenn sie
  eigentlich schon überfällig ist. Im Fokus geht das mit einem Klick (morgen,
  nächster Montag, in einer Woche oder eigenes Datum), in den Task-Eigenschaften
  steht das Feld jetzt für alle Tasks bereit.

### Verbessert

- Der **Rückblick** ist aufgeräumt und beantwortet zwei Fragen: Komme ich hinterher, und worum muss ich mich kümmern? Oben steht eine Zeile mit erledigt, neu und offen (samt Veränderung im Zeitraum), darunter ein Verlauf der offenen Arbeit mit neuen und erledigten Einträgen. Bei 90 Tagen wird nach Kalenderwochen zusammengefasst.
- Neu im Rückblick: **Braucht Aufmerksamkeit** mit überfälligen Tasks, fälligen Wiedervorlagen, wartenden oder blockierten Tasks und ToDos, die seit mehr als 30 Tagen offen sind. ToDos lassen sich dort direkt abhaken.
- Die Liste **Erledigt** ist nach Tagen gruppiert, zeigt den ToDo-Text mit seiner Notiz und ist nicht mehr auf zehn Einträge gekürzt.
- Entfallen sind Risiko-Ampel, Kennzahl-Karten, die Listen der meistbearbeiteten Notizen und Tasks sowie der Zeitraum „Heute“ (dafür gibt es den Fokus). Das Info-Symbol neben der Zusammenfassung erklärt, worauf die Zahlen beruhen.
- Der **Fokus** ist neu aufgebaut und deutlich ruhiger: oben das Datum, ein paar
  Kennzahlen und „Heute wichtig“ (höchstens drei Einträge) als schlichte Liste,
  darunter Tasks, To-dos und die heute bearbeiteten Notizen nebeneinander.
- To-dos hakst du direkt im Fokus ab; sie bleiben bis zum Abend durchgestrichen
  stehen, damit ein Fehlklick leicht rückgängig zu machen ist. Ältere offene
  To-dos liegen eingeklappt unter „Früher notiert“.
- Verknüpfte Notizen und Details zu einer Task oder einem To-do erscheinen erst,
  wenn du auf „Kontext anzeigen“ klickst. Sie kommen jetzt aus echten Links und
  gemeinsamen Tags.
- Die Modi „Execution“, „Planning“, „Rescue“ und „Context“, die Zeitraum-Auswahl
  und der „Daily Trail“ entfallen.

### Behoben

- Die technischen Metadaten einer ToDo-Zeile (Erstellzeitpunkt, Block-ID) werden im Editor nicht mehr eingeblendet, wenn der Cursor oder die Auswahl die Zeile berührt. Sie sind damit nicht mehr versehentlich bearbeitbar; der Cursor überspringt sie. Wird eine Klammer der Checkbox gelöscht, verschwindet die ganze Checkbox samt Metadaten, statt Reste im Text zu hinterlassen. Leerzeichen am Zeilenende lassen sich wieder normal tippen, und ein Zeilenumbruch am Ende einer ToDo-Zeile nimmt die Metadaten nicht mehr mit in die neue Zeile.
- ToDos ohne gespeicherten Erstellzeitpunkt (zum Beispiel außerhalb von NickNotes geschrieben) erhöhten im Rückblick den Bestand, tauchten aber nie als „neu“ auf. Sie zählen jetzt ab dem Datum ihrer Notiz.
- Beim ersten Speichern einer Notiz in NickNotes bekamen bereits vorhandene ToDos „jetzt“ als Erstellzeitpunkt und erschienen dadurch gesammelt als neue Arbeit. Ihr unbekannter Zeitpunkt bleibt jetzt unbekannt.
- Zu Tasks gemachte ToDos wurden im Rückblick doppelt gezählt, als ToDo und als Task. Sie zählen jetzt nur als Task.

## [2.1.0-rc.6] - 2026-11-15

### Verbessert

- Die Einstellungen „Agent-Verbindungen“ heißen jetzt **MCP** und sind übersichtlicher: Dienst, neue Verbindung (mit Verbindungsdaten) und bestehende Verbindungen stehen in eigenen Blöcken.
- In allen Einstellungen entfällt die doppelte Trennlinie über dem obersten Eintrag.

### Behoben

- „Im Hintergrund erreichbar“ zeigte sich als ausgeschaltet, obwohl es aktiv war, und ließ sich nicht dauerhaft setzen. Der Schalter zeigt jetzt den tatsächlichen Zustand.

## [2.1.0-rc.5] - 2026-11-15

### Neu

- NickNotes hat ein neues App-Icon: ein schwarz-weißes Notizblatt mit einem N,
  sichtbar in der Taskleiste, im Startmenü und im Installer.
- Agenten wie Claude Code erreichen deine NoteBase jetzt auch, wenn die App
  geschlossen ist: Ein kleiner Hintergrunddienst startet auf Wunsch mit Windows
  (Einstellungen → Agenten).
- Agenten finden zu einer Notiz die verwandten Notizen über Links, Rückverweise und
  gemeinsame Tags.
- Beim Schreiben schlägt „[[“ passende Notizen vor, „#“ deine Tags und „@“ ein
  Datum wie „morgen“, „Freitag“ oder „20.11.“.
- Ein To-do mit Datum in der Schnellerfassung, zum Beispiel
  „- [ ] Angebot schicken @morgen“, wird automatisch eine Task mit diesem
  Fälligkeitsdatum.
- Der Wissensgraph zeigt zuerst die Umgebung der gerade geöffneten Notiz, mit
  wählbarer Tiefe und Tag-Filter. „Ganzer Graph“ bleibt einen Klick entfernt.
- Schreibmodus: Seitenleisten ausblenden und nur schreiben, ohne dass ein Entwurf
  verloren geht.
- Helles und dunkles Design.
- Was ist neu: Nach einem Update zeigt NickNotes einmal, was sich geändert hat.
  Der Update-Dialog zeigt die Neuerungen schon vor dem Herunterladen.

### Verbessert

- Ruhigere, einheitliche Oberfläche: gleiche Menüs, Dialoge und Auswahlfelder
  überall, durchgehend deutsche Begriffe, vollständig per Tastatur bedienbar.
- Notizsuche und App-Befehle liegen in einem gemeinsamen Suchfeld (Strg+O).
- Große NoteBases öffnen und speichern deutlich schneller. Umbenennen geht
  schneller, und im Leerlauf arbeitet NickNotes spürbar weniger.
- Suchindex und Graph-Berechnung liegen jetzt auf dem PC statt in der NoteBase.
  OneDrive synchronisiert damit nur noch, was du selbst anlegst. Auf einem anderen
  PC baut NickNotes beides beim ersten Öffnen neu auf.
- NoteBase löschen verschiebt sie in den Windows-Papierkorb.
- Tags übernehmen und Tasks abschließen sind gegen Abstürze mitten im Schreiben
  abgesichert.
- Von Agenten angelegte To-dos verhalten sich genauso wie in der App angelegte.

### Wichtig beim Umstieg

- Sehr alte NoteBases mit den Ordnern `system`, `99_system`, `01_daily`,
  `02_tags` oder `03_tasks` werden nicht mehr geöffnet. Solche NoteBases vorher
  einmal mit 2.1.0-rc.4 öffnen.
- Für eigene Skripte: Die API-Routen `/vault/open`, `/vault/create` und
  `/vault/reindex` entfallen. `/notebase/*` bleibt.

## [2.1.0-rc.4] - 2026-11-09

- Lokale Markdown-Notizen, Tasks, To-dos, Tags und Wissensgraph; geschützter MCP-Zugriff.
- Windows-Offline-Installer und kontrollierte GitHub-Release-Entwürfe.
- Updateprüfung für signierte Pakete, manueller Download und bestätigter Neustart.
- Schutz gepufferter Notiz- und Capture-Entwürfe beim Fensterschließen.
