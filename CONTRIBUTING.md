# Beiträge zu NickNotes

Fehler und Vorschläge bitte als [GitHub Issue](https://github.com/DevNiklasRichter/NickNotes/issues)
melden. Für Sicherheitsprobleme gilt [SECURITY.md](SECURITY.md).

Vor Änderungen [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) lesen.
Markdown-Dateien und die zentrale Tagdefinition bleiben die fachlichen Quellen;
Index und Graph müssen daraus wiederherstellbar sein. Änderungen klein halten
und vorhandene Konzepte erweitern. Neue Features zunächst in einem Issue klären.

Für einen Pull Request einen Branch anlegen, Problem und resultierendes Verhalten
beschreiben und passende Prüfungen nennen. Vor dem Merge müssen `npm run check`,
`npm run contracts:check`, `npm run icons:check` und die Windows-CI bestehen.
Bei Desktop-/Frontendänderungen die betroffenen Smoke-Tests ausführen.
Keine persönlichen NoteBases, Profile, Secrets oder Buildausgaben einchecken.

Beiträge stehen unter der [MIT-Lizenz](LICENSE) des Projekts.
