# NickNotes Gestaltungsgrundlage

Stand: 14. November 2026. Verbindliche Quelle sind die CSS-Tokens in
`src/frontend/src/index.css` und die jeweiligen Komponentenstyles.
Dieser Leitfaden beschreibt ihren Einsatz; er ist kein zweites Themesystem.

## Text und Dichte

Die UI verwendet Segoe UI mit System-Fallbacks. Die rem-Basis beträgt 16 px;
App-Zoom skaliert das gesamte Interface. Keine globale Schriftgrößenregel mit
`!important` über alle Kindknoten legen.

| Rolle | Token | Größe bei 100 % | Einsatz |
| --- | --- | --- | --- |
| Zusatzinformation | `--font-caption` | 11,5 px | Zeitstempel, Status, Abschnittslabels |
| Beschriftung | `--font-label` | 12,5 px | Navigation, Explorer, kompakte Aktionen |
| Oberflächentext | `--font-ui` | 12,5 px | Formulare, Dialoge, allgemeiner UI-Text |
| Abschnitt | `--font-section` | 14 px | Property- und Bereichsüberschriften |
| Notiztext | `--font-editor` | 15 px | CodeMirror-Fließtext; Zeilenhöhe 1,7 |
| Notiztitel | `--font-note-title` | 28–32 px | Dokumenttitel; eigener Split-Token |

Markdown-Überschriften, Code und Tabellen behalten die Dokumenttypografie.
Kein universelles UI-Label-Token auf deren Inlineelemente anwenden.
Die Abstandsskala `--space-1/2/3/4/6` entspricht 4/8/12/16/24 px. Neue
Oberflächengruppen verwenden diese Skala; bestehende funktionsspezifische
Geometrie bleibt dort definiert, wo sie benötigt wird. Kompakte Listen bleiben
kompakt (Menüzeilen und Auswahlfelder 28 px), die Hauptnavigation bietet
mindestens 32 px hohe Schaltflächen.

## Farbe, Rand und Feedback

| Rolle | Tokens | Einsatz |
| --- | --- | --- |
| Primärer/sekundärer Text | `--text`, `--muted` | Inhalte bzw. Zusatzinformation; keine reine Farbkennzeichnung wichtiger Zustände |
| Fläche | `--surface`, `--surface-strong`, `--surface-contrast` | Arbeitsbereich, Gruppierung, abgesetzte Controls |
| Fensterhintergrund | `--bg-layer-1/2/3` | bestehende Ebenen des Fensterlayouts |
| Notizfläche | `--editor-note-bg` | unabhängig konfigurierbare Editorfläche |
| Rand | `--line`, `--line-strong` | ruhige Trennung, stärkerer Rand bei Bedarf |
| Akzent | `--accent`, `--accent-strong`, `--accent-soft` | Auswahl, Primäraktion und Fokus; neutral (Graphit hell, Hellgrau dunkel), kein Blau |
| Tastaturfokus | `--focus-ring` | sichtbare 2-px-Kontur mit 2-px-Abstand |
| Erfolg/Fehler | `--ok-bg/border/text`, `--error-bg/border/text` | Meldungsfläche mit Text; fachliche Statusfarben ergänzend |

Hell/Dunkel überschreiben Farben, nicht Typografie oder Shell-Geometrie. Es gibt
nur diese zwei Themes; `.system/ui_settings.json` speichert `theme`, eigene
Farbprofile werden nicht mehr gelesen. Die Titelleiste in `src/desktop/main.mjs`
und die Startseite in `index.html` spiegeln `--surface`, `--bg-layer-1`, `--muted`.

**Geometrie.** Rundungen folgen Rollen: `--radius-control` (6 px) für Buttons,
Eingaben, Zeilen und Karten, `--radius-menu` (8 px) für Menüs, Popover und
Spalten, `--radius-dialog` (12 px) für Dialoge, `--radius-pill` für Chips. Keine
festen Pixelwerte daneben. `--shadow` gehört nur an schwebende Flächen (Menü,
Popover, Dialog, Tooltip, Meldung).

**Controls.** `index.css` definiert `button`, `input`, `select`, `textarea` und
`.icon-button` einmal. Buttons ruhen ohne Rahmen auf `--control-bg`; Hover
wechselt die Fläche, Fokus zeigt den Ring. Varianten: `.primary` (eine pro
Ansicht), `.danger`. Eingaben und Auswahlfelder haben Fläche und Rand.
Komponenten ergänzen nur Layout, keine eigenen Rahmen-, Radius- oder
Hoverregeln für Standardbuttons.

**Sprache.** Deutsche Oberfläche mit echten Umlauten. Feste Begriffe:
Schnellerfassung, Rückblick, Fokus, To-do (in Notizen), Task (eigene Datei),
Verknüpft; Taskstatus Neues Thema, Offen, In Arbeit, Pausiert, Erledigt.
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

Die Navigation ist regulär 152 px breit, unter 1050 CSS-px eine vertikale
56-px-Iconleiste mit bestehenden zugänglichen Namen. Die aktivierte Seitenleiste
bleibt sichtbar, nimmt höchstens 32 % der Fensterbreite ein und respektiert sonst
die vorhandene Breitenpräferenz. Explizites Ausblenden gibt ihren Platz frei.
Die Hauptfläche füllt die Restbreite; die Statusleiste darf umbrechen.
Zoom oder Fenstergröße schreiben keine Layoutpräferenzen zurück.

Die Rail gruppiert **Schreiben**, **Aufgaben** und **Wissen**. Die NoteBase wird
mit Namen angezeigt; „To-dos · In Notizen“ und „Tasks · Eigene Dateien“ erklären
die zwei Aufgabenarten direkt am Ziel. Namen und Tooltips verwenden den
Befehlskatalog. Ein Klick auf ein Dashboardziel öffnet sofort dessen Ansicht.
Auf schmalen Fenstern bleiben zugängliche Namen und erklärende Tooltips erhalten.

Notizeigenschaften beginnen gefaltet mit Typ-/Status-/Tagzusammenfassung; der
Titel bleibt darüber erreichbar. Die native Disclosure unterstützt Enter und
Leertaste. Eingabefehler öffnen sie beim Speicherversuch wieder. Der Schreibmodus
(F9, Ansicht, App-Befehlssuche oder Toolbar) räumt Rail, Sidebar, Eigenschaften
und Capture aus dem Blick. Er erhält Entwürfe, Split und Layoutpräferenzen.
„Schreibmodus beenden“ bleibt sichtbar; F9 beendet ebenfalls, Escape behält seine
lokale Dialog-/Menübedeutung. Bereichsnavigation oder ausdrückliches Öffnen von
Sidebar/Capture beendet den Modus. Er wird nicht über Sessions gespeichert.

## Dialog, Popover und Menü

Der Meldungseinstieg in der Titelleiste bleibt auch bei ausgeblendeter
Statusmeldung erreichbar. Hinweise verschwinden nach vier Sekunden von selbst.
Fehler werden als Alert angezeigt und erst durch Bestätigen entfernt; spätere Erfolge ersetzen ihre Details nicht. Fehlgeschlagene
Schreibaktionen werden bewusst am ursprünglichen Vorgang wiederholt. Langsame
Saves zeigen ab 400 ms einen Textstatus, während der Editor weiter nutzbar bleibt.
`public/motion.css` ergänzt ausschließlich 140-ms-Farb-/Randübergänge. Die
Startansicht und React respektieren `prefers-reduced-motion`; Layout und
Editorinhalte bekommen keine neuen Bewegungen. Navigationsicons und Tabicons
teilen die Katalognamen und die gemeinsame dekorative Lucide-Darstellung.

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

Mehrfachfilter für Tasks und To-dos verwenden `ui/MultiSelectPicker.tsx`:
benannter nichtmodaler Popover mit Suchfeld und echten Checkboxen. Maus,
Enter und Leertaste ändern die Auswahl, ohne die Liste zu schließen. Pfeile
sowie Home/End navigieren fokussierte Optionen; im Suchfeld behalten Home/End
ihre Textfunktion. Escape und Fertig geben den Fokus zurück, Tab verlässt die
Auswahl. Außenklick oder Fokuswechsel schließen; nur ein Filter ist geöffnet.
Lange Labels umbrechen, Listen scrollen und bleiben innerhalb des Fensters.
Eine leere Datenquelle unterscheidet sich von einer Suche ohne Treffer.
Der Auslöser nennt Filter und Auswahl; reine Filterbedienung speichert keine
Notiz. Bestehende Optionen und Filterregeln bleiben beim jeweiligen Aufrufer.
[Nachweise](multiselect-filters-2026-11-12.md).

Tags und Verknüpfungen in den Editor-Eigenschaften verwenden denselben Picker.
Checkboxen ändern den Dokumententwurf unmittelbar; freie Werte benötigen den
sichtbaren Hinzufügen-Button. Reine Suche, Tab, Escape und Außenklick übernehmen
keinen eingegebenen Wert. Automatisch erkannte Bezüge behalten ihre eigene
Darstellung; manuelle Chipaktionen nennen den betroffenen Wert.
Eigenschaftsfelder besitzen eindeutige Namen, die Typbuttons zeigen ihre Auswahl
mit `aria-pressed`, Fehler stehen am jeweiligen Feld. Lange Chips umbrechen.
Beschriftungen erhalten auch im Split ausreichend Platz. Unter 360 px Panelbreite
stehen Feldname und Eingabe untereinander; Titel wachsen nach Breitenwechseln
mit ihrem Inhalt, statt ihn innerhalb einer alten festen Höhe abzuschneiden.
Strg+S übernimmt auch noch aktive Text-/Taskfelder. Ungültige Eingaben bleiben
zur Korrektur stehen und verhindern Save. Escape verwirft die lokale Taskfeld-
eingabe; Enter übernimmt ein einzeiliges Feld und bleibt in Textareas eine Texteingabe.
Titelentwürfe überstehen die tatsächliche Dateiumbenennung und weitere Eingaben
während einer Speicherantwort. [Nachweise](editor-properties-2026-11-12.md).

Der Sucheinstieg in der Titelleiste öffnet einen gemeinsamen Dialog für Notizen
und App-Befehle. Ein Suchfeld, zwei benannte Bereiche und das `>`-Präfix lassen
den Modus sichtbar wechseln. Ergebnisgruppen unterscheiden bereits geöffnete
Notizen, NoteBase-Suchtreffer und Befehlsgruppen. Der aktive Eintrag bleibt mit
`aria-activedescendant` am Suchfeld; Optionen bilden keine zusätzliche Tabfolge.
Gesperrte Befehle bleiben auswählbar, erklären ihren Grund und führen nichts aus.
Die Ergebnisliste scrollt innerhalb des Fensters. Laden, Fehler mit Wiederholung
und leere Ergebnisse bleiben unterscheidbar; neue Eingaben entfernen sofort
die vorherigen Treffer. Der originale Editor-/Feldfokus wird vor Befehlen wieder
hergestellt. Titel-Blur ändert nur den Entwurf; erst Save benennt Dateien um.
[Nachweise](search-commands-2026-11-13.md).

Tooltips verwenden die gemeinsame `ui/TooltipLayer.tsx` und bestehende Farb-,
Text-, Rahmen- und Schattenrollen. Ein Control liefert seinen Hinweis über
`data-tooltip` und behält einen unabhängigen zugänglichen Namen. Aktionen gehören
in Menüs, nicht in Tooltips. Befehls-Shortcuts kommen aus `commandTitle`.
Hover öffnet nach 500 ms, sichtbarer Tastaturfokus nach 150 ms. Der Hinweis
bleibt überfahrbar; er übernimmt keinen Fokus. Escape, Eingabe, Klick und
Scrollen schließen ihn. Bestehende Feldbeschreibungen bleiben erhalten. Die
Fläche bleibt innerhalb des Fensters, lange Pfade umbrechen, reduzierte Bewegung
schaltet die kurze Einblendung aus. Hinweise hinter einem geöffneten Menü,
Auswahlpopover oder modalen Dialog werden unterdrückt; innerhalb der aktiven
Fläche bleiben sie möglich. Native UI-`title` nicht zusätzlich setzen;
Markdown-/CodeMirror-Inhaltstitel bleiben Editorzuständigkeit.
[Nachweise und Grenzen](tooltips-2026-11-13.md).

Prüfungen, Kontrastwerte und Screenshots der Umsetzung:
[POT-02-Abnahme](ui-foundations-2026-11-10.md).
