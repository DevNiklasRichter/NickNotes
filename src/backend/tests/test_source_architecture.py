from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from src.backend.application_services import BackendApiService
from src.backend.commands import VaultCreateRequest, NoteSaveRequest, NoteCreateRequest
from src.backend.errors import ConflictDomainError
from src.backend.nicknotes_backend.file_io import atomic_write_text
from src.backend.nicknotes_backend.markdown_io import dump_markdown, parse_markdown
from src.backend.nicknotes_backend.source_journal import SourceJournal, pending_recovery
from src.backend.nicknotes_backend.graph_index import build_graph_index, update_graph_index_for_file
from src.backend.nicknotes_backend.vault import VaultManager
from src.backend.nicknotes_backend.markdown_syntax import rewrite_markdown_links

class SourceArchitectureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.service = BackendApiService()
        self.service.create_vault(VaultCreateRequest(parentPath=str(self.root), name='Sources'))
        self.vault, self.indexer = self.service.require_loaded()
    def tearDown(self):
        self.service.state.dispose_session()
        self.temp.cleanup()
    def test_concurrent_save_rejects_stale_revision_and_keeps_winner(self):
        created = self.service.add_note(NoteCreateRequest(groupKey='',title='Concurrent'))
        original = self.service.read_note_content(created['notePath'])
        def save(number):
            try:
                return self.service.save_note_content(NoteSaveRequest(path=original['path'],content=original['content']+str(number),expectedRevision=original['revision']))['saved']
            except ConflictDomainError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(save,[1,2])),[False,True])
    def test_source_journal_restores_multi_file_failure(self):
        first, second = self.vault.vault_path/'one.md', self.vault.vault_path/'two.md'
        first.write_text('before',encoding='utf-8')
        with self.assertRaises(RuntimeError):
            with SourceJournal(self.vault,'failure-injection'):
                atomic_write_text(first,'after')
                atomic_write_text(second,'new')
                raise RuntimeError('simulated graph failure')
        self.assertEqual(first.read_text(),'before')
        self.assertFalse(second.exists())
        self.assertEqual(pending_recovery(self.vault),[])
    def test_inventory_root_tasks_tags_and_rebuildable_todo_history(self):
        root = self.vault.vault_path
        (root/'Root.md').write_text(dump_markdown({'id':'root','tags_auto':['project:alpha']},'Body {tag:topic/test}\n\n- [ ] Stable'),encoding='utf-8')
        (root/'Work.md').write_text(dump_markdown({'id':'work','type':'task','title':'Work'},'Task'),encoding='utf-8')
        self.indexer.reindex_vault(root)
        self.assertEqual({row['id'] for row in self.indexer.search_notes('')},{'root','work'})
        self.assertEqual(len(self.indexer.list_tasks()),1)
        self.assertEqual({f"{row['category']}:{row['slug']}" for row in self.indexer.get_all_tags()},{'project:alpha','topic:test'})
        todo = self.indexer.list_todos()[0]
        self.assertFalse(todo['created_at'])
        self.vault.toggle_todo(todo['id'],self.indexer,True)
        before = self.indexer.list_todos()[0]
        self.assertTrue(before['completed_at'])
        note = root/'Root.md'
        meta, body = parse_markdown(note)
        note.write_text(dump_markdown(meta,'Inserted line\n'+body),encoding='utf-8')
        self.indexer.reindex_vault(root)
        after = self.indexer.list_todos()[0]
        self.assertEqual(after['id'],before['id'])
        self.assertEqual(after['completed_at'],before['completed_at'])
    def test_incremental_graph_resolves_new_targets_and_removes_deleted_incoming_edges(self):
        source, target = self.vault.vault_path/'Source.md', self.vault.vault_path/'Target.md'
        source.write_text(dump_markdown({'id':'source'},'[Target](Target.md)'),encoding='utf-8')
        index = build_graph_index(self.vault.vault_path,[])
        target.write_text(dump_markdown({'id':'target'},'Target'),encoding='utf-8')
        index = update_graph_index_for_file(vault_path=self.vault.vault_path,tag_groups=[],index=index,file_path=target)
        self.assertTrue(any(edge.target=='file:target' and edge.type=='link' for edge in index.edges))
        target.unlink()
        index = update_graph_index_for_file(vault_path=self.vault.vault_path,tag_groups=[],index=index,file_path=target)
        self.assertFalse(any(edge.target=='file:target' for edge in index.edges))
    def test_relative_markdown_rewrite_preserves_code_examples(self):
        body='[Label](../Old.md#section)\n`[Example](../Old.md)`\n```md\n[Example](../Old.md)\n```'
        changed=rewrite_markdown_links(body,'Folder/Source.md',{'old':'Archive/New'})
        self.assertIn('[Label](../Archive/New.md#section)',changed)
        self.assertIn('`[Example](../Old.md)`',changed)
        self.assertIn('```md\n[Example](../Old.md)\n```',changed)
    def test_conflicting_tag_migration_changes_no_sources(self):
        folder=self.root/'Conflict'
        system=folder/'.system';system.mkdir(parents=True)
        config=json.dumps({'tagGroups':[{'id':'one','tags':[]}]})
        tags=json.dumps({'groups':[{'id':'two','tags':[]}]})
        (system/'config.json').write_text(config)
        (system/'tag_groups.json').write_text(tags)
        with self.assertRaises(ValueError): VaultManager(folder).ensure_structure()
        self.assertEqual((system/'config.json').read_text(),config)
        self.assertEqual((system/'tag_groups.json').read_text(),tags)
