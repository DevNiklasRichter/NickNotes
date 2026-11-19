# Startverhalten und Wiederherstellung

Stand: 8. November 2026, Kandidat 2.1.0-rc.3.

## Ausgangslage und Befund

Beim gemeldeten Start war zunaechst das Fenster, danach nur eine weisse Flaeche
sichtbar. Vite und Uvicorn meldeten sich trotzdem bereit. Eine dauerhaft leere
Oberflaeche konnte mit einem isolierten frischen Profil hier nicht identisch
reproduziert werden. Ein gestarteter Server beweist jedoch nicht, dass der
Renderer erfolgreich geladen und gerendert hat.

Nachweisbar waren ein serieller Start vor dem Entwicklungsfenster, erhebliche
Kaltstartkosten und fruehe Anfragen an den Standardport, obwohl der echte Port
noch ueber IPC ermittelt wurde. Die vorherige Menuepruefung startete Vite und
Electron direkt und pruefte damit nicht den kompletten `npm run dev`-Launcher.
Fehlende Fehlerdarstellung konnte Modul-/Renderfehler als leeren Root zuruecklassen.

Die bereits reparierte Save-/Refresh-Rueckkopplung ist ein eigener Fehler gewesen:
Layout-Einstellungen erzeugen jetzt weder eine fachliche Aenderungsversion noch
eine durch instabile Funktionsreferenzen ausgeloeste Speicherschleife. Normale
API-Anfragen werden auf DEBUG statt zweimal auf INFO geloggt.

## Neuer Startablauf

1. Electron registriert die schmale IPC und oeffnet sein Fenster, ohne auf Python
   oder eine geoeffnete NoteBase zu warten. Das zuletzt verwendete Theme dient
   als lokaler Startcache.
2. Eine kleine HTML-Ansicht und klassisches JavaScript stellen den
   **Schnellerfassungsentwurf** bereit. Dafuer werden React, CodeMirror, Graph und
   Python nicht benoetigt. Nach dem Lesen des vorhandenen Profilentwurfs wird
   das Eingabefeld beschreibbar und fokussiert.
3. Nach dem ersten gezeichneten Eingabebildschirm startet das Backend. Ein
   Drei-Sekunden-Fallback verhindert endloses Warten auf eine defekte Oberflaeche.
   Die grosse Oberflaeche wird nach der kleinen Eingabe dynamisch geladen.
4. Die App zeigt den normalen Arbeitsbereich nach Render- und Backend-Bereitschaft.
   Anfragen erhalten die echte Backend-URL; der API-Token wartet auf dessen
   Startfreigabe. Bei vorhandener NoteBase uebernimmt Quick Capture den Entwurf,
   ansonsten bleibt er im Startbildschirm bearbeitbar.
5. **Senden** verwendet den vorhandenen Backend-Capture-Service. Erst dann wird
   die gewaehlte NoteBase beschrieben und der lokale Entwurf nach Erfolg geleert.

`%APPDATA%\NickNotes\capture-draft.md` enthaelt genau einen noch nicht abgesendeten
Entwurf. Er wird ueber die vertrauensgebundene IPC serialisiert und atomar ersetzt,
mit maximal 5 MiB UTF-8-Text. Schnelle Eingaben werden beim Schreiben gebuendelt;
normales Beenden wartet auf ausstehende Schreibvorgaenge. Fehler beim lokalen
Sichern werden sichtbar gemeldet. Ein Dateisystem- oder Stromausfall kann weiterhin
eine Datensicherung erfordern; der Entwurf ist kein Backup der NoteBase.
Das kleine Fenster der Schnellerfassung von ueberall (systemweites Kuerzel) hat
nach denselben Regeln einen eigenen Entwurf, `quick-capture-draft.md`, und
schreibt beim Senden in die Tagesnotiz der gerade geoeffneten NoteBase. Ist keine
geoeffnet, bleibt der Entwurf stehen, bis eine NoteBase geladen ist.

Der Entwurf ist geraetelokal, nicht an eine bestimmte NoteBase gebunden und wird
nicht mit deren Dateien synchronisiert. Vor dem Absenden gilt die aktuell
gewaehlte NoteBase. Vorhandene Notizen und Tasks behalten ihren normalen,
revisionierten Markdown-Schreibpfad.

## Verhalten bei Fehlern

Fehlgeschlagene Modulimporte und nicht abgefangene React-Renderfehler zeigen die
Startansicht mit einer konkreten Fehlermeldung und **Erneut laden**. Der Entwurf
bleibt bearbeitbar und wird beim erneuten Laden wieder gelesen. Scheitert der
Backendstart, bleibt der Eingabebildschirm sichtbar; die Backend-Fehlermeldung
steht dort und im Terminal. Bei einem belegten Port muss die Ursache behoben und
die App neu gestartet werden; blosses Neuladen startet den Backendprozess nicht neu.

Renderer-Konsolenfehler, fehlgeschlagene Hauptnavigationen und abgestuerzte
Rendererprozesse werden im npm-Terminal protokolliert. Ein vollstaendig
abgestuerzter Renderer kann seine eigene HTML-Fehlermeldung nicht mehr anzeigen;
dann die App neu starten. DevTools lassen sich bei Bedarf so aktivieren:

```powershell
$env:NICKNOTES_DEVTOOLS='1'
npm run dev
```

`scripts/dev.mjs` wartet auf die Ausgabe seines eigenen Vite-Prozesses und
akzeptiert keine beliebige Antwort eines schon vorhandenen Servers auf Port 5173.
Eigene Unterprozesse werden beendet, fremde Prozesse bleiben bestehen.

## Pruefungen und Messgrenzen

- `npm run check`: Frontend-, Backend- und Desktoptests, Lint und Build.
- `npm run smoke:commands`: Menues, Shortcuts, sofortiges Speichern, Fokus,
  Splitansichten und ruhiger Leerlauf einschliesslich echtem App-Neustart.
- `npm run smoke:startup`: echter npm-Launcher mit frischem Vite-Cache; blockierte
  Hauptoberflaeche, fruehe Eingabe, Modul- und React-Renderfehler, Wiederholen und
  Markdown-Speicherung.
- `npm run smoke:desktop`: gebuendelte EXE mit synthetischer NoteBase, fremdem
  Arbeitsordner und ohne Entwicklerlaufzeiten im PATH; prueft auch aus dem
  Profil wiederhergestellten Capture-Text und einen echten Prozessneustart.
- `npm run benchmark:startup`: zwei Starts der gebuendelten EXE ohne Testbrowser
  oder CDP-Anschluss. Das Skript schliesst nur seine eigenen Windows-Fenster.

Alle Profile und NoteBases dieser Tests liegen unter `.tmp`; persoenliche
NoteBases werden nicht geoeffnet oder veraendert. Installer-Installation,
Upgrade und Deinstallation bleiben bei der vereinbarten manuellen Abnahme.

Messberichte liegen in `.tmp/startup-smoke-result.json`,
`.tmp/startup-timing-result.json` und `.tmp/desktop-smoke-result.json`.
`NICKNOTES_STARTUP_DIAGNOSTICS=1` zeichnet Startmarken mit Zeit seit Einstieg in
den Desktopcode und absoluter Uhrzeit im Testprofil auf. Die Prozessstartmessung
zaehlt auch die Zeit davor; eine Playwright-Verbindung kann zusaetzlich stoeren.
Nur im Entwicklungsmodus aktiviert diese Diagnoseoption einen zufaelligen lokalen
Debug-Port. Die normale Paketfassung startet dadurch keinen Debug-Port.

Eine neu erzeugte, unsignierte EXE kann beim ersten Aufruf langsamer sein als
spaetere Starts. Messungen waehrend der Paketkompression sind fuer den ruhigen
Normalstart ungeeignet. Frischer Vite-Cache ist ein Entwicklungs-Kaltstart,
kein Neustart des Betriebssystems. Fenstererzeugung, beschreibbare Eingabe,
Backend-Bereitschaft und fertig geladene NoteBase sind unterschiedliche Messpunkte.
Die Ein-Sekunden-Vorgabe bleibt ein Ziel fuer die erste nutzbare Eingabe und
ist keine zugesicherte Zeit fuer alle Geraete oder beliebig grosse NoteBases.

## Ergebnis dieser Arbeitsrunde

### Nachtrag RC.4: Hintergrundstart und Releasevorbereitung

Der Windows-Prozessstart fuer das Backend und seine Kontrollpipe liegen jetzt
in `backend-worker.mjs`. Ein synchron blockierender `spawn` blockiert damit nicht
mehr den Electron-Hauptthread. Die Readiness-/Shutdown-Nachrichten, der einzelne
Backendprozess und sein Parent-Watchdog bleiben erhalten.

Die Nachmessung ohne Testbrowser deckte einen weiteren Startpfad auf: Bei
ausbleibenden Animation-Frames wurden weder React geladen noch die Hauptansicht
freigegeben. `startup.js` stellt jetzt fuer beide Schritte denselben einmaligen
500-ms-Timer-Fallback bereit. Der Smoke-Test unterdrueckt Frames absichtlich und
prueft trotzdem Menue und erhaltenen Entwurf. Das ist eine Anwendungsregression,
keine Erhoehung eines Test-Timeouts. Hintergrundfenster koennen
[`requestAnimationFrame` pausieren](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

Messungen unterscheiden jetzt `quick-entry-enabled` (DOM-Eingabe freigegeben)
von `quick-entry-ready` (Paint-Callbacks beobachtet). Der Benchmark verlangt DOM,
React und Backend; ein Backend allein gilt nicht mehr als vollstaendiger Start.
`paintObserved` zeigt ausdruecklich, ob Paint-Callbacks stattgefunden haben.
Fehlende Frames werden nicht als schnelle sichtbare Eingabe ausgegeben.

MIT-Lizenz, eigenes Windows-Icon und Updatefunktion sind hinzugekommen. Die
Update-Laufzeit wird erst bei einer Pruefung geladen; unsignierte Kandidaten
pruefen keine Updates. Signierung und Installations-/Upgradeabnahme bleiben
entsprechend der Benutzerentscheidung auf dem anderen Laptop beziehungsweise
beim Benutzer. Die folgenden RC.3-Messungen bleiben historische Vergleichsdaten.

### Historische RC.3-Nachweise

Nachtrag vom 9. November: 87 Backend-, 20 Frontend- und 14 Desktoptests; Build,
Schnittstellen-/Iconpruefung, Menue-/Tastaturregression, echter npm-Kaltstart mit
Modul- und React-Fehlern sowie der Pakettest einschliesslich MCP. Lint hat keine
Fehler oder Hinweise. Natives Fensterschliessen synchronisiert jetzt auch den
letzten gepufferten Notiztext, prueft Dirty-Drafts und wartet bei **Speichern**
auf den bestaetigten Save. Abbrechen oder Timeout lassen das Fenster offen.
Die Schliessen-Abfrage synchronisiert auch den Capture-Editor und wartet auf
dessen Profil-Sicherung. Ein lokaler Schreibfehler verlangt die ausdrueckliche
Entscheidung Speichern/Verwerfen/Abbrechen, auch wenn keine Notiz dirty ist.

Die fruehere Messung der gebuendelten EXE ohne angeschlossenen Testbrowser ergab:

| Phase, ab Prozessaufruf | Erstes frisches Testprofil nach Paketierung | Weiterer Start desselben Profils |
| --- | ---: | ---: |
| Fenster erzeugt | 27,5 s | 3,1 s |
| Schnellerfassung beschreibbar und gezeichnet | 36,7 s | 9,9 s |
| Backend bereit | 38,5 s | 13,0 s |

Das sind lokale Beobachtungen, keine allgemeinen Produktzusagen. Fruehere Starts
derselben Arbeitsrunde lagen bereits bei etwa 1,3 s fuer das Fenster und 3,8 s
fuer die Eingabe; der Rechner zeigt erhebliche Schwankungen. Die Ursache der sehr
langsamen ersten EXE-Ausfuehrung ist damit noch nicht bewiesen. Signaturpruefung,
Scanner und Systemlast sind moegliche Einfluesse, keine hier belegte Diagnose.
Der echte Entwicklungs-Kaltstart mit frischem Vite-Cache lag zuletzt bei etwa
10,2 s bis zur Eingabe und 15,7 s bis zur Backend-Bereitschaft.

Eine separate Minimalprobe unter `.tmp/startup-probe-result.log` hat React,
Backend, Preload und NoteBase komplett ausgeschlossen: Eine kleine HTML-Seite
mit einem Skript brauchte auch dann 2,95 bis 3,14 s ab Beginn des Electron-Codes
bis zum ausgefuehrten Skript. `nicknotes://` mit Datei-Stream, eine direkt gelesene
Antwort und `file://` zeigten aehnliche Werte. Der Vergleich mit `--disable-gpu`
hat den langsamen Appstart ebenfalls nicht eindeutig beseitigt. Die normale
GPU-Konfiguration wurde deshalb beibehalten; es gibt keinen zweiten Ressourcenpfad.

Das Ein-Sekunden-Ziel ist **nicht erreicht**. Nachgewiesen sind die getrennten
Startphasen, sichere Entwurfsuebernahme, sichtbare Fehler statt leerem React-Root
und die automatisierten Regressionspruefungen. Weitere Arbeit muss die Zeit vor
dem Desktopcode und die grundlegende Electron-/Rendererinitialisierung messen;
ein weiterer Umbau von NoteBase oder Graph allein erklaert diese Werte nicht.

Nachmessung vom 9. November, unveraenderte RC.3-EXE nach dem Paket-Smoke, ohne
Testbrowser und ohne gleichzeitig laufende Paketkompression:

| Phase ab Prozessaufruf | Frisches Profil | Neustart desselben Profils |
| --- | ---: | ---: |
| Fenster erzeugt | 1,2 s | 1,2 s |
| Schnellerfassung bereit | 3,8 s | 4,1 s |
| Backend bereit | 5,5 s | 5,8 s |

Beim allerersten Aufruf direkt nach Neubau hatte der Paket-Smoke dagegen rund
67 s bis zur Bereitschaft gemessen, davon etwa 35 s vor der Fenstererzeugung und
weitere 21 s beim Backend-Prozessstart. Der Neustart mit Testbrowser lag bei
6,8 s. Die Nachmessung wiederholt keinen ersten Aufruf einer neuen Binaerdatei;
sie beweist daher nicht, dass der langsame Erststart beseitigt ist. Erststart auf
sauberem Windows und mit dem finalen signierten Paket bleibt ein offener
Abnahmepunkt unter IMP-021. Messdateien: `.tmp/startup-timing-result.json` und
`.tmp/desktop-smoke-result.json`.

Nach dem abschliessenden Neubau mit Capture-Schliessschutz bestand auch der
erneute Paket-Smoke alle Funktionspruefungen. Dieser Lauf lag bei 38,2 s bis zur
Bereitschaft beim ersten Aufruf und 13,2 s beim Neustart; Eingabebereitschaft
bei 33,4 bzw. 11,0 s. Auch damit bleiben die Schwankungen sichtbar. Der aktuelle
Desktop-Messbericht gehoert zu diesem letzten Lauf, die Messung ohne Testbrowser
zum vorherigen unveraenderten Paketstand vor der Capture-Ergaenzung.

### Abschliessende RC.4-Messung

Nach Worker- und Frame-Fallback-Korrektur vollendet auch der Start ohne
angeschlossenen Testbrowser DOM, React und Backend. In dieser Messsitzung wurden
bei beiden Starts keine Paint-Callbacks beobachtet (`paintObserved: false`);
deshalb sind die folgenden Werte ausdruecklich keine sichtbaren Paint-Zeiten.

| Phase ab Prozessaufruf | Frisches Testprofil | Neustart desselben Profils |
| --- | ---: | ---: |
| Fenster erzeugt | 1,8 s | 2,2 s |
| Capture-DOM freigegeben | 8,6 s | 6,9 s |
| React gemountet | 9,9 s | 8,4 s |
| Backend bereit | 9,1 s | 8,0 s |

Der vorherige Lauf hatte bei fehlenden Frames ueberhaupt keine React-Bereitschaft
gemeldet; der alte Benchmark hatte dennoch Backend-Bereitschaft akzeptiert.
Diese unvollstaendigen Messungen werden nicht als erfolgreiche UI-Starts gewertet.
Der neue Smoke-Test prueft den Fall gezielt mit blockierten Frames und erhaltenem
Capture-Text. Im abschliessenden Paket-Smoke mit Testbrowser lagen erster Aufruf
und Neustart bei 34,8 bzw. 7,6 s bis Bereitschaft, mit viel Wartezeit bereits vor
Electron-Code. Das Ein-Sekunden-Ziel bleibt unerreicht; saubere Windows-Abnahme
und Messung des spaeter signierten Endpakets bleiben beim Benutzer.
