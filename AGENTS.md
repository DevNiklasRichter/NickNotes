# NickNotes Arbeitskontext

Vor Aenderungen immer zuerst [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) lesen. Dieses Dokument ist die kurze, verbindliche Leitplanke fuer kuenftige Arbeiten.

## Produktprinzipien

- NickNotes ist eine lokale, Windows-first Desktop-App fuer eine portable Markdown-NoteBase.
- Benutzerfreundlichkeit und eine klare, ruhige User Experience haben im Frontend hoechste Prioritaet.
- Notizen und eigenstaendige Tasks sind immer Markdown-Dateien. Sie sind die fachliche Single Source of Truth.
- `index.db`, Graph-Dateien (geraetelokal unter `%LOCALAPPDATA%/NickNotes/notebases/`) und generierte Uebersichten sind nur ableitbare Projektionen oder Hilfsdaten. Sie muessen aus der NoteBase wiederherstellbar sein.
- Tags werden eindeutig als `gruppe:tag` definiert und im Markdown als `{tag:gruppe/tag}` referenziert. Die zentrale Tag-Definition liegt in `.system/tag_groups.json`.

## Arbeitsregeln

- Funktionen vor der Implementierung klar definieren: Zweck, Datenquelle, Seiteneffekte und Zusammenspiel mit bestehenden Funktionen muessen nachvollziehbar sein.
- Bestehende Konzepte erweitern statt parallele Varianten einzufuehren. Vor Ersatzimplementierungen veralteten Legacy-Code und ungenutzte Pfade entfernen.
- Das Projekt schlank halten: keine unnoetigen Abstraktionen, Dependencies oder Sonderfaelle.
- Markdown-first respektieren: keine fachlichen Daten ausschliesslich in SQLite, Frontend-State oder generierten Dateien speichern.
- Migrationen fuer bestehende NoteBases gezielt und nachvollziehbar halten; Legacy-Kompatibilitaet nicht ungeprueft weiter ausbauen.
- Frontend-Aenderungen aus Nutzersicht pruefen: klare Bezeichnungen, kurze Wege, sichtbares Feedback, robuste Fehlermeldungen und keine ueberladenen Oberflaechen.
- Bei Aenderungen an Markdown, Tasks, Tags oder Dateipfaden immer Reindex, Link-Rewrite, Graph-Projektion und bestehende NoteBases mitdenken.
- `PROJECT_ARCHITECTURE.md` bei relevanten Architektur-, Struktur-, Datenmodell-, Konfigurations- oder Funktionsaenderungen direkt mit aktualisieren.

## Orientierung

- Frontend: `src/frontend/src`
- Desktop-Wrapper: `src/desktop`
- Backend-API: `src/backend/api.py`
- Fachlogik: `src/backend/nicknotes_backend`
- Tests: `src/backend/tests` sowie `*.spec.ts`
- Start: `npm run dev` oder `Start-NickNotes.ps1`
- Build: `npm run build`
