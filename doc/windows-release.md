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

`package:win` baut Frontend, isoliertes PyInstaller-Backend und NSIS-Installer. Das Backend wird aus `.tmp/build-venv` mit `requirements-build.txt` erstellt; die normale Entwicklerumgebung wird nicht kopiert. `stage:app` legt Desktop, fertiges Frontend, MIT-Lizenz, Metadaten und Drittanbieterhinweise bereit. Nur `electron-updater`, `semver`, `yaml` und deren aufgeloeste Laufzeitabhaengigkeiten werden zusaetzlich kopiert. `runtime-dependencies.json` und die Paketpruefung begrenzen diesen Baum. Gebuendelte Renderer-Abhaengigkeiten werden nicht nochmals aufgenommen.

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
| Erststart der frischen Installation und Neustart messen | Zeit bis Fenster, nutzbarer Schnellerfassung und Backend getrennt festhalten; starke lokale Schwankungen vor Freigabe bewerten |
| Zwei externe Bearbeitungen und einen veralteten Editor-Save ausloesen | Externe Aenderung erscheint; Dirty-Draft bleibt erhalten; keine stille Ueberschreibung |
| Freigabe erstellen, Client verbinden und widerrufen | Nur freigegebene NoteBase zugaenglich, Schreiben braucht Schreibrecht, Widerruf greift sofort |
| App beenden; Vorgaengerversion installieren und auf Kandidaten aktualisieren, falls vorhanden | Ressourcen werden ersetzt; synthetische NoteBase und Migrationssicherungen bleiben erhalten |
| Port durch eigenen Testlistener belegen; App starten und wieder beenden | Kontrollierte Fehlermeldung; fremder Testlistener bleibt aktiv; kein verwaister eigener Backendprozess |
| Kandidaten deinstallieren | Programm entfernt, separat gewaehlte NoteBase mit unveraenderten Quelldateien erhalten |

Bei den lokalen Pakettests unterstuetzt `npm run smoke:desktop -- <EXE-Pfad>` auch
eine abweichende Paket-EXE. Dieser Entwickler-Testtreiber ist kein Bestandteil des
Installers und ersetzt die manuelle Abnahme auf dem Zielgeraet nicht.

## Freigabe vor einem oeffentlichen Download

Der normale Kandidat ist **nicht signiert**, besitzt App-ID `local.nicknotes.desktop` und steht unter MIT. Die Updatefunktion ist implementiert, in unsignierten Testpaketen aber deaktiviert. Drittanbieterhinweise sind enthalten. Die Signierung uebernimmt der Benutzer auf einem anderen Laptop; hier wird keine Identitaet eingerichtet und keine Signierung ausgefuehrt.

Noch erforderlich sind das signierte Endpaket vom Release-Laptop, die manuelle Installer-Abnahme und die ausdrueckliche Veroeffentlichung. Die Lizenzentscheidung MIT ist erfolgt. Private Signaturschluessel gehoeren nicht ins Repository. Installer, App und Backend werden auf gueltige zeitgestempelte Signaturen desselben erwarteten Herausgebers geprueft; Pruefsummen entstehen danach fuer genau diese Bytes.

Die [Windows-CI](../.github/workflows/windows.yml) baut und prueft Kandidaten. Main-Pushes veroeffentlichen nichts. Ein stabiler Versionstag erzeugt nach allen Pruefungen einen Release-Entwurf ohne Downloadassets; die signierten Enddateien werden spaeter vom Release-Laptop angehaengt. Die Actions sind auf feste offizielle Commits gepinnt. Die Nachweise vom 8. November beschreiben den damaligen Stand.

Eine frische Windows-VM muss vor der oeffentlichen Freigabe noch Installation ohne Entwicklertools, Offlinebetrieb, Upgrade einer synthetischen aelteren NoteBase und Deinstallation pruefen. Windows Sandbox ist auf dem Entwicklungsrechner nicht verfuegbar. Die lokale Paketabnahme ersetzt diesen Nachweis nicht. OneNote COM sowie Linux/macOS benoetigen eigene Plattformabnahmen.

## Kontrollierter oeffentlicher Releaseablauf

Am 9. November festgelegt: Quellcode und Downloads sollen im selben oeffentlichen
GitHub-Repository liegen. Die Sichtbarkeit wurde hier nicht umgestellt. Die
folgenden Schritte sind implementiert beziehungsweise als bewusst manuelle
Abnahme/Signierung gekennzeichnet. Es wurde noch kein stabiler Tag oder
oeffentlicher Release erstellt.

1. Stabile Version in Paket und Lockfile setzen, Aenderungen und bekannte Grenzen
   dokumentieren. Ein Release-Tag wie `v2.1.0` muss exakt zur Paketversion und zum
   geprueften Commit passen. Ein normaler Push nach `main` bleibt Kandidaten-CI.
2. CI prueft und baut den Kandidaten aus diesem Stand und erzeugt erst nach
   Erfolg einen leeren **GitHub-Release-Entwurf**. Schreibrechte besitzt nur der
   Entwurfsjob. Die unsignierten CI-Installer bleiben Actions-Artefakte.
3. Auf dem anderen Laptop denselben sauberen Tag auschecken, mit vorhandener
   Identitaet `package:release` ausfuehren, Paket-Smoke und Signaturen pruefen,
   Manifest und Pruefsummen erstellen. `release:draft` prueft die Assets und den
   erfolgreichen Tag-CI-Lauf, bevor Installer, `latest.yml`, Blockmap, Manifest,
   Pruefsummen und Lizenzhinweise an den Entwurf angehaengt werden. Es wird dabei
   keine Signieridentitaet im CI oder beim Endbenutzer hinterlegt.
4. Installer-/Upgradeabnahme und Release Notes pruefen, dann bewusst in GitHub
   veroeffentlichen und den stabilen Release als Latest verwenden. RCs als Pre-Release kennzeichnen; stabile Clients erhalten
   ausschliesslich veroeffentlichte stabile Versionen. Nach Veroeffentlichung
   Assets nicht unter derselben Version austauschen; Korrektur mit neuer Version.
5. Oeffentlichen Download und Update von einer installierten Vorgaengerversion
   auf einem sauberen Windows-System pruefen. Eine erste Version muss den
   Update-Client bereits enthalten, damit spaetere Updates angeboten werden.

GitHub unterstuetzt [Release-Entwuerfe und deren ausdrueckliche Veroeffentlichung](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
Die eingesetzte Builder-Hauptversion bietet NSIS-Updates ueber
[`electron-updater` und Update-Metadaten](https://www.electron.build/v26/docs/features/auto-update/).

## Updateverhalten

Die Pruefung laeuft im Electron-Hauptprozess, nur fuer signierte Releasepakete.
Es gibt eine automatische Pruefung 30 Sekunden nach Backend-Bereitschaft und
danach alle vier Stunden sowie einen manuellen
Befehl **Nach Updates suchen**, sichtbare Versions-/Fortschritts-/Fehlermeldungen
sowie **Herunterladen** und **Jetzt neu starten und installieren**. Keine
Installationsunterbrechung ohne Zustimmung; offline bleibt die App benutzbar.
Pre-Releases und Downgrades werden fuer den stabilen Kanal ausgeschlossen.

Der Neustart muss den vorhandenen Schutz fuer Notiz- und Einstellungsentwuerfe
nutzen. Erst nach erfolgreicher Schliessfreigabe duerfen Backend und App beendet
und der Installer gestartet werden. Abbrechen, Speicherfehler oder Timeout
muessen auch den Update-Neustart abbrechen. Signaturpruefung fuer den erwarteten
Herausgeber konfigurieren und den Fehlerfall testen.

`stage:app` liefert den explizit aufgeloesten Desktop-Laufzeitbaum mit; der
Pakettest prueft Namen und Versionen gegen das Laufzeitmanifest.

MIT-Lizenz, Paketmetadaten, Anwender-README, Changelog, Support-/Fehlermeldeweg,
Sicherheitskontakt und eigenes App-/Installer-Icon sind enthalten. Vor der
oeffentlichen Umschaltung im Repository Private Vulnerability Reporting
aktivieren und die Windows-CI als Mergepflicht einrichten; diese Einstellungen
wurden hier nicht umgestellt. Signierung ist keine Zusage, dass Windows niemals
Warnungen anzeigt.

## Uebergabe an den Signier-Laptop

Dieser Abschnitt ist eine Anleitung fuer spaeter; er wurde hier nicht ausgefuehrt.
Vorher stabile Paket-/Lockversion setzen, Changelog um genau diese Version
ergaenzen, auf `main` pruefen/committen und den passenden `v<Version>`-Tag pushen.
Die CI muss bestanden und den leeren Entwurf angelegt haben.

Auf dem anderen Windows-Laptop denselben Tag sauber auschecken, die dokumentierten
Node-/Python-Buildvoraussetzungen installieren und die vorhandene Signieridentitaet
entsprechend electron-builder konfigurieren. Beispielsweise liest der Builder
`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`; fuer ein vorhandenes Windows-Zertifikat kann
optional `NICKNOTES_CERTIFICATE_SUBJECT_NAME` gesetzt werden. Keine Schluessel oder
Passwoerter in Dateien dieses Repositories speichern. GitHub CLI (`gh`) wird zum
Anhaengen benoetigt; dessen Anmeldung verbleibt auf dem Laptop.

```powershell
$env:NICKNOTES_PUBLISHER_NAME = 'Exakter Common Name des eigenen Zertifikats'
npm ci
npm run package:release
npm run verify:package
npm run smoke:desktop
npm run release:checksums
npm run release:verify
npm run release:draft
```

`package:release` verweigert RC-Versionen, fehlende Notes, einen schmutzigen oder
nicht zum Tag passenden Checkout und fehlende Herausgeberkonfiguration. Der
Release-Builder erzwingt die Signierung; der Backend-EXE ausserhalb von ASAR wird
ausdruecklich einbezogen. Update-Metadaten entstehen aus dem signierten Installer.
`release:verify` liest nur: korrekte Versionen, Update-Hash, Paketlizenz,
Herausgeberkonfiguration, Windows-Signaturen und vollstaendige SHA256-Liste.
`release:draft` haengt nur an unveroeffentlichte Entwuerfe an; es veroeffentlicht
nichts. Nach manueller Abnahme den fertigen Entwurf in GitHub bewusst publizieren.
