# NickNotes Gestaltungsgrundlage

Stand: 11. November 2026, Gestaltungsgrundlage POT-02 und folgende POT-03-Schnitte. Verbindliche Quelle sind die
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
Tastaturführung werden in POT-03 konsolidiert; Explorer, Tabs, Tags, Graphknoten und Editoraktionen verwenden
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

Für Explorer-, Tab-, Tag-, Graphknoten- und Editoraktionen gelten diese Regeln über `ContextMenu` und
`ContextMenuItem`: benanntes Menü im Body-Portal, Pfeile/Home/End, Enter/Leertaste,
Escape mit Fokus-Rückgabe, Tab-Ausstieg und Öffnen mit Shift+F10 bzw. Menütaste.
Deaktivierte Einträge sind mit `aria-disabled` erkennbar, per Pfeiltaste
fokussierbar und nicht aktivierbar. Lange Labels umbrechen, hohe Menüs scrollen.
Die bestehende Fachaktion bleibt beim Aufrufer. Neue solche Aktionsmenüs
verwenden diesen Baustein; keine eigenen Fenster-/Dismiss-Listener daneben.
Tagformulare und gemeinsame Auswahldialoge begrenzen den Tab-Fokus und geben
ihn nach Abschluss zurück. Enter auf einem Button aktiviert ausschließlich
diesen Button; Enter im Textfeld darf das Formular bestätigen. Auswahl- und
Löschdialoge beginnen auf Abbrechen, Farbpalettenbuttons schließen den Dialog
erst über eine ausdrückliche Abschlussaktion.
Der Graphcanvas ist ein fokussierbarer Bereich: Pfeile/Home/End wählen sichtbare
Knoten, Shift+F10/Menütaste öffnen deren Kontextmenü. Der Status benennt die
Auswahl und den Tastaturweg. Der Menüanker verwendet Fensterkoordinaten;
Canvas-relative Positionen müssen zuerst übersetzt werden.
Im Editor bleibt die Textauswahl beim Menüöffnen erhalten. Shift+F10/Menütaste
gehören dort dem fokussierten Editor bzw. Tabellenfeld. Escape führt dorthin
zurück; Menüfokus darf einen Tabellenentwurf nicht vorzeitig abschließen.
Tabellenstrukturaktionen sind einzeln rückgängig machbar; die letzte Spalte
und letzte Datenzeile bleiben geschützt. Schreibgeschützte Tabellen zeigen
deaktivierte Aktionen. Native Textbearbeitung in Eingabefeldern bleibt erhalten.
Sortierauswahl und NoteBase-Aktionen verwenden `ui/MenuButton.tsx` als expliziten
Auslöser für denselben Menübaustein. Hover und bloßer Fokus öffnen kein Menü.
Klick/Enter/Leertaste toggeln; Pfeil nach unten/oben öffnet am ersten/letzten
Eintrag. `aria-expanded` zeigt den Öffnungszustand. Sortiermodus und Richtung
sind benannte Radiogruppen mit `aria-checked` und visuellem Häkchen. Das Häkchen
gehört weder zum zugänglichen Namen noch zur Buchstabennavigation.
NoteBase-Menüs nennen ihren Bezug; Entfernen aus der Historie und Löschen der
Dateien bleiben klar getrennte Aktionen. Die bestehenden Bestätigungsdialoge
bleiben erhalten.
Tagvorschläge in Quick Capture öffnen ihre gemeinsamen Aktionen beim Hover ohne
Fokuswechsel. Der Pointer kann über einen kurzen Abstand ins Menü wechseln;
beim Verlassen schließt die Hoveransicht mit kurzer Verzögerung. Am Cursor
öffnen Shift+F10/Menütaste mit Aktionsfokus. Escape gibt den Editor frei, Tab
verlässt die Aktionen. Neue Vorschlagsdaten oder Textänderungen schließen
veraltete Aktionen und geben deren Tastaturfokus zurück. Übernehmen ist ein
eigener Undo-Schritt, Verwerfen erhält den Text. Bereits eingefügte Tagreferenzen
öffnen keine erneuten Wortvorschläge. Weitere Dialoge und Tooltips bleiben offen.

Nachweise für Auswahl-/Tabellenaktionen: [Editormenüs](editor-menus-2026-11-10.md).
Nachweise für Sortierung/NoteBase: [Seitenleistenmenüs](sidebar-menus-2026-11-10.md).
Nachweise für Tagvorschläge: [Vorschlagsaktionen](tag-suggestions-2026-11-10.md).

Der NoteBase-Erstellungsdialog, Notizsuche und Shortcut-Hilfe verwenden gemeinsame
Fokus-/Tabregeln aus `ui/useDialogFocus.ts`. Nach Abbruch kehrt der Fokus zum
Auslöser zurück; ein Außenklick darf diese Rückgabe nicht nachträglich verlieren.
Eine vorgeschaltete Speicherabfrage blendet das Formular vorübergehend aus,
setzt es inert und übernimmt sichtbar den Fokus; Abbruch erhält alle Eingaben.
Das Erstellungsformular hat einen zugänglichen Titel, eine Beschreibung und
zugeordnete Feldlabels. Fehler stehen als Alert im Dialog. Während Ordnerwahl,
Speicherabfrage und Erstellung sind seine Felder und Abschlussaktionen gesperrt;
eine überlagerte Bestätigung ist der einzige aktive Dialog. Lange Formulare
scrollen innerhalb des Fensters. Eingaben behalten Leerzeichen beim Tippen;
die bestehende Fachvalidierung normalisiert erst beim Absenden.
Nachweise: [NoteBase-Erstellung](create-notebase-dialog-2026-11-10.md).

Die Tag-Matching-Prüfung verwendet dieselben Fokus-/Tabregeln. Vorher und Nachher
sind benannte, per Tastatur scrollbar erreichbare Regionen; ihre Pfeiltasten
wechseln nicht ungewollt die Fundstelle. Außerhalb der Vorschau wechseln ←/→
die Fundstelle; die Navigationsbuttons tragen eindeutige Labels. Überspringen
ändert keine Datei und gilt nur für den aktuellen Prüfdurchlauf. Erneut suchen
beginnt einen neuen Durchlauf einschließlich übersprungener Fundstellen.
Suchfehler bleiben von einer leeren Liste unterscheidbar. Suche darf abgebrochen
werden; eine laufende Schreibung sperrt alle Abschluss-/Mutationsaktionen.
Veraltete oder nur teilweise übernommene Fundstellen fordern zur erneuten Suche
auf. Fehler, Fortschritt und Ergebnis stehen direkt im Dialog.
Vorschauchips teilen die vorhandene Tagdarstellung, verwenden für lesbare
Beschriftungen jedoch die normale Textfarbe. Gruppenfarben bleiben in Rahmen
und Hintergrund erhalten. [Nachweise](tag-matching-dialog-2026-11-10.md).

Einstellungen verwenden dieselbe Dialogführung. Bereichsbuttons nennen die
aktive Rubrik und lassen sich mit Pfeilen sowie Home/End bedienen. Änderungen
werden vor dem Schließen über Speichern, Verwerfen oder Abbrechen abgeschlossen;
nur die oberste Bestätigung ist aktiv. Speicherfehler stehen unmittelbar bei
den Aktionen, ein laufender Save sperrt die Controls. Strg+S übernimmt zuvor
das aktive Theme-Feld. Nach Verwerfen liegt der Fokus sichtbar auf der aktuellen
Rubrik, bei unverändertem Strg+S bleibt der Feldfokus erhalten. Kleine Fenster
scrollen innerhalb der Dialoggrenzen. [Nachweise](settings-dialog-2026-11-11.md).

Prüfungen, Kontrastwerte und Screenshots der Umsetzung:
[POT-02-Abnahme](ui-foundations-2026-11-10.md).
