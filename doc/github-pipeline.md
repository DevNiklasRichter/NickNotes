# Die GitHub-Pipeline einfach erklaert

Stand: 8. November 2026. Grundlage: [windows.yml](../.github/workflows/windows.yml).
Diese Anleitung beschreibt den lokalen Quellstand einschliesslich der neuen
Start- und Menuepruefungen. Sie ist kein Nachweis eines erfolgreichen GitHub-Laufs.
Lokale Aenderungen wirken dort erst nach Commit und Push. `npm run dev` startet
keine GitHub-Pipeline.

## Wozu dient die Datei?

Eine Pipeline ist eine automatische Arbeitsanweisung: Code holen, Werkzeuge
vorbereiten, testen, die Anwendung bauen und das Ergebnis zum Download ablegen.
GitHub nennt den gesamten Ablauf **Workflow**, eine Arbeitsgruppe **Job** und
einen einzelnen Schritt **Step**. YAML beschreibt die Reihenfolge; die Arbeit
erledigen die referenzierten Repository-Skripte und Build-Werkzeuge.

NickNotes hat den Workflow **Windows release candidate** und darin einen Job
**windows**. Er erzeugt einen pruefbaren Windows-Installationskandidaten.

## Wann und auf welchem Rechner laeuft er?

- `push`: Commits werden nach `main`, `master` oder einen `codex/...`-Branch gepusht.
- `pull_request`: etwa beim Oeffnen eines Aenderungsvorschlags oder weiteren Commits.
- `workflow_dispatch`: manueller Start ueber **Actions → Windows release candidate
  → Run workflow**, sofern der Workflow auf dem Default-Branch liegt und Actions erlaubt ist.

Ein Push mit offenem Pull Request kann zwei passende Ausloeser und damit zwei
Laeufe erzeugen. Jeder Lauf gehoert zu einem bestimmten Quellstand; nur lokal
bearbeitete Dateien sind dort nicht vorhanden.

`runs-on: windows-latest` bestellt einen Windows-Rechner bei GitHub. Das ist eine
virtuelle Maschine mit eigenem Betriebssystem, Prozessen und Festplatte auf der
Infrastruktur des Anbieters. Windows-Runner liegen laut GitHub in Microsoft Azure;
ein bestimmter physischer Server oder Standort wird hier nicht festgelegt.
[GitHub: Cloud-Hosts](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners#cloud-hosts-used-by-github-hosted-runners).
Du musst keinen eigenen Server einrichten. GitHub
stellt fuer den Job eine neue VM bereit. Alle Schritte laufen nacheinander auf
dieser VM und teilen deren Arbeitsdateien. Nach Jobende wird die VM entfernt.
Dateien fuer einen spaeteren Download muessen deshalb vorher separat als
**Artefakte** gespeichert werden.
[GitHub: gehostete Runner](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/use-github-hosted-runners).

`windows-latest` ist ein gepflegtes Image-Label. Die konkrete Windows-/Image-Version
steht im Lauf unter **Set up job / Runner Image**. Das Limit von 30 Minuten ist
eine Abbruchgrenze, keine Vorhersage der normalen Dauer.

```text
Dein PC: bearbeiten → committen → pushen
                              |
GitHub: Quellstand speichern → neue Windows-VM starten
                              |
VM: Werkzeuge → Tests → App bauen → Installer bauen → Paket testen
                              |
GitHub-Artefaktspeicher: Download mit Installer und Pruefberichten
                              |
Ziel-PC: Setup ausfuehren → NickNotes lokal benutzen
```

Wenn ein Test auf der VM `127.0.0.1` anspricht, meint er die VM selbst. Backend und
MCP laufen dort nur fuer den Test. Der Ablauf richtet keinen dauerhaften
NickNotes-Cloudserver ein. Nach einer Installation laufen diese Prozesse auf
dem jeweiligen Benutzerrechner.

## Was passiert in welcher Reihenfolge?

| Schritt | Bedeutung |
| --- | --- |
| Checkout | Holt den zum Lauf gehoerenden Code. Bei Pull Requests standardmaessig einen Test-Mergestand. |
| Setup Node / Python | Stellt Node.js 24.14.1 und Python 3.13 bereit. Der npm-Cache spart wiederholte Downloads. |
| Install locked dependencies | Erstellt `.venv`, installiert Python-Entwicklungsabhaengigkeiten und fuehrt `npm ci` anhand des Lockfiles aus. |
| Install locked Electron runtime | Installiert die Electron-Laufzeit aus dem gesperrten npm-Paket vor den Tests. Maximal drei Versuche mit 10/20 Sekunden Pause und fuenf Minuten Gesamtlimit; danach werden `electron.exe` und Version geprueft. |
| Contracts / Icons | Prueft, ob generierte Frontend-API-Typen und Iconliste zum Quellcode passen. |
| Test, lint and build | `npm run check`: Frontend-, Backend- und Desktop-Entwurfstests, ESLint sowie TypeScript-/Vite-Build. |
| Menues / Tastatur | Startet Electron mit synthetischer NoteBase und prueft Shortcuts, Menues, Speichern und die Anfragen im Leerlauf. |
| Echter npm-Kaltstart | Frischer Vite-Cache und Testprofil: fruehe Eingabe, Uebernahme, absichtlicher Modulfehler, Wiederholen und Speicherung im Markdown. |
| Graph-Stichprobe | Erzeugt 1.000 synthetische Notizen und zeichnet Graph-Messwerte auf. Keine Garantie fuer beliebig grosse Bestaende. |
| Dependency Audit | Sucht bekannte gemeldete Sicherheitsluecken: npm ab Schweregrad `moderate`, Python-Laufzeit mit `pip-audit`. Neue Sicherheitsmeldungen koennen diesen Schritt auch ohne Codeaenderung rot werden lassen. |
| Package offline Windows installer | Baut Frontend, isoliertes Python-Backend und den Windows-Installer. |
| Payload / Runtime smoke | Prueft Dateien und Groessen; startet die gebuendelte EXE aus fremdem Arbeitsordner mit eingeschraenktem PATH. Prueft Editor, Konflikte, Entwuerfe, Dashboards, Themes und MCP. Erzeugt SHA-256-Pruefsummen. |
| Upload artifact | `actions/upload-artifact` 7.0.0 mit Node 24, auf einen festen Commit gepinnt: Speichert Installer, Manifest, Pruefsummen und Test-/Graphberichte als `NickNotes-Windows-candidate` fuer 14 Tage bei GitHub. |

Windows-Befehle laufen standardmaessig in PowerShell. Die ausdruecklichen
`$LASTEXITCODE`-Pruefungen verhindern, dass ein spaeter erfolgreicher Befehl einen
frueheren Fehler verdeckt. Schlaegt ein Schritt fehl, laufen die folgenden normalen
Schritte nicht weiter; der abschliessende Kandidaten-Upload entfaellt.

Electron 45 laedt seine Laufzeit standardmaessig erst bei der ersten Verwendung.
Ein erfolgreicher `npm ci`-Schritt garantiert deshalb noch keinen erfolgreichen
Electron-Download. Der eigene Installationsschritt verwendet den offiziellen
Installer und dessen Cache/Pruefsummen. Er faengt voruebergehende Downloadfehler
wie HTTP 504 begrenzt ab. Scheitern alle Versuche, bricht der Job dort ab;
fehlgeschlagene Smoke-Tests werden nicht durch Wiederholungen verdeckt.

## Wie entsteht der Installer?

`npm run package:win` verwendet dieselben Skripte lokal und auf der VM:

1. **TypeScript/Vite** bauen die Oberflaeche zu Browserdateien. Beim Benutzer muss
   kein Vite-Server laufen und nichts neu kompiliert werden.
2. **PyInstaller** buendelt Backend, benoetigte Python-Module und Python-Laufzeit
   als eigene Programmverzeichnisstruktur. Dafuer gibt es eine isolierte
   Build-Umgebung; die komplette Entwicklerumgebung wird nicht kopiert.
3. **stage:app** sammelt nur fertiges Frontend, Desktopcode, Metadaten und
   Drittanbieterhinweise. Persoenliche NoteBases und Tests sind keine Nutzlast.
4. **electron-builder** nimmt Electron als Desktop-Laufzeit dazu. **NSIS** erstellt
   daraus `NickNotes-Setup-<Version>-x64.exe`.

Auf dem Zielrechner sind Node.js, npm und eine separate Python-Installation
dadurch unnoetig. Der Installer enthaelt die Laufzeiten, einschliesslich der
Browser-Engine von Electron. Das erklaert einen grossen Teil der Paketgroesse.
Frontend/Desktop liegen in `app.asar`, das Backend unter den Programmressourcen.
Profil und separat gewaehlte NoteBase liegen ausserhalb des Installationsordners.

[electron-builder.yml](../electron-builder.yml) konfiguriert aktuell x64-Windows,
Installation pro Benutzer, waehlbaren Zielordner, Startmenueeintrag und keine
automatische Rechteerhoehung. Electron-Sprachen: Deutsch und Englisch.

## Wo finde ich Logs und den Download?

1. [Repository → Actions](https://github.com/DevNiklasRichter/NickNotes/actions)
   oeffnen, **Windows release candidate**, dann den Lauf fuer Branch/Commit waehlen.
2. **windows** anklicken. Schritte aufklappen, um Befehle und Ausgaben zu lesen.
   Bei Rot zuerst die erste fehlgeschlagene Aktion ansehen; der letzte Exitcode
   allein erklaert den eigentlichen Fehler oft nicht.
3. Ein gruener Haken bedeutet: alle eingerichteten Pruefungen bestanden. Er ist
   keine Garantie gegen jeden moeglichen Programmfehler.
4. Auf der Lauf-Uebersicht unter **Artifacts** das Paket
   **NickNotes-Windows-candidate** herunterladen und entpacken. GitHub verlangt
   Anmeldung und Leserechte. Darin liegt die Setup-EXE.
   [GitHub: Artefakte herunterladen](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).
5. Vor Ablauf der 14 Tage herunterladen oder einen neuen Lauf starten. Ein
   Artefakt ist kein dauerhafter GitHub-Release.

## Was ist noch offen?

Der Ablauf verwendet `--publish never` und `contents: read`. Er erzeugt keine
oeffentliche Release-Seite, keine Git-Tags und keinen Auto-Update-Dienst. Er
signiert die EXE nicht. Die verwendeten Actions sind auf feste offizielle
Commits gepinnt. Pruefsummen erkennen Abweichungen vom erwarteten Dateistand;
sie ersetzen keine Herausgebersignatur.

Der Pakettest startet `win-unpacked/NickNotes.exe`. Er installiert das NSIS-Paket
nicht und ersetzt keine Installation-/Upgrade-/Deinstallationsabnahme auf einem
sauberen Zielsystem. Diese Abnahme uebernimmt der Benutzer. Signaturidentitaet,
Projektlizenz und bewusste Veroeffentlichung bleiben vor einem oeffentlichen
Download offen; Details: [Windows-Releaseweg](windows-release.md).

Die gehosteten Windows-VMs laufen mit Administratorrechten und deaktivierter UAC.
Deshalb beweist ihr erfolgreicher Pakettest allein noch keine Installation als
normaler Windows-Benutzer. Diese gehoert zur manuellen Installer-Abnahme.
[GitHub: Runner-Berechtigungen](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges).

Die VM bekommt Repository-Dateien und Abhaengigkeiten, nicht automatisch deine
lokalen Ordner. Persoenliche NoteBases sind ausgeschlossen; Tests erzeugen eigene
synthetische Bestaende. Actions-Laufzeit und Artefaktspeicher unterliegen den
Kontingenten des GitHub-Kontos; den Verbrauch zeigen die GitHub-Abrechnungseinstellungen.
