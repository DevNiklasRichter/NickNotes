from __future__ import annotations

import base64
import json
import shutil
import subprocess
import unittest
import uuid
from pathlib import Path
from unittest import mock
from xml.etree import ElementTree as ET

from src.backend import api as backend_api
from src.backend.commands import OneNoteImportRequest
from src.backend.errors import DomainError
from src.backend.nicknotes_backend import onenote_importer as importer_module
from src.backend.nicknotes_backend.indexer import VaultIndexer
from src.backend.nicknotes_backend.markdown_io import parse_markdown_text
from src.backend.nicknotes_backend.onenote_importer import (
    OneNoteImportValidationError,
    OneNoteLocalImporter,
    _LinkResolver,
    _PageConverter,
    _onenote_wiki_target_from_href,
)
from src.backend.nicknotes_backend.todos import extract_todos_from_body
from src.backend.nicknotes_backend.vault import VaultManager

NS = "http://schemas.microsoft.com/office/onenote/2013/onenote"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
SECOND_PAGE_ID = "{22222222-2222-2222-2222-222222222222}"

MAIN_PAGE = f"""<?xml version="1.0"?>
<one:Page xmlns:one="{NS}" ID="{{A}}{{1}}{{E1}}" name="Projekt Alpha" dateTime="2021-03-01T09:30:00.000Z" lastModifiedTime="2022-05-02T10:00:00.000Z" pageLevel="1">
  <one:TagDef index="0" type="0" symbol="3" name="Aufgaben" />
  <one:TagDef index="1" type="13" symbol="13" name="Für später" />
  <one:QuickStyleDef index="0" name="PageTitle" />
  <one:QuickStyleDef index="1" name="p" />
  <one:QuickStyleDef index="2" name="h1" />
  <one:QuickStyleDef index="3" name="code" />
  <one:Title><one:OE><one:T><![CDATA[Projekt Alpha]]></one:T></one:OE></one:Title>
  <one:Outline>
    <one:Position x="36" y="400" z="1" />
    <one:OEChildren><one:OE><one:T><![CDATA[Unten auf der Seite]]></one:T></one:OE></one:OEChildren>
  </one:Outline>
  <one:InkDrawing><one:Position x="10" y="600" z="3" /></one:InkDrawing>
  <one:Outline>
    <one:Position x="36" y="86" z="0" />
    <one:OEChildren>
      <one:OE quickStyleIndex="2" author="Alex" lastModifiedBy="Kim"><one:T><![CDATA[Überblick]]></one:T></one:OE>
      <one:OE quickStyleIndex="1"><one:T><![CDATA[<span style='font-weight:bold'>Fett </span>und <span style='font-style:italic'>kursiv<br>zweite</span> Zeile]]></one:T></one:OE>
      <one:OE><one:T><![CDATA[# kein Titel]]></one:T></one:OE>
      <one:OE>
        <one:List><one:Number numberSequence="0" numberFormat="##." text="3." /></one:List>
        <one:T><![CDATA[Dritter Punkt]]></one:T>
        <one:OEChildren>
          <one:OE><one:List><one:Bullet bullet="2" /></one:List><one:T><![CDATA[Unterpunkt]]></one:T></one:OE>
        </one:OEChildren>
      </one:OE>
      <one:OE><one:Tag index="0" completed="true" creationDate="2021-03-01T09:31:00.000Z" completionDate="2021-03-02T12:00:00.000Z" /><one:T><![CDATA[Angebot senden]]></one:T></one:OE>
      <one:OE><one:Tag index="0" completed="false" creationDate="2021-03-01T09:32:00.000Z" /><one:T><![CDATA[Rechnung prüfen]]></one:T></one:OE>
      <one:OE><one:Tag index="1" completed="false" /><one:T><![CDATA[Budget klären]]></one:T></one:OE>
      <one:OE><one:T><![CDATA[Siehe <a href="onenote:#Zweite%20Seite&amp;section-id={{11111111-1111-1111-1111-111111111111}}&amp;page-id={SECOND_PAGE_ID}&amp;end">die andere Seite</a>, <a href="onenote:Abschnitt.one#section-id={{11111111-1111-1111-1111-111111111111}}&amp;end">den Abschnitt</a>, <a href="javascript:alert(1)">nichts</a> und https://example.org/info.]]></one:T></one:OE>
      <one:OE quickStyleIndex="3"><one:T><![CDATA[print(1)]]></one:T></one:OE>
      <one:OE quickStyleIndex="3"><one:T><![CDATA[    print(2)]]></one:T></one:OE>
      <one:OE>
        <one:Table>
          <one:Row>
            <one:Cell><one:OEChildren><one:OE><one:T><![CDATA[Spalte|A]]></one:T></one:OE></one:OEChildren></one:Cell>
            <one:Cell><one:OEChildren><one:OE><one:T><![CDATA[B]]></one:T></one:OE></one:OEChildren></one:Cell>
          </one:Row>
          <one:Row>
            <one:Cell><one:OEChildren><one:OE><one:Tag index="0" completed="false" /><one:T><![CDATA[In Zelle]]></one:T></one:OE></one:OEChildren></one:Cell>
          </one:Row>
        </one:Table>
      </one:OE>
      <one:OE><one:Image alt="Computergenerierter Alternativtext: Ein Bild"><one:CallbackID callbackID="cb-1" /></one:Image></one:OE>
      <one:OE><one:Image><one:CallbackID callbackID="cb-missing" /></one:Image></one:OE>
      <one:OE><one:InsertedFile preferredName="Vertrag 2021.pdf" pathCache="C:\\cache\\x.bin" /></one:OE>
    </one:OEChildren>
  </one:Outline>
</one:Page>
"""

SECOND_PAGE = f"""<?xml version="1.0"?>
<one:Page xmlns:one="{NS}" ID="{{A}}{{1}}{{E2}}" name="Zweite Seite" dateTime="2021-04-01T08:00:00.000Z" lastModifiedTime="2021-04-02T08:00:00.000Z" pageLevel="2">
  <one:Outline><one:OEChildren><one:OE><one:T><![CDATA[Zurück zu [[Projekt Alpha]]]]></one:T></one:OE></one:OEChildren></one:Outline>
</one:Page>
"""


class OneNoteConverterTests(unittest.TestCase):
    def convert(self, xml: str, resolver: _LinkResolver | None = None, media: dict[str, str] | None = None, files=None):
        return _PageConverter(ET.fromstring(xml.split("?>", 1)[1]), media or {}, files or {}, resolver).convert()

    def test_converts_structure_formatting_todos_and_tags(self) -> None:
        resolver = _LinkResolver({SECOND_PAGE_ID.lower(): "Notizbuch/Abschnitt/Zweite_Seite"}, {})
        page = self.convert(
            MAIN_PAGE,
            resolver,
            media={"cb-1": "/.media/x/image_001.png"},
            files={1: ("Vertrag 2021.pdf", "/.media/x/Vertrag_2021.pdf")},
        )
        body = page.body
        # Reading order follows the position on the page, not the XML order.
        self.assertLess(body.index("# Überblick"), body.index("Unten auf der Seite"))
        self.assertIn("**Fett** und *kursiv*\n*zweite* Zeile", body)
        self.assertIn("\\# kein Titel", body)
        self.assertIn("3. Dritter Punkt\n   - Unterpunkt", body)
        self.assertRegex(body, r"- \[x\] Angebot senden <!-- nn:todo created=2021-03-01T\S+ completed=2021-03-02T\S+ --> \^nn-todo_[0-9a-f]{16}")
        self.assertRegex(body, r"- \[ \] Rechnung prüfen <!-- nn:todo created=2021-03-01T\S+ --> \^nn-todo_[0-9a-f]{16}")
        self.assertIn("Budget klären {tag:onenote/fuer-spaeter}", body)
        self.assertEqual(page.tags, {"fuer-spaeter": "Für später"})
        self.assertIn("[[Notizbuch/Abschnitt/Zweite_Seite|die andere Seite]]", body)
        self.assertIn(", den Abschnitt, nichts und [https://example.org/info](https://example.org/info).", body)
        self.assertNotIn("javascript", body)
        self.assertIn("```\nprint(1)\n    print(2)\n```", body)
        self.assertIn("| Spalte\\|A | B |\n| --- | --- |\n| [ ] In Zelle |  |", body)
        self.assertIn("![Bild](/.media/x/image_001.png)", body)
        self.assertIn("_[Bild aus OneNote nicht übernommen]_", body)
        self.assertIn("[Vertrag 2021.pdf](/.media/x/Vertrag_2021.pdf)", body)
        self.assertEqual(page.missing_media, 1)
        self.assertEqual(page.ink_count, 1)
        self.assertEqual(page.authors, ["Alex", "Kim"])
        self.assertEqual(page.created.isoformat()[:4], "2021")
        self.assertEqual(page.updated.isoformat()[:4], "2022")
        todos = extract_todos_from_body(body, "note")
        self.assertEqual([(todo.raw_text, todo.checked) for todo in todos], [("Angebot senden", True), ("Rechnung prüfen", False)])
        self.assertTrue(todos[0].created_at.startswith("2021-03-01"))
        self.assertTrue((todos[0].completed_at or "").startswith("2021-03-02"))

    def test_unbalanced_inline_markup_keeps_markers_balanced(self) -> None:
        xml = f"""<?xml version="1.0"?><one:Page xmlns:one="{NS}"><one:Outline><one:OEChildren>
          <one:OE><one:T><![CDATA[<span style='font-weight:bold'>A<br>B</span> C</i> <b>D]]></one:T></one:OE>
        </one:OEChildren></one:Outline></one:Page>"""
        body = self.convert(xml).body
        self.assertEqual(body, "**A**\n**B** C **D**")

    def test_section_links_are_not_turned_into_page_links(self) -> None:
        self.assertEqual(_onenote_wiki_target_from_href("onenote:Abschnitt.one#section-id={1-2}&end"), "")
        self.assertEqual(_onenote_wiki_target_from_href("onenote:https://d.docs.live.net/x/Notizbuch/A.one#C%2B%2B%20Tipps&section-id={1}&page-id={2}&end"), "C++ Tipps")


class OneNoteImportTests(unittest.TestCase):
    def setUp(self) -> None:
        base_tmp = Path.cwd() / "src" / "backend" / "tests" / "_runtime"
        base_tmp.mkdir(parents=True, exist_ok=True)
        self.test_root = base_tmp / f"onenote_{uuid.uuid4().hex}"
        self.vault_path = self.test_root / "vault"
        self.vault_path.mkdir(parents=True)
        self.vault = VaultManager(self.vault_path)
        self.vault.ensure_structure()
        self.package = self.test_root / "Notizbuch.onepkg"
        self.package.write_bytes(b"MSCF fake package")
        self.cache_file = self.test_root / "cache.bin"
        self.cache_file.write_bytes(b"%PDF-1.4 fake")
        self.pages = [
            {"xml": MAIN_PAGE, "title": "Projekt Alpha", "sections": ["Gruppe", "Abschnitt"], "pageLinkId": "{11111111-0000-0000-0000-000000000001}", "image": True, "attachment": True},
            {"xml": SECOND_PAGE, "title": "Zweite Seite", "sections": "Abschnitt", "pageLinkId": SECOND_PAGE_ID},
        ]
        available = mock.patch.object(importer_module, "_onenote_desktop_available", return_value=True)
        available.start()
        self.addCleanup(available.stop)

    def tearDown(self) -> None:
        shutil.rmtree(self.test_root, ignore_errors=True)

    def fake_export(self, command, output_dir, _cwd, _timeout, _max_output):
        """Stands in for the PowerShell/OneNote export: writes what the script would write."""
        result_path = Path(command[command.index("-ResultPath") + 1])
        result_pages = []
        for index, page in enumerate(self.pages, start=1):
            xml_path = output_dir / f"{index:04d}_page.xml"
            xml_path.write_text(page["xml"], encoding="utf-8-sig")
            entry = {"path": str(xml_path), "title": page["title"], "notebook": "Notizbuch", "sections": page["sections"], "pageLinkId": page["pageLinkId"], "binaryObjects": [], "attachments": []}
            media_dir = output_dir / f"{index:04d}_media"
            if page.get("image"):
                media_dir.mkdir(exist_ok=True)
                (media_dir / "image_001.b64").write_text(base64.b64encode(PNG_BYTES).decode("ascii"), encoding="ascii")
                entry["binaryObjects"] = [{"callbackId": "cb-1", "path": str(media_dir / "image_001.b64")}]
            if page.get("attachment"):
                media_dir.mkdir(exist_ok=True)
                shutil.copyfile(self.cache_file, media_dir / "file_001.pdf")
                entry["attachments"] = {"ordinal": 1, "name": "Vertrag 2021.pdf", "path": str(media_dir / "file_001.pdf")}
            result_pages.append(entry)
        result_path.write_text(json.dumps({"pages": result_pages, "warnings": "Abschnitt 'Leer.one' enthält keine Seiten."}), encoding="utf-8-sig")
        return subprocess.CompletedProcess(command, 0, b"", b"")

    def run_import(self, target_folder: str = "Import") -> dict:
        with mock.patch.object(importer_module, "bounded_export", side_effect=self.fake_export):
            return OneNoteLocalImporter(self.vault).import_sources([str(self.package)], target_folder)

    def test_import_writes_notes_media_metadata_and_report(self) -> None:
        result = self.run_import()

        self.assertEqual(result["importedPages"], 2, result["warnings"])
        self.assertEqual(result["mediaFiles"], 2)
        main_note = self.vault_path / "Import" / "Notizbuch" / "Gruppe" / "Abschnitt" / "Projekt_Alpha.md"
        second_note = self.vault_path / "Import" / "Notizbuch" / "Abschnitt" / "Zweite_Seite.md"
        self.assertEqual(sorted(result["createdNotes"]), sorted([main_note.relative_to(self.vault_path).as_posix(), second_note.relative_to(self.vault_path).as_posix()]))

        meta, body = parse_markdown_text(main_note.read_text(encoding="utf-8"))
        self.assertEqual(meta["title"], "Projekt Alpha")
        self.assertTrue(meta["created_at"].startswith("2021-03-01"))
        self.assertTrue(meta["updated_at"].startswith("2022-05-02"))
        self.assertTrue(meta["id"].startswith("nt_20210301_"))
        self.assertEqual(meta["onenote_notebook"], "Notizbuch")
        self.assertEqual(meta["onenote_section"], "Gruppe/Abschnitt")
        self.assertEqual(meta["onenote_authors"], ["Alex", "Kim"])
        self.assertIn("onenote:fuer-spaeter", meta["tags_auto"])
        self.assertIn("[[Import/Notizbuch/Abschnitt/Zweite_Seite|die andere Seite]]", body)
        self.assertIn("![Bild](/.media/Import/Notizbuch/Gruppe/Abschnitt/Projekt_Alpha/image_001.png)", body)
        self.assertIn("[Vertrag 2021.pdf](/.media/Import/Notizbuch/Gruppe/Abschnitt/Projekt_Alpha/Vertrag_2021.pdf)", body)
        media_dir = self.vault_path / ".media" / "Import" / "Notizbuch" / "Gruppe" / "Abschnitt" / "Projekt_Alpha"
        self.assertEqual((media_dir / "image_001.png").read_bytes(), PNG_BYTES)
        self.assertTrue((media_dir / "Vertrag_2021.pdf").is_file())
        self.assertFalse((self.vault_path / ".media" / "Import" / "Notizbuch" / "Abschnitt").exists(), "pages without media get no media folder")

        second_meta, second_body = parse_markdown_text(second_note.read_text(encoding="utf-8"))
        self.assertEqual(second_meta["onenote_page_id"], SECOND_PAGE_ID)
        self.assertEqual(second_meta["onenote_page_level"], 2)
        self.assertNotIn("onenote_authors", second_meta)
        self.assertIn("[[Import/Notizbuch/Gruppe/Abschnitt/Projekt_Alpha|Projekt Alpha]]", second_body)

        self.assertTrue(any("Leer.one" in warning for warning in result["warnings"]))
        self.assertTrue(any("Freihandelement" in warning for warning in result["warnings"]))
        report = json.loads((self.vault_path / result["reportPath"]).read_text(encoding="utf-8"))
        self.assertEqual(report["result"]["importedPages"], 2)

    def test_reimport_skips_pages_that_are_already_in_the_notebase(self) -> None:
        self.run_import()
        second = self.run_import()

        self.assertEqual(second["importedPages"], 0)
        self.assertEqual(second["skippedDuplicates"], 2)
        self.assertFalse(list(self.vault_path.rglob("Projekt_Alpha_2.md")))

    def test_broken_page_is_skipped_without_leaving_files_behind(self) -> None:
        self.pages[0]["xml"] = "<one:Page xmlns:one='x'><unclosed></one:Page>"

        result = self.run_import()

        self.assertEqual(result["importedPages"], 1)
        self.assertEqual(result["skippedPages"], 1)
        self.assertTrue(any("Projekt Alpha" in warning for warning in result["warnings"]))
        self.assertFalse(list(self.vault_path.rglob("Projekt_Alpha*.md")))
        self.assertFalse(list((self.vault_path / ".media").rglob("image_001.png")))

    def test_failed_package_reports_the_reason(self) -> None:
        failed = subprocess.CompletedProcess([], 1, b"", "export_onepkg.ps1 : OneNote Desktop ist nicht als COM-Anwendung verfügbar.\n+ CategoryInfo : x".encode("utf-8"))
        with mock.patch.object(importer_module, "bounded_export", return_value=failed):
            with self.assertRaises(OneNoteImportValidationError) as caught:
                OneNoteLocalImporter(self.vault).import_sources([str(self.package)])
        self.assertEqual(caught.exception.code, "onenote.import.no_pages")
        self.assertIn("nicht als COM-Anwendung verfügbar", caught.exception.message)
        self.assertNotIn("CategoryInfo", caught.exception.message)

    def test_missing_onenote_desktop_stops_before_export(self) -> None:
        with mock.patch.object(importer_module, "_onenote_desktop_available", return_value=False), mock.patch.object(importer_module, "bounded_export") as export:
            with self.assertRaises(OneNoteImportValidationError) as caught:
                OneNoteLocalImporter(self.vault).import_sources([str(self.package)])
            preview = OneNoteLocalImporter(self.vault).preview([str(self.package)])
        self.assertEqual(caught.exception.code, "onenote.import.onenote_missing")
        export.assert_not_called()
        self.assertIn("nicht gefunden", preview["warnings"][0])

    def test_target_folder_must_stay_a_regular_notebase_folder(self) -> None:
        importer = OneNoteLocalImporter(self.vault)
        for target in ("../außen", "Import/../x", ".system", "C:/Temp"):
            with self.subTest(target=target), self.assertRaises(OneNoteImportValidationError):
                importer._resolve_target_base(target)
        self.assertEqual(importer._resolve_target_base("Import/OneNote Alt"), (self.vault_path / "Import" / "OneNote_Alt").resolve())
        self.assertEqual(importer._safe_path_token("con"), "con_")


class OneNoteImportUseCaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.helper = OneNoteImportTests("test_import_writes_notes_media_metadata_and_report")
        self.helper.setUp()
        self.indexer = VaultIndexer(self.helper.vault.db_path)
        backend_api.state.start_session(vault=self.helper.vault, indexer=self.indexer)

    def tearDown(self) -> None:
        backend_api.state.dispose_session()
        self.helper.tearDown()
        self.helper.doCleanups()

    def test_import_registers_onenote_tags_and_reindexes(self) -> None:
        with mock.patch.object(importer_module, "bounded_export", side_effect=self.helper.fake_export):
            response = backend_api.start_onenote_import(OneNoteImportRequest(sourcePaths=[str(self.helper.package)], targetFolder=""))

        self.assertEqual(response["import"]["importedPages"], 2)
        groups = {group["id"]: group for group in self.helper.vault.read_tag_groups()}
        self.assertEqual(groups["onenote"]["displayName"], "OneNote")
        self.assertEqual([(tag["id"], tag["displayName"]) for tag in groups["onenote"]["tags"]], [("fuer-spaeter", "Für später")])
        self.assertGreaterEqual(response["counts"]["notes"], 2)

    def test_invalid_target_is_a_validation_error(self) -> None:
        with self.assertRaises(DomainError) as caught:
            backend_api.start_onenote_import(OneNoteImportRequest(sourcePaths=[str(self.helper.package)], targetFolder="../x"))
        self.assertEqual(caught.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
