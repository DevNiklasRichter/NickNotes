# Windows-Paket und Releaseweg

NickNotes wird als vollstaendiges x64-Paket fuer Windows gebaut. Auf dem Zielgeraet werden weder Node.js noch Python benoetigt. Die Installation selbst braucht keine Netzwerkverbindung. OneNote-Import benoetigt zusaetzlich OneNote Desktop; die Kernfunktionen und MCP benoetigen es nicht.

## Entwicklerauftraege

Voraussetzungen: Windows, Node.js 24.14.x, Python 3.13 und ein Checkout. Im Repository:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
npm ci
npm run contracts:check
npm run icons:check
npm run check
npm run package:win
npm run verify:package
npm run smoke:desktop
```

`package:win` baut Frontend, isoliertes PyInstaller-Backend und NSIS-Installer. Das Backend wird aus `.tmp/build-venv` mit `requirements-build.txt` erstellt; die normale Entwicklerumgebung wird nicht kopiert. `stage:app` legt nur Desktop-Dateien, fertiges Frontend, Paketmetadaten und Lizenzhinweise bereit. Der Builder-Hook unterbindet die automatische Sammlung der bereits gebuendelten Renderer-Abhaengigkeiten aus dem Projektverzeichnis. Die Paketpruefung wuerde solche Doppelungen ablehnen.

Ausgaben unter `dist/installers`:

- `NickNotes-Setup-<Version>-x64.exe`: vollstaendiger Installer.
- `win-unpacked/NickNotes.exe`: direkt pruefbare Paketfassung.
- `package-manifest.json`: Dateien, Groessen und groesste Bestandteile.
- `SHA256SUMS.txt`: nach der finalen Paketierung mit `npm run release:checksums` erzeugen.

Der Installer arbeitet pro Benutzer, benoetigt keine erhoehten Rechte und laesst den Zielordner waehlen. Die NoteBase liegt in einem separat gewaehlten Benutzerordner. Die Deinstallation darf diesen Ordner nicht entfernen. Ein Update ersetzt Programmressourcen; vor einem Formatwechsel die NoteBase sichern.

## Pfade und Betrieb

- Ressourcen: `process.resourcesPath/backend`; Frontend und Desktopcode liegen im ASAR-Paket.
- App-Profil und lokale MCP-Freigaben: Benutzerprofil von NickNotes, standardmaessig `%APPDATA%\NickNotes`.
- NoteBase: vom Benutzer gewaehlter Ort; keine Schreibvorgaenge in den Installationsordner.
- Tests: `NICKNOTES_USER_DATA` und `NICKNOTES_PORT` fuer ein isoliertes Profil und einen eigenen Port.
- Ein App-Prozess pro Benutzerprofil. Der eigene Backendprozess wird ueber seine Pipe beendet. Fremde Prozesse auf einem belegten Port werden nicht beendet.

Der Renderer verwendet `nicknotes://app`, eine Content-Security-Policy, Context Isolation und eine schmale IPC-Bridge. Das Backend bindet ausschliesslich Loopback. Der interne App-Schluessel wird beim Start erzeugt und nicht in URLs oder der NoteBase gespeichert.

## Datenformat und Rueckweg

Formatversion 2 entfernt die alten Assistant-/Provider-Einstellungen und konsolidiert Tagdefinitionen in `.system/tag_groups.json`. Vorherige Konfigurationen und Migrationsnachweise bleiben lokal in `.system/migrations`. Widerspruechliche Definitionsquellen brechen vor inhaltlichen Aenderungen ab. Veraltete Projektionen werden neu aufgebaut. Aeltere Programmfassungen verstehen die neue Todo-Historie nicht vollstaendig; ein Downgrade ist deshalb kein unterstuetzter Rueckweg. Fuer einen Rueckweg die gesicherte NoteBase mit der passenden Programmfassung verwenden.

Unterbrochene Quelldateiaktionen stehen unter `.system/recovery`. Die App bietet in **Einstellungen → Allgemein** Wiederherstellung oder bewusstes Beibehalten an. Vor einer Wiederherstellung wird der aktuelle Stand erneut gesichert. Ein Index kann daraus neu aufgebaut werden; er ist kein Ersatz fuer eine Datensicherung.

Alte lokal gespeicherte Assistant-Schluessel werden nicht mehr gelesen. Falls eine
Vorversion `%APPDATA%\NickNotes\assistant-secrets.json` angelegt hat, ist diese
NickNotes-eigene Datei obsolet und kann aus dem Profil geloescht werden. Der
Kandidat liest oder loescht keine fremden Provider-Zugangsdaten und veraendert
keine Benutzer-Umgebungsvariablen. Bei einem frueher bewusst abweichend gesetzten
Secret-Store-Pfad liegt die alte Datei am damals gewaehlten Ort.

## Noch auszufuehrende VM-Abnahme

Die Installer-Abnahme uebernimmt der Benutzer. Weitere Installationsversuche oder
zusaetzliche Betriebssystemberechtigungen werden hier nicht benoetigt. Das
Testergebnis ist vor einer oeffentlichen Freigabe nachzutragen.

Die folgenden Schritte gehoeren zur Freigabe; sie wurden hier nicht als erledigt
verbucht. Fuer jede Zeile Betriebssystem, Paketversion, Ergebnis und Auffaelligkeiten
festhalten. Nur synthetische Inhalte verwenden.

| Schritt | Erwartetes Ergebnis |
| --- | --- |
| Installer und synthetische alte NoteBase in frische Windows-VM kopieren, Netzwerk trennen | Vollstaendige Installation ohne Node, Python, npm oder pip; Zielordner pro Benutzer waehlbar |
| App starten, NoteBase anlegen/oeffnen, Notiz/Task/Todo mit Tags erzeugen, Suche und Graph verwenden | Lokale Kernablaeufe funktionieren offline; Dateien liegen ausserhalb der Installation |
| Zwei externe Bearbeitungen und einen veralteten Editor-Save ausloesen | Externe Aenderung erscheint; Dirty-Draft bleibt erhalten; keine stille Ueberschreibung |
| Freigabe erstellen, Client verbinden und widerrufen | Nur freigegebene NoteBase zugaenglich, Schreiben braucht Schreibrecht, Widerruf greift sofort |
| App beenden; Vorgaengerversion installieren und auf Kandidaten aktualisieren, falls vorhanden | Ressourcen werden ersetzt; synthetische NoteBase und Migrationssicherungen bleiben erhalten |
| Port durch eigenen Testlistener belegen; App starten und wieder beenden | Kontrollierte Fehlermeldung; fremder Testlistener bleibt aktiv; kein verwaister eigener Backendprozess |
| Kandidaten deinstallieren | Programm entfernt, separat gewaehlte NoteBase mit unveraenderten Quelldateien erhalten |

Bei den lokalen Pakettests unterstuetzt `npm run smoke:desktop -- <EXE-Pfad>` auch
eine abweichende Paket-EXE. Dieser Entwickler-Testtreiber ist kein Bestandteil des
Installers und ersetzt die manuelle Abnahme auf dem Zielgeraet nicht.

## Freigabe vor einem oeffentlichen Download

Der erzeugte Kandidat ist lokal und **nicht signiert**. App-ID: `local.nicknotes.desktop`. Auto-Updates sind noch nicht aktiviert. Die Projektlizenz ist noch nicht festgelegt; das Paket ist als `UNLICENSED` gekennzeichnet. Drittanbieterhinweise sind enthalten.

Noch erforderlich sind eine reale Herausgeber-/Signaturidentitaet, die Lizenzentscheidung und eine ausdrueckliche Veroeffentlichungsfreigabe. Signieren erst mit vorhandener Identitaet; den privaten Signaturschluessel nicht im Repository ablegen. Danach Installer und eingebettete Programmdateien auf Signaturen pruefen, neue Pruefsummen erzeugen und genau dieses Paket testen.

Die [Windows-CI](../.github/workflows/windows.yml) baut und prueft den Kandidaten, veroeffentlicht aber keinen GitHub-Release. Die Actions sind auf feste offizielle Commits gepinnt. Der lokale CI-Workflow wurde hier vorbereitet, aber nicht auf GitHub ausgefuehrt.

Eine frische Windows-VM muss vor der oeffentlichen Freigabe noch Installation ohne Entwicklertools, Offlinebetrieb, Upgrade einer synthetischen aelteren NoteBase und Deinstallation pruefen. Windows Sandbox ist auf dem Entwicklungsrechner nicht verfuegbar. Die lokale Paketabnahme ersetzt diesen Nachweis nicht. OneNote COM sowie Linux/macOS benoetigen eigene Plattformabnahmen.
