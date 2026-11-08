from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.backend.nicknotes_backend.indexer import VaultIndexer
from src.backend.nicknotes_backend.vault import VaultManager


class DataIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.vault = VaultManager(self.root)
        self.vault.ensure_structure()
        self.indexer = VaultIndexer(self.vault.db_path)

    def tearDown(self):
        self.indexer.close()
        self.temp.cleanup()

    def test_saving_other_note_preserves_uncommitted_image(self):
        a = self.vault.create_note_in_group('', 'A', self.indexer)
        b = self.vault.create_note_in_group('', 'B', self.indexer)
        asset = self.vault.add_note_media_asset(str(a['note_path']), 'image.png', 'image/png', b'fixture-image')
        asset_path = self.root / asset['media_path']
        path = Path(b['note_path'])
        self.vault.save_note_document(str(path), path.read_text(encoding='utf-8') + '\nChanged', self.indexer)
        self.assertTrue(asset_path.is_file())

    def test_editor_checkbox_history_survives_rebuild_and_line_move(self):
        from src.backend.nicknotes_backend.markdown_io import parse_markdown_text
        from src.backend.nicknotes_backend.todos import extract_todos_from_body
        created=self.vault.create_note_in_group('', 'History', self.indexer)
        path=Path(created['note_path'])
        self.vault.save_note_document(str(path),path.read_text(encoding='utf-8')+'\n- [ ] Remember me\n',self.indexer)
        meta,body=parse_markdown_text(path.read_text(encoding='utf-8'))
        first=extract_todos_from_body(body,str(meta['id']))[0]
        self.assertTrue(first.created_at)
        self.assertIsNone(first.completed_at)
        content=path.read_text(encoding='utf-8').replace('- [ ] Remember me','Extra line\n- [x] Remember me')
        self.vault.save_note_document(str(path),content,self.indexer)
        meta,body=parse_markdown_text(path.read_text(encoding='utf-8'))
        done=extract_todos_from_body(body,str(meta['id']))[0]
        self.assertEqual(first.id,done.id)
        self.assertEqual(first.created_at,done.created_at)
        self.assertTrue(done.completed_at)
        self.indexer.reindex_vault(self.vault.vault_path)
        self.vault.save_note_document(str(path),path.read_text(encoding='utf-8'),self.indexer)
        meta,body=parse_markdown_text(path.read_text(encoding='utf-8'))
        again=extract_todos_from_body(body,str(meta['id']))[0]
        self.assertEqual(done.completed_at,again.completed_at)

    def test_moved_relative_link_preserves_sibling_case(self):
        from src.backend.nicknotes_backend.markdown_syntax import rewrite_markdown_links
        body='[Sibling](Sibling.md) and [Target](Target.md) and ` [Code](Target.md)`'
        result=rewrite_markdown_links(body,'New/Source.md',{'Old/Source':'New/Source','Old/Target':'New/Target'})
        self.assertIn('[Sibling](../Old/Sibling.md)',result)
        self.assertIn('[Target](Target.md)',result)
        self.assertIn('` [Code](Target.md)`',result)

    def test_link_title_and_angle_destination_survive_move(self):
        from src.backend.nicknotes_backend.markdown_syntax import rewrite_markdown_links
        from src.backend.nicknotes_backend.graph_index import _extract_links
        body='[Title](<Old/Target.md#Heading> "Readable title")'
        updated=rewrite_markdown_links(body,'Source.md',{'Old/Target':'New/Target'})
        self.assertEqual(updated,'[Title](<New/Target.md#Heading> "Readable title")')
        links=_extract_links({},updated,'Source.md')
        self.assertEqual(links[0]['target'],'New/Target')

    def test_code_examples_do_not_become_saved_tags_or_related_links(self):
        from src.backend.nicknotes_backend.markdown_io import parse_markdown_text
        from src.backend.nicknotes_backend.graph_index import _extract_tags
        from src.backend.nicknotes_backend.indexer import _extract_body_auto_tags
        created=self.vault.create_note_in_group('', 'Examples', self.indexer)
        path=Path(created['note_path'])
        body='\n{tag:project/visible} [[Real]]\n`{tag:project/code} [[Hidden]]`\n```md\n{tag:project/fenced} [[AlsoHidden]]\n```\n'
        self.vault.save_note_document(str(path),path.read_text(encoding='utf-8')+body,self.indexer)
        meta,saved_body=parse_markdown_text(path.read_text(encoding='utf-8'))
        self.assertEqual(meta['tags_auto'],['project:visible'])
        self.assertEqual(meta['related_auto'],['Real'])
        self.assertEqual(_extract_tags(meta,saved_body),['project:visible'])
        self.assertEqual(_extract_body_auto_tags(saved_body),['project:visible'])
