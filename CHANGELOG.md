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

- **Wiederkehrende Tasks**: In den Eigenschaften einer Task wählst du unter
  „Wiederholung“ täglich, werktags, wöchentlich, alle 2 Wochen, monatlich,
  vierteljährlich, jährlich oder einen eigenen Abstand („alle 10 Tage“). Sobald du
  die Task erledigst, legt NickNotes die nächste als neue Task an – mit gleichem
  Titel, Text, Tags und Priorität, die Checkliste wieder offen. Die Statuszeile
  sagt dir, wann sie fällig ist.
- Der Rhythmus richtet sich nach der Fälligkeit: Eine wöchentliche Freitags-Task
  kommt wieder am Freitag, auch wenn du sie verspätet erledigst; verpasste Wochen
  stapeln sich nicht. Mit „ab Erledigung zählen“ beginnt der Abstand stattdessen
  am Tag, an dem du sie erledigst – praktisch für Dinge wie „alle 3 Wochen Haare
  schneiden“.
- Wiederkehrende Tasks erkennst du in der Task-Liste und im Fokus an einem kleinen
  Wiederholungssymbol; der Tooltip nennt den Rhythmus.
- In der Schnellerfassung legst du sie direkt an: `@` schlägt neben Terminen auch
  „Täglich“, „Werktags“, „Wöchentlich“, „Monatlich“ und mehr vor, z. B.
  „Müll rausbringen @wöchentlich“; ein Datum aus dem `@`-Menü legt den ersten
  Termin fest, ohne Datum ist die erste Task heute fällig. Einen eigenen Abstand
  tippst du als `@alle-10-tage`.

- **Fokuszeit auf einen Blick**: Der Fokus zeigt oben „Fokuszeit heute“, der
  Rückblick die Fokuszeit im Zeitraum und als eigene Zeile im Verlauf. Die Werte
  kommen aus den Fokuszeit-Zeilen deiner Tagesnotizen – auch von Hand
  nachgetragene Zeilen zählen mit.
- **Verlinkt von**: In den Eigenschaften einer Notiz siehst du jetzt, welche
  Notizen und Tasks auf sie verweisen. Ein Klick öffnet sie.

- **Schnellerfassung von überall**: Mit **Strg+Alt+N** öffnet sich aus jedem
  Programm heraus ein kleines Fenster, solange NickNotes läuft. Was du dort
  schreibst, landet beim Senden (Strg+Enter) in der heutigen Tagesnotiz – mit
  denselben Regeln wie in der App, eine Zeile mit `@Datum` wird also zur Task.
  Esc schließt das Fenster, der Entwurf bleibt erhalten. Das Kürzel lässt sich
  unter Einstellungen → Allgemein ändern oder abschalten.
- **Symbol im Infobereich** (unten rechts in der Taskleiste): Von dort startest
  du die Schnellerfassung oder eine Fokuszeit, öffnest NickNotes oder beendest
  es. Auf Wunsch läuft NickNotes beim Schließen des Fensters dort weiter
  (Einstellungen → Allgemein), damit Kürzel und Timer erreichbar bleiben.
- Damit Windows die Benachrichtigungen der Fokuszeit auch in der installierten
  App anzeigen kann, meldet sich NickNotes jetzt mit einer eigenen App-Kennung an.

- **Fokuszeit**: Ein Timer für konzentriertes Arbeiten nach der Pomodoro-Idee.
  Im Fokus startest du ihn mit dem Uhr-Symbol an einer Task, einem To-do oder
  einem Eintrag unter „Heute wichtig“. Ohne Aufgabe geht das von überall über
  „Fokuszeit“ in der Leiste über dem Editor (15, 25 oder 50 Minuten) oder mit
  Strg+Alt+F. Die Restzeit erscheint groß auf dem Bildschirm, darunter die
  Aufgabe. Du kannst anhalten und fünf Minuten dazugeben oder abziehen. Mit Esc
  wird daraus ein kleines Fenster unten rechts, das du verschieben kannst und
  das dieselben Knöpfe hat – so vergisst du nie, dass der Timer läuft.
- Ist die Zeit um, gibt es einen leisen Ton und, wenn NickNotes im Hintergrund
  ist, eine Windows-Benachrichtigung. Danach wählst du Pause (5 oder 10 Minuten),
  eine weitere Runde oder hakst die Aufgabe direkt ab.
- Jede Fokusrunde ab einer Minute steht als Zeile in der Tagesnotiz, z. B.
  „Fokuszeit 09:30–09:55 (25 min)“ mit Link auf die Task. So bleibt nachlesbar,
  woran du wie lange gearbeitet hast.
- Was dir während der Fokuszeit einfällt, tippst du unten in „Gedanke
  festhalten“. Er landet als schlichter Text – kein To-do – in der Task, an der
  du arbeitest. Mit dem kleinen Umschalter daneben schickst du allgemeine
  Gedanken stattdessen in die heutige Tagesnotiz. Bei To-dos und Timern ohne
  Aufgabe ist das immer die Tagesnotiz.

### Verbessert

- Ist der lokale NickNotes-Dienst kurz nicht erreichbar (etwa während er beim
  Start noch hochfährt), steht statt „TypeError: Failed to fetch“ jetzt eine
  verständliche Meldung da.

## [2.1.0-rc.7] - 2026-11-19

### Neu

- Tasks lassen sich **zurückstellen**: Mit „Wiedervorlage“ ruht eine Task bis zu
  einem Tag deiner Wahl und erscheint erst dann wieder im Fokus – auch wenn sie
  eigentlich schon überfällig ist. Im Fokus geht das mit einem Klick (morgen,
  nächster Montag, in einer Woche oder eigenes Datum), in den Task-Eigenschaften
  steht das Feld jetzt für alle Tasks bereit.

### Verbessert

- Der **OneNote-Import** übernimmt deutlich mehr: Überschriften, nummerierte
  Listen, durchgestrichenen Text, Code-Blöcke, Dateianhänge und die
  OneNote-Aufgaben als abhakbare To-dos (inklusive Erstell- und Erledigt-Datum).
  Andere OneNote-Kategorien wie „Wichtig“ oder „Frage“ werden zu Tags der neuen
  Gruppe „OneNote“. Jede Notiz behält das echte Erstell- und Änderungsdatum der
  OneNote-Seite sowie Notizbuch und Abschnitt (samt Abschnittsgruppen) als
  Ordner und Eigenschaft.
- Links zwischen OneNote-Seiten zeigen nach dem Import zuverlässig auf die
  richtige Notiz, auch bei gleichnamigen Seiten in verschiedenen Abschnitten.
- Wer dasselbe Notizbuch erneut importiert, bekommt keine Duplikate mehr: bereits
  importierte Seiten werden übersprungen. Nach dem Import zeigt NickNotes, was
  nicht übernommen werden konnte (z. B. Handschrift), und fehlende Bilder sind in
  der Notiz markiert.

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

- In der Schnellerfassung wird eine Textzeile mit `@Datum` zu einer Task mit diesem
  Fälligkeitstag (ohne zusätzliches To-do). Steht das Datum an einem To-do
  (`- [ ]`), bleibt es ein To-do und es entsteht keine Task. Das
  Auswahlfenster nach `@` wird nicht mehr am Fensterrand abgeschnitten, sondern
  öffnet bei Platzmangel nach oben.
  Im Datumsfenster kannst du auch ein eigenes Datum tippen (`20.11.` oder
  `20.11.2026`); ein nicht existierender Tag wird rot unterschlängelt und führt
  nicht zu einer Fälligkeit.

- OneNote-Import: Gelöschte Seiten aus dem OneNote-Papierkorb werden nicht mehr
  mitimportiert, und das temporär geöffnete Notizbuch bleibt danach nicht mehr in
  OneNote zurück. Eine einzelne beschädigte Seite bricht den Import nicht mehr
  ab, und zwei Pakete mit gleichem Dateinamen werden nicht mehr vermischt.

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
