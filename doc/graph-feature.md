# Graph Feature

## Zweck

Die Graph-Ansicht macht Beziehungen innerhalb einer NoteBase sichtbar. Markdown-Notizen und Tasks werden als Datei-Knoten dargestellt. Tags, WikiLinks und gemeinsame Tags erzeugen Kanten, die im Frontend gefiltert und als Cytoscape-Graph betrachtet werden koennen.

## Dateien in `.system`

- `.system/graph-index.json`: berechneter Graph-Index.
- `.system/graph-state.json`: UI-Zustand der Graph-Ansicht.
- `.system/tag_groups.json`: definierte Tag-Gruppen und Tags, die der Graph zur Diagnose unbekannter Tags nutzt.

## `graph-index.json`

Der Index ist versioniert (`version: 2`) und enthaelt:

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
- `sharedTag`: virtuelle Similarity-Kante fuer die ausgewaehlte Nachbarschaft;
  wird nicht persistiert.

Backlinks werden nicht mehr als eigene Kanten persistiert. Ein Backlink ist nur die Rueckperspektive auf eine vorhandene `link`-Kante und bringt fuer den Graph-Index keinen zusaetzlichen Informationsgehalt. Eingehende Links koennen im Frontend bei Bedarf aus den `link`-Kanten berechnet werden.

SharedTag-Gewichtung:

- `project:*`: `+3`
- `person:*`: `+2`
- andere Tags: `+1`
- mehrere gemeinsame Tags addieren ihre Gewichte
- direkte Nachbarschaft addiert Gewicht `5`

SharedTag-Allpaare werden weder erzeugt noch gespeichert. `GET /graph/related`
berechnet fuer eine ausgewaehlte Datei eine linear gescannte, nach Gewicht und
Pfad sortierte Nachbarschaft mit gemeinsamen Tags und Linkbegruendung.
Standardlimit 50, maximal 200; `truncated` kennzeichnet weitere Treffer.

## Update-Mechanismus

Beim Speichern ueber `POST /notes/save` wird nach erfolgreichem Markdown-Speichern der Graph inkrementell aktualisiert. Falls der Index fehlt oder beschaedigt ist, wird einmalig vollstaendig neu aufgebaut. Fehler im Graph-Update werden im Graph-Status gemeldet, duerfen aber das Speichern einer Note nicht verhindern.

Das Frontend laedt den Graph nach Save nicht automatisch neu. Stattdessen zeigt das Graph-Dashboard einen Hinweis, dass neue Daten verfuegbar sind, und bietet `Jetzt aktualisieren`.

## Watcher-Verhalten

Der Backend-Watcher ist ein einfacher Polling-Watcher ohne zusaetzliche Dependency.
Er nutzt das gemeinsame Inventar, ignoriert System-/Medien-/generierte Dateien
und buendelt Aenderungen unter der gemeinsamen Operationssperre. SQLite und Graph
werden zusammen aktualisiert, groessere Batches einmal neu aufgebaut. Die
Session-Aenderungsversion aktualisiert saubere offene Dokumente; Dirty-Drafts
bleiben erhalten und zeigen Konflikte. Fehler sind im Status sichtbar.

Der Watcher ist bewusst kein komplexes Background-Job-System. Externe Aenderungen werden best-effort verarbeitet.

## Grosse Graphen

Die globale Ansicht ist auf 500 Knoten und 1.500 Kanten begrenzt, die
Fokusansicht auf 100 Knoten. Virtuelle SharedTag-Beziehungen kommen aus derselben
begrenzten Nachbarschaft wie MCP. Die UI kennzeichnet den Ausschnitt.
Cytoscape-Layouts werden nicht bei jeder kleinen Aenderung neu gestartet;
manuelle Positionen und Viewport werden gespeichert.

Messung am 8. November 2026 mit 10.000 synthetischen Notizen und einem gemeinsam
genutzten Tag: 10.001 Knoten, 10.000 gespeicherte Kanten, null SharedTag-Allpaare,
4.663.648 Bytes Projektion, Vollaufbau 40.147 ms, Einzelupdate 554 ms,
Nachbarschaft 60 ms. Dies ist ein lokaler Lauf, keine hardwareunabhaengige Zusage.
Reproduktion: `.venv/Scripts/python scripts/benchmark-graph.py --count 10000`.

## Bekannte Einschraenkungen

- Kein Clustering.
- Kein WebWorker-Layout.
- Kein Export.
- Kein nativer OS-File-Watcher.
- Keine persistierten Analysemetriken oder Rankings.
- Die Nachbarschaftsabfrage scannt derzeit linear die Dateieintraege; bei deutlich
  groesseren Bestaenden als der Messbasis waere ein zusaetzlicher Posting-Index
  erst nach Messung zu rechtfertigen.

## Tests

Backend-Tests:

```powershell
python -m unittest src.backend.tests.test_graph
```

Frontend-Build:

```powershell
npm run build
```
