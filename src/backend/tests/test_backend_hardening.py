from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.backend import api as backend_api
from src.backend import application_services
from src.backend.application_services import BackendApiService
from src.backend.commands import (
    NoteBaseDeleteRequest,
    NoteCreateRequest,
    NoteSaveRequest,
    TagCreateRequest,
    TagGroupRequest,
    TagMatchApplyRequest,
    VaultCreateRequest,
)
from src.backend.errors import ConflictDomainError, ValidationDomainError
from src.backend.nicknotes_backend.indexer import VaultIndexer
from src.backend.nicknotes_backend.projection_registry import INDEXER_SCHEMA_VERSION
from src.backend.session import RuntimeState


class FullTextProjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.indexer = VaultIndexer(Path(self.temp.name) / 'index.db')

    def tearDown(self):
        self.indexer.close()
        self.temp.cleanup()

    def _fts(self):
        return self.indexer.conn.execute('SELECT rowid, note_id FROM notes_fts ORDER BY rowid').fetchall()

    def _upsert(self, note_id, path, body):
        self.indexer.upsert_note(note_id, path, note_id, body, 'note', '2026-01-01', '2026-01-01')

    def test_resaving_and_removing_a_note_keeps_one_full_text_row_per_note(self):
        self._upsert('a', 'a.md', 'ersteversion')
        self._upsert('b', 'b.md', 'nachbar')
        self._upsert('a', 'a.md', 'zweiteversion')
        self.assertEqual(self.indexer.search_notes('ersteversion'), [])
        self.assertEqual([row['id'] for row in self.indexer.search_notes('zweiteversion')], ['a'])
        self.assertEqual(len(self._fts()), 2)

        self.indexer.remove_projection_for_path('a.md')
        self.assertEqual([row['note_id'] for row in self._fts()], ['b'])
        # A reused note row must not inherit the removed note's text.
        self._upsert('c', 'c.md', 'neuling')
        self.assertEqual(self.indexer.search_notes('zweiteversion'), [])
        self.assertEqual([row['id'] for row in self.indexer.search_notes('neuling')], ['c'])

    def test_existing_schema_3_index_is_rekeyed_on_open(self):
        self._upsert('a', 'a.md', 'altbestand')
        connection = self.indexer.conn
        connection.execute('DELETE FROM notes_fts')
        connection.execute("INSERT INTO notes_fts(rowid, note_id, title, body) VALUES (900, 'a', 'a', 'altbestand')")
        connection.execute('PRAGMA user_version=3')
        connection.commit()
        self.indexer.close()

        self.indexer = VaultIndexer(Path(self.temp.name) / 'index.db')
        version = self.indexer.conn.execute('PRAGMA user_version').fetchone()[0]
        self.assertEqual(version, INDEXER_SCHEMA_VERSION)
        note_rowid = self.indexer.conn.execute("SELECT rowid FROM notes WHERE id='a'").fetchone()[0]
        self.assertEqual([(row['rowid'], row['note_id']) for row in self._fts()], [(note_rowid, 'a')])
        self._upsert('a', 'a.md', 'aktualisiert')
        self.assertEqual(self.indexer.search_notes('altbestand'), [])
        self.assertEqual(len(self._fts()), 1)

    def _older_index(self, version, dropped):
        connection = self.indexer.conn
        connection.execute("INSERT INTO tasks(id, path, title, status, priority, created_at, updated_at) VALUES ('t', 't.md', 'T', 'open', 'M', '2026-01-01', '2026-01-01')")
        connection.execute("INSERT INTO indexed_files(path, mtime_ns, size) VALUES ('t.md', 1, 1), ('n.md', 1, 1)")
        # Rebuild the table the way the older schema had it: without the newer columns.
        for column in dropped:
            connection.execute(f'ALTER TABLE tasks DROP COLUMN {column}')
        connection.execute(f'PRAGMA user_version={version}')
        connection.commit()
        self.indexer.close()
        self.indexer = VaultIndexer(Path(self.temp.name) / 'index.db')

    def test_schema_4_index_gets_the_repeat_and_reminder_columns_and_reads_task_files_again(self):
        self._older_index(4, ['repeat_rule', 'remind_at'])
        columns = {row[1] for row in self.indexer.conn.execute('PRAGMA table_info(tasks)').fetchall()}
        self.assertTrue({'repeat_rule', 'remind_at'} <= columns)
        self.assertEqual([row[0] for row in self.indexer.conn.execute('SELECT path FROM indexed_files')], ['n.md'])
        self.assertIsNone(self.indexer.list_tasks()[0]['repeat'])
        self.assertIsNone(self.indexer.list_tasks()[0]['remind_at'])

    def test_schema_5_index_gets_the_reminder_column_and_reads_task_files_again(self):
        self._older_index(5, ['remind_at'])
        columns = {row[1] for row in self.indexer.conn.execute('PRAGMA table_info(tasks)').fetchall()}
        self.assertIn('remind_at', columns)
        self.assertEqual(self.indexer.conn.execute('PRAGMA user_version').fetchone()[0], INDEXER_SCHEMA_VERSION)
        self.assertEqual([row[0] for row in self.indexer.conn.execute('SELECT path FROM indexed_files')], ['n.md'])
        self.assertEqual(self.indexer.list_task_reminders(), [])


class JournaledWriteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = BackendApiService(runtime=RuntimeState())
        self.service.create_vault(VaultCreateRequest(parentPath=self.temp.name, name='Base'))
        self.service.state.stop_graph_watcher()

    def tearDown(self):
        self.service.state.dispose_session()
        self.temp.cleanup()

    def _changed_paths(self):
        return {Path(path).resolve() for path in self.service.state.last_change['paths']}

    def test_applied_tag_matches_are_backed_up_and_reported(self):
        self.service.add_tag_group(TagGroupRequest(groupId='project', displayName='Projekt'))
        self.service.add_tag(TagCreateRequest(groupId='project', tagId='orion', displayName='Orionprobe'))
        created = self.service.add_note(NoteCreateRequest(groupKey='', title='Bericht'))
        current = self.service.read_note_content(created['notePath'])
        self.service.save_note_content(NoteSaveRequest(
            path=current['path'], content=current['content'] + '\nOrionprobe startet hier.\n', expectedRevision=current['revision']))
        candidates = self.service.scan_tag_match_candidates()['items']
        self.assertTrue(candidates)

        result = self.service.apply_tag_match_candidates(TagMatchApplyRequest(matches=candidates))

        self.assertEqual(result['notesUpdated'], 1)
        note = Path(current['path']).resolve()
        self.assertIn('{tag:project/orion}', note.read_text(encoding='utf-8'))
        self.assertEqual(self.service.state.last_change['operation'], 'apply_tag_match_candidates')
        self.assertIn(note, self._changed_paths())

    def test_failed_tag_application_restores_the_note(self):
        self.service.add_tag_group(TagGroupRequest(groupId='project', displayName='Projekt'))
        self.service.add_tag(TagCreateRequest(groupId='project', tagId='orion', displayName='Orionprobe'))
        created = self.service.add_note(NoteCreateRequest(groupKey='', title='Bericht'))
        current = self.service.read_note_content(created['notePath'])
        saved = self.service.save_note_content(NoteSaveRequest(
            path=current['path'], content=current['content'] + '\nOrionprobe startet hier.\n', expectedRevision=current['revision']))
        candidates = self.service.scan_tag_match_candidates()['items']
        indexer = self.service.state.indexer

        with mock.patch.object(indexer, 'reindex_markdown_file', side_effect=RuntimeError('projection failed')):
            with self.assertRaises(RuntimeError):
                self.service.apply_tag_match_candidates(TagMatchApplyRequest(matches=candidates))

        self.assertEqual(Path(saved['path']).read_text(encoding='utf-8'), saved['content'])

    def test_failure_after_a_save_restores_the_note_and_marks_projections(self):
        created = self.service.add_note(NoteCreateRequest(groupKey='', title='Bericht'))
        current = self.service.read_note_content(created['notePath'])
        request = NoteSaveRequest(path=current['path'], content=current['content'] + '\nNeuer Absatz\n', expectedRevision=current['revision'])

        with mock.patch.object(self.service, 'update_graph_after_note_save', side_effect=RuntimeError('projection failed')):
            with self.assertRaises(RuntimeError):
                self.service.save_note_content(request)

        vault = self.service.state.vault
        self.assertEqual(Path(current['path']).read_text(encoding='utf-8'), current['content'])
        self.assertTrue(vault.projection_dirty_path.exists())
        # The next operation repairs the projections and the same draft can be saved again.
        saved = self.service.save_note_content(request)
        self.assertIn('Neuer Absatz', saved['content'])
        self.assertFalse(vault.projection_dirty_path.exists())
        self.assertEqual([row['path'] for row in self.service.search_notes('Absatz')['items']], [saved['path']])

    def test_completing_a_task_is_backed_up_and_reported(self):
        created = self.service.add_note(NoteCreateRequest(groupKey='', title='Aufgabe', noteType='task'))
        task = next(row for row in self.service.list_tasks(include_done=True)['items'] if Path(row['path']).resolve() == Path(created['notePath']).resolve())

        result = self.service.mark_task_done(task['id'])

        self.assertIn('status: done', Path(result['taskPath']).read_text(encoding='utf-8'))
        self.assertEqual(self.service.state.last_change['operation'], 'mark_task_done')
        self.assertIn(Path(result['taskPath']).resolve(), self._changed_paths())


class NoteBaseRemovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = BackendApiService(runtime=RuntimeState())

    def tearDown(self):
        self.service.state.dispose_session()
        self.temp.cleanup()

    def _folder(self, marker: str, config: str) -> Path:
        folder = Path(self.temp.name) / 'Candidate'
        (folder / marker).mkdir(parents=True)
        (folder / marker / 'config.json').write_text(config, encoding='utf-8')
        return folder

    def test_folders_without_a_notebase_identity_are_never_removed(self):
        for marker, config in (('.system', '{}'), ('system', '{"vault_id": "x"}'), ('.system', '[]'), ('.system', 'broken')):
            with self.subTest(marker=marker, config=config):
                folder = self._folder(marker, config)
                with mock.patch.object(application_services, 'move_to_trash') as trash:
                    with self.assertRaises(ValidationDomainError):
                        self.service.delete_notebase(NoteBaseDeleteRequest(path=str(folder), confirmDelete=True))
                trash.assert_not_called()
                self.assertTrue(folder.exists())
                (folder / marker / 'config.json').unlink()
                (folder / marker).rmdir()
                folder.rmdir()

    def test_a_notebase_goes_to_the_recycle_bin_instead_of_being_deleted(self):
        folder = self._folder('.system', json.dumps({'vault_id': 'abc'}))
        with mock.patch.object(application_services, 'move_to_trash') as trash:
            result = self.service.delete_notebase(NoteBaseDeleteRequest(path=str(folder), confirmDelete=True))
        trash.assert_called_once_with(folder.resolve())
        self.assertTrue(result['deleted'])
        # Nothing but the Recycle Bin call may remove files.
        self.assertTrue(folder.exists())

    def test_a_location_without_recycle_bin_keeps_the_notebase_and_explains_why(self):
        folder = self._folder('.system', json.dumps({'vault_id': 'abc'}))
        with mock.patch.object(application_services, 'move_to_trash', side_effect=OSError('Dieser Speicherort hat keinen Papierkorb.')):
            with self.assertRaises(ConflictDomainError) as raised:
                self.service.delete_notebase(NoteBaseDeleteRequest(path=str(folder), confirmDelete=True))
        self.assertIn('keinen Papierkorb', raised.exception.public_message)
        self.assertTrue(folder.exists())


class ReleaseMetadataTests(unittest.TestCase):
    def test_api_reports_the_packaged_version(self):
        package = json.loads((Path(__file__).resolve().parents[3] / 'package.json').read_text(encoding='utf-8'))
        self.assertEqual(backend_api.app.version, package['version'])


if __name__ == '__main__':
    unittest.main()
