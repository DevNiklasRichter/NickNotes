# Changelog

## [Unreleased]

Für den ersten stabilen Release stehen die manuelle Windows-Abnahme und die
Signierung auf dem Release-Laptop noch aus.

- Index: Erstöffnen und Speichern skalieren nicht mehr quadratisch mit der Notizanzahl.
- NoteBase löschen verschiebt in den Windows-Papierkorb und verlangt eine NickNotes-Kennung.
- Tag-Übernahme und Task-Abschluss sind durch das Schreibjournal abgesichert.
- Per MCP angelegte To-dos verwenden dieselbe stabile Referenz wie die Oberfläche.
- Die alten Ordnernamen `system`, `99_system`, `01_daily`, `02_tags` und `03_tasks`
  werden nicht mehr unterstützt. NoteBases mit altem Systemordner vorher einmal mit
  2.1.0-rc.4 öffnen.
- Die API-Routen `/vault/open`, `/vault/create` und `/vault/reindex` entfallen;
  `/notebase/*` bleibt.

## [2.1.0-rc.4] - 2026-11-09

- Lokale Markdown-Notizen, Tasks, To-dos, Tags und Wissensgraph; geschützter MCP-Zugriff.
- Windows-Offline-Installer und kontrollierte GitHub-Release-Entwürfe.
- Updateprüfung für signierte Pakete, manueller Download und bestätigter Neustart.
- Schutz gepufferter Notiz- und Capture-Entwürfe beim Fensterschließen.

Noch kein stabiler öffentlicher Release. Vor dem ersten Versionstag einen Abschnitt
`## [2.1.0]` mit den tatsächlich freigegebenen Änderungen und bekannten Grenzen
anlegen. RCs sind Testfassungen und werden stabilen Clients nicht als Update angeboten.
