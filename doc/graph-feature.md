# Graph Feature

## Zweck

Die Graph-Ansicht macht Beziehungen innerhalb einer NoteBase sichtbar. Markdown-Notizen und Tasks werden als Datei-Knoten dargestellt. Tags, WikiLinks und gemeinsame Tags erzeugen Kanten, die im Frontend gefiltert und als Cytoscape-Graph betrachtet werden koennen.

## Dateien in `.system`

- `.system/graph-index.json`: berechneter Graph-Index.
- `.system/graph-state.json`: UI-Zustand der Graph-Ansicht.
- `.system/tag_groups.json`: definierte Tag-Gruppen und Tags, die der Graph zur Diagnose unbekannter Tags nutzt.

## `graph-index.json`

Der Index ist versioniert (`version: 1`) und enthaelt:

- `files`: pro Markdown-Datei ein Eintrag mit ID, Typ, Titel, Hash, mtime, Tags und WikiLinks.
- `nodes`: Datei-Knoten (`note`, `task`) und Tag-Knoten (`tag`).
- `edges`: Beziehungen zwischen Knoten.
- `diagnostics`: technische Warnungen wie unbekannte Tags, ungeloeste Links oder beschaedigte Indexdateien. Sie sind API-/Status-Metadaten und werden nicht als Graph-Filter oder Layout-Element gerendert.

Pfade werden relativ zur NoteBase gespeichert. `.system`, `system`, `99_system` und `.media` werden nicht als Markdown-Quellen gescannt.

## `graph-state.json`

Der UI-State ist versioniert (`version: 2`) und tolerant lesbar. Alte oder unvollstaendige States werden mit Defaults ergaenzt.

Gespeichert werden:

- `activeMode`: `debug`, `link`, `tag` oder `focus`.
- `viewMode`: `graph` oder `debug`.
- `filters`: sichtbare Node-/Edge-Typen, Mindestgewicht und Suche. Legacy-Felder wie `showBacklinkEdges` oder `showDiagnostics` werden toleriert, aber nicht mehr verwendet.
- `positions`: Knotenpositionen nach Node-ID.
- `viewport`: Zoom und Pan.

Defekte oder inkompatible States fallen auf Defaults zurueck und sollen die App nicht blockieren.

## Edge-Typen

- `link`: direkte WikiLinks aus Markdown, Gewicht `5`.
- `tagUsage`: Datei verwendet Tag, Gewicht `2`.
- `sharedTag`: Similarity-Kante zwischen Dateien mit gemeinsamen Tags.

Backlinks werden nicht mehr als eigene Kanten persistiert. Ein Backlink ist nur die Rueckperspektive auf eine vorhandene `link`-Kante und bringt fuer den Graph-Index keinen zusaetzlichen Informationsgehalt. Eingehende Links koennen im Frontend bei Bedarf aus den `link`-Kanten berechnet werden.

SharedTag-Gewichtung:

- `project:*`: `+3`
- `person:*`: `+2`
- andere Tags: `+1`
- mehrere gemeinsame Tags: `+1` extra
- Kante entsteht ab Gewicht `>= 2`

SharedTag-Kanten werden ueber Tag-Buckets berechnet, nicht durch globalen Vergleich aller Dateien.

## Update-Mechanismus

Beim Speichern ueber `POST /notes/save` wird nach erfolgreichem Markdown-Speichern der Graph inkrementell aktualisiert. Falls der Index fehlt oder beschaedigt ist, wird einmalig vollstaendig neu aufgebaut. Fehler im Graph-Update werden im Graph-Status gemeldet, duerfen aber das Speichern einer Note nicht verhindern.

Das Frontend laedt den Graph nach Save nicht automatisch neu. Stattdessen zeigt das Graph-Dashboard einen Hinweis, dass neue Daten verfuegbar sind, und bietet `Jetzt aktualisieren`.

## Watcher-Verhalten

Der Backend-Watcher ist ein einfacher Polling-Watcher ohne zusaetzliche Dependency. Er startet beim Oeffnen einer NoteBase, ignoriert `.system` und Systemordner, nutzt ein kurzes Debounce-Fenster und stoesst fuer geaenderte Markdown-Dateien das gleiche inkrementelle Update an wie der Save-Pfad.

Der Watcher ist bewusst kein komplexes Background-Job-System. Externe Aenderungen werden best-effort verarbeitet.

## Grosse Graphen

SharedTag-Kanten sind standardmaessig ausgeblendet, weil sie sehr viele Kanten erzeugen koennen. Bei grossen sichtbaren Graphen zeigt die UI Warnungen und empfiehlt Focus-Modus oder staerkere Filter. Cytoscape-Layouts werden nicht bei jeder kleinen Aenderung neu gestartet; manuelle Positionen und Viewport werden gespeichert.

## Bekannte Einschraenkungen

- Kein Clustering.
- Kein WebWorker-Layout.
- Kein Export.
- Kein nativer OS-File-Watcher.
- Keine persistierten Analysemetriken oder Rankings.
- Sehr grosse SharedTag-Buckets koennen viele Kanten erzeugen; sie crashen nicht, koennen aber die Ansicht dicht machen.

## Tests

Backend-Tests:

```powershell
python -m unittest src.backend.tests.test_graph
```

Frontend-Build:

```powershell
npm run build
```
