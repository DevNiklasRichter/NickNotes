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

Bestanden: 87 Backend-, 11 Frontend- und 3 Desktop-Entwurfstests; Build,
Schnittstellen-/Iconpruefung, Menue-/Tastaturregression, echter npm-Kaltstart mit
Modul- und React-Fehlern sowie der Pakettest einschliesslich MCP. Lint hat keine
Fehler, weiterhin 13 Hinweise im bestehenden App-Kompositionscode.

Die letzte Messung der gebuendelten EXE ohne angeschlossenen Testbrowser ergab:

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
