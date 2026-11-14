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
