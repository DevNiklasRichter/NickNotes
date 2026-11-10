# NickNotes Gestaltungsgrundlage

Stand: 10. November 2026, POT-02 / IMP-024. Verbindliche Quelle sind die
CSS-Tokens in `src/frontend/src/index.css`, die Farbprofile in
`src/frontend/src/app/AppShared.ts` und die jeweiligen Komponentenstyles.
Dieser Leitfaden beschreibt ihren Einsatz; er ist kein zweites Themesystem.

## Text und Dichte

Die UI verwendet Segoe UI mit System-Fallbacks. Die rem-Basis beträgt 16 px;
App-Zoom skaliert das gesamte Interface. Keine globale Schriftgrößenregel mit
`!important` über alle Kindknoten legen.

| Rolle | Token | Größe bei 100 % | Einsatz |
| --- | --- | --- | --- |
| Zusatzinformation | `--font-caption` | 12 px | Zeitstempel, Status, Abschnittslabels |
| Beschriftung | `--font-label` | 13 px | Navigation, Explorer, kompakte Aktionen |
| Oberflächentext | `--font-ui` | 14 px | Formulare, Dialoge, allgemeiner UI-Text |
| Abschnitt | `--font-section` | 16 px | Property- und Bereichsüberschriften |
| Notiztext | `--font-editor` | 15,5 px | CodeMirror-Fließtext; Zeilenhöhe 1,7 |
| Notiztitel | `--font-note-title` | flexibel | Dokumenttitel; eigener Split-Token |

Markdown-Überschriften, Code und Tabellen behalten die Dokumenttypografie.
Kein universelles UI-Label-Token auf deren Inlineelemente anwenden.
Die Abstandsskala `--space-1/2/3/4/6` entspricht 4/8/12/16/24 px. Neue
Oberflächengruppen verwenden diese Skala; bestehende funktionsspezifische
Geometrie bleibt dort definiert, wo sie benötigt wird. Kompakte Listen bleiben
kompakt, die Hauptnavigation bietet mindestens 36 px hohe Schaltflächen.

## Farbe, Rand und Feedback

| Rolle | Tokens | Einsatz |
| --- | --- | --- |
| Primärer/sekundärer Text | `--text`, `--muted` | Inhalte bzw. Zusatzinformation; keine reine Farbkennzeichnung wichtiger Zustände |
| Fläche | `--surface`, `--surface-strong`, `--surface-contrast` | Arbeitsbereich, Gruppierung, abgesetzte Controls |
| Fensterhintergrund | `--bg-layer-1/2/3` | bestehende Ebenen des Fensterlayouts |
| Notizfläche | `--editor-note-bg` | unabhängig konfigurierbare Editorfläche |
| Rand | `--line`, `--line-strong` | ruhige Trennung, stärkerer Rand bei Bedarf |
| Akzent | `--accent`, `--accent-strong`, `--accent-soft` | Auswahl, Hervorhebung und interaktive Zustände |
| Tastaturfokus | `--focus-ring` | sichtbare 2-px-Kontur mit 2-px-Abstand |
| Erfolg/Fehler | `--ok-bg/border/text`, `--error-bg/border/text` | Meldungsfläche mit Text; fachliche Statusfarben ergänzend |

Hell/Dunkel überschreiben Farben, nicht Typografie oder Shell-Geometrie.
Benutzerprofile nutzen weiterhin die bestehenden Farbfelder in
`.system/ui_settings.json`; keine neuen Profilfelder oder Migrationen.
Der globale Fokusstil ist die Grundlage. Komponenten dürfen ihn nur durch einen
mindestens gleich gut sichtbaren Fokus ersetzen. Menüfokus und vollständige
Tastaturführung werden in POT-03 konsolidiert; Explorer und Tabs verwenden
bereits `ui/ContextMenu.tsx` mit benannten Menüs und sichtbarem Eintragsfokus.

## Arbeitsfläche und CSS-Verantwortung

`layout/WorkbenchShell.css` besitzt das Raster, Navigation, Seitenleiste,
Hauptfläche und Statusleiste. Neue Shell-Varianten gehören dort hin; keine
Refresh-Blöcke oder spezifischeren Reparaturregeln am Ende von `App.css` ergänzen.
`App.css` bleibt für bestehende Fachansichten zuständig; Explorer, Fenstermenü
und Update-Dialog behalten ihre Komponentenstyles. Weitere Extraktionen erfolgen
bei Änderungen an der jeweiligen Komponente.

Die Navigation ist regulär 128 px breit, unter 1050 CSS-px eine vertikale
56-px-Iconleiste mit bestehenden zugänglichen Namen. Die aktivierte Seitenleiste
bleibt sichtbar, nimmt höchstens 32 % der Fensterbreite ein und respektiert sonst
die vorhandene Breitenpräferenz. Explizites Ausblenden gibt ihren Platz frei.
Die Hauptfläche füllt die Restbreite; die Statusleiste darf umbrechen.
Zoom oder Fenstergröße schreiben keine Layoutpräferenzen zurück.

## Dialog, Popover und Menü

- **Dialog:** zusammenhängende Eingabe oder Entscheidung, etwa Einstellungen
  oder Umbenennen. Klarer Titel, primäre Aktion und sichtbares Schließen;
  Fokus hinein und beim Schließen zum Auslöser zurückführen.
- **Popover:** kurze, lokale Auswahl oder ergänzende Information direkt am
  Auslöser, etwa Tagwahl. Keine zweite Navigationshierarchie darin aufbauen.
- **Kontextmenü:** kurze Liste vorhandener Aktionen zum ausgewählten Objekt.
  Innerhalb des Fensters platzieren; Pfeile, Enter und Escape sowie Öffnen per
  Tastatur unterstützen. Deaktivierte Aktionen erkennbar machen.
- **Tooltip:** knappe Erläuterung bzw. Shortcut; kein notwendiger Bedienweg
  und kein Ersatz für den zugänglichen Namen eines Iconbuttons.

Für Explorer- und Tabaktionen gelten diese Regeln über `ContextMenu` und
`ContextMenuItem`: benanntes Menü im Body-Portal, Pfeile/Home/End, Enter/Leertaste,
Escape mit Fokus-Rückgabe, Tab-Ausstieg und Öffnen mit Shift+F10 bzw. Menütaste.
Deaktivierte Einträge sind mit `aria-disabled` erkennbar, per Pfeiltaste
fokussierbar und nicht aktivierbar. Lange Labels umbrechen, hohe Menüs scrollen.
Die bestehende Fachaktion bleibt beim Aufrufer. Neue solche Aktionsmenüs
verwenden diesen Baustein; keine eigenen Fenster-/Dismiss-Listener daneben.
Tag-/Graph-/Editor-Menüs sowie weitere Dialoge und Tooltips erfüllen die Regeln
noch nicht vollständig und folgen in weiteren POT-03-Schnitten.

Prüfungen, Kontrastwerte und Screenshots der Umsetzung:
[POT-02-Abnahme](ui-foundations-2026-11-10.md).
