from pathlib import Path
import sys
import tempfile
import unittest
from src.backend.nicknotes_backend.process_limits import bounded_export
from src.backend.nicknotes_backend.dates import calendar_day
from src.backend.nicknotes_backend.source_journal import SourceJournal,active_journal,pending_recovery
from src.backend.nicknotes_backend.recovery import resolve_recovery
from src.backend.nicknotes_backend.file_io import atomic_write_text
from src.backend.application_services import BackendApiService
from src.backend.commands import VaultCreateRequest,NoteCreateRequest,VaultOpenRequest

class RuntimeIntegrityTests(unittest.TestCase):
    def test_explicit_mutation_journals_a_non_prefix_operation_and_rolls_back_failure(self):
        from src.backend.session import coordinated
        class Service(BackendApiService):
            @coordinated(mutation=True)
            def revise_document(self, path, fail=False):
                atomic_write_text(path, 'changed')
                if fail:
                    raise RuntimeError('synthetic failure')
        with tempfile.TemporaryDirectory() as directory:
            service=Service()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Explicit'))
                file=service.state.vault.vault_path/'Explicit.md'
                atomic_write_text(file,'original')
                before=service.state.change_version
                with self.assertRaises(RuntimeError):service.revise_document(file,fail=True)
                self.assertEqual(file.read_text(),'original')
                self.assertEqual(service.state.change_version,before)
                service.revise_document(file)
                self.assertEqual(file.read_text(),'changed')
                self.assertEqual(service.state.change_version,before+1)
                self.assertEqual(service.state.last_change['operation'],'revise_document')
            finally:service.state.dispose_session()
    def test_view_preferences_do_not_invalidate_note_content(self):
        from src.backend.commands import UiSettingsUpdateRequest
        with tempfile.TemporaryDirectory() as directory:
            service=BackendApiService()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Preferences'))
                before=service.state.change_version
                service.update_ui_settings(UiSettingsUpdateRequest(app={'capturePanelOpen':False}))
                service.update_graph_state({'activeMode':'focus'})
                self.assertEqual(service.state.change_version,before)
                service.add_note(NoteCreateRequest(groupKey='',title='Actual content change'))
                self.assertGreater(service.state.change_version,before)
            finally:service.state.dispose_session()
    def test_retired_theme_profiles_are_dropped_from_ui_settings(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            service=BackendApiService()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Themes'))
                vault=service.state.vault
                atomic_write_text(vault.ui_settings_path,json.dumps({'app':{'theme':'dark','activeThemeId':'forest','capturePinned':False,
                    'themes':[{'id':'forest','name':'Wald','baseTheme':'dark','colors':{'text':'#dcece2'}}]}}))
                self.assertEqual(vault.read_ui_settings()['app'],{'theme':'dark','capturePinned':False})
                saved=vault.update_ui_settings({'theme':'light','colorProfiles':[{'id':'x'}]})['app']
                self.assertEqual(saved,{'theme':'light','capturePinned':False})
                self.assertNotIn('forest',vault.ui_settings_path.read_text(encoding='utf-8'))
            finally:service.state.dispose_session()
    def test_graph_follows_rename_and_ignores_prose_only_saves(self):
        import hashlib
        from src.backend.commands import NoteFileRenameRequest,NoteSaveRequest
        from src.backend.nicknotes_backend.graph_storage import read_graph_index
        with tempfile.TemporaryDirectory() as directory:
            service=BackendApiService()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Graph'))
                vault=service.state.vault
                target=Path(service.add_note(NoteCreateRequest(groupKey='',title='Ziel'))['notePath'])
                source=Path(service.add_note(NoteCreateRequest(groupKey='',title='Quelle'))['notePath'])
                def save(path,text):
                    return Path(service.save_note_content(NoteSaveRequest(path=str(path),content=path.read_text(encoding='utf-8')+text,expectedRevision=hashlib.sha256(path.read_bytes()).hexdigest()))['path'])
                def links():
                    index=read_graph_index(vault.graph_index_path)
                    ids={entry.id:path for path,entry in index.files.items()}
                    return sorted((ids[edge.source],ids[edge.target]) for edge in index.edges if edge.type=='link')
                source=save(source,'\nSiehe [[Ziel]].\n')
                self.assertEqual(links(),[(source.name,target.name)])
                before=vault.graph_index_path.read_bytes()
                source=save(source,'\nNur Text, keine neuen Verweise.\n')
                self.assertEqual(vault.graph_index_path.read_bytes(),before)
                renamed=Path(service.rename_note(NoteFileRenameRequest(path=str(target),newName='Neues Ziel'))['renamedPath'])
                self.assertNotIn(target.name,read_graph_index(vault.graph_index_path).files)
                self.assertEqual(links(),[(source.name,renamed.name)])
                self.assertIn(f'[[{renamed.stem}]]',source.read_text(encoding='utf-8'))
            finally:service.state.dispose_session()
    def test_projections_stay_out_of_the_notebase_folder(self):
        from src.backend.commands import NoteBaseRenameRequest
        with tempfile.TemporaryDirectory() as directory:
            service=BackendApiService()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Synced'))
                vault=service.state.vault
                service.add_note(NoteCreateRequest(groupKey='',title='Inhalt'))
                self.assertTrue(vault.db_path.exists() and vault.graph_index_path.exists())
                self.assertFalse(vault.db_path.is_relative_to(vault.vault_path.resolve()))
                self.assertEqual(sorted(path.name for path in vault.system_path.iterdir()),['config.json','favorite_folders.json','tag_groups.json','ui_settings.json'])
                service.state.dispose_session()
                (vault.system_path/'index.db').write_bytes(b'old');(vault.system_path/'mcp-operations').mkdir()
                service.open_vault(VaultOpenRequest(path=str(vault.vault_path)))
                self.assertFalse((vault.system_path/'index.db').exists() or (vault.system_path/'mcp-operations').exists())
                local=vault.local_path
                service.rename_notebase(NoteBaseRenameRequest(newName='Umbenannt'))
                moved=service.state.vault
                self.assertFalse(local.exists())  # moved along, no orphaned projection folder
                self.assertTrue(moved.db_path.exists())
            finally:service.state.dispose_session()
    def test_dated_capture_todo_becomes_a_due_task(self):
        from src.backend.commands import CaptureSaveRequest
        from src.backend.nicknotes_backend.markdown_io import parse_markdown
        with tempfile.TemporaryDirectory() as directory:
            service=BackendApiService()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Capture'))
                text='Telefonat mit Kunde\n- [ ] Angebot schicken @2026-11-20\n- [ ] Ohne Termin\n- [ ] Kein Datum @2026-02-31\nMail an max@firma.de'
                saved=service.save_capture(CaptureSaveRequest(text=text,selectedTagKeys=[]))
                self.assertEqual([task['dueDate'] for task in saved['tasks']],['2026-11-20'])
                meta,body=parse_markdown(Path(saved['tasks'][0]['taskPath']))
                self.assertEqual((meta['title'],meta['due_date']),('Angebot schicken','2026-11-20'))
                daily=Path(saved['notePath']).read_text(encoding='utf-8')
                self.assertIn('Angebot schicken @2026-11-20',daily)  # the capture keeps what was typed
                self.assertIn('nn:todo:promoted:',daily)
                self.assertEqual(len(service.state.indexer.list_tasks(include_done=True)),1)
            finally:service.state.dispose_session()
    def test_watcher_retries_projection_failure_without_another_source_edit(self):
        from unittest.mock import patch
        from src.backend.nicknotes_backend.graph_watcher import graph_watcher_loop, graph_watcher_snapshot
        from src.backend.nicknotes_backend.graph_storage import read_graph_index, write_graph_index
        with tempfile.TemporaryDirectory() as directory:
            service=BackendApiService()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Retry'))
                created=service.add_note(NoteCreateRequest(groupKey='',title='Before'))
                state=service.state;state.stop_graph_watcher();vault=state.vault
                baseline=graph_watcher_snapshot(vault.vault_path)
                path=Path(created['notePath'])
                path.write_text(path.read_text(encoding='utf-8').replace('title: Before','title: After'),encoding='utf-8')
                initial=state.change_version;clock=[0];attempts=[]
                class Stop:
                    def wait(self,seconds):
                        clock[0]+=seconds
                        return state.change_version>initial or clock[0]>60
                    def is_set(self):return False
                def fail_once(*args):
                    attempts.append(True)
                    if len(attempts)==1:raise PermissionError('simulated scanner lock')
                    return write_graph_index(*args)
                with patch('src.backend.nicknotes_backend.graph_watcher.time.monotonic',lambda:clock[0]), patch('src.backend.nicknotes_backend.graph_storage.write_graph_index',side_effect=fail_once):
                    graph_watcher_loop(state,vault,state.indexer,Stop(),baseline)
                self.assertEqual(len(attempts),2)
                self.assertGreater(state.change_version,initial)
                graph=read_graph_index(vault.graph_index_path)
                self.assertEqual(graph.files[path.relative_to(vault.vault_path).as_posix()].title,'After')
                self.assertIsNone(state.graph_status.last_error)
            finally:service.state.dispose_session()

    def test_helper_output_is_bounded_before_buffering(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                bounded_export([sys.executable,'-c',"print('x'*100000)"],Path(directory),Path(directory),5,1024)
    def test_helper_disk_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            command=[sys.executable,'-c',"from pathlib import Path;Path('large').write_bytes(b'x'*10000)"]
            with self.assertRaises(ValueError):bounded_export(command,Path(directory),Path(directory),5,1024,max_disk=1024)
    def test_calendar_day_respects_offsets(self):
        from datetime import datetime
        value='2026-11-08T00:30:00+14:00'
        self.assertEqual(calendar_day(value),datetime.fromisoformat(value).astimezone().date().isoformat())
        self.assertEqual(calendar_day('2026-11-08T00:30:00'),'2026-11-08')
        self.assertEqual(calendar_day('bad'),'')
    def test_crashed_source_operation_is_reopenable_and_explicitly_recoverable(self):
        with tempfile.TemporaryDirectory() as directory:
            service=BackendApiService()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Recover'))
                created=service.add_note(NoteCreateRequest(groupKey='',title='Original'))
                path=Path(created['notePath']);before=path.read_bytes()
                vault=service.state.vault
                journal=SourceJournal(vault,'simulated-crash');journal.__enter__()
                atomic_write_text(path,path.read_text(encoding='utf-8')+'Changed')
                active_journal.reset(journal.token) # Simulate process death without compensation.
                self.assertEqual(len(pending_recovery(vault)),1)
                service.state.dispose_session()
                opened=service.open_vault(VaultOpenRequest(path=str(vault.vault_path)))
                self.assertTrue(opened['recoveryRequired'])
                resolve_recovery(service.state.vault,journal.directory.name,'restore')
                self.assertEqual(path.read_bytes(),before)
                self.assertEqual(pending_recovery(service.state.vault),[])
            finally:service.state.dispose_session()
    def test_unchanged_reopen_reuses_projection(self):
        with tempfile.TemporaryDirectory() as directory:
            service=BackendApiService()
            try:
                service.create_vault(VaultCreateRequest(parentPath=directory,name='Warm'))
                service.add_note(NoteCreateRequest(groupKey='',title='Same'))
                vault=service.state.vault
                graph_time=vault.graph_index_path.stat().st_mtime_ns
                opened=service.open_vault(VaultOpenRequest(path=str(vault.vault_path)))
                self.assertEqual(opened['indexed']['changed'],0)
                self.assertEqual(vault.graph_index_path.stat().st_mtime_ns,graph_time)
            finally:service.state.dispose_session()

    def test_pre_2_1_system_root_is_rejected_without_touching_the_folder(self):
        from src.backend.nicknotes_backend.vault import VaultManager
        import json
        for name in ('system','99_system'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root=Path(directory)/'Legacy';system=root/name;system.mkdir(parents=True)
                (system/'config.json').write_text(json.dumps({'custom':{'kept':True}}),encoding='utf-8')
                (root/'Notiz.md').write_text('Inhalt',encoding='utf-8')
                before=sorted(path.relative_to(root).as_posix() for path in root.rglob('*'))
                with self.assertRaisesRegex(ValueError,'alten Systemordner'):
                    VaultManager(root).ensure_structure()
                self.assertEqual(sorted(path.relative_to(root).as_posix() for path in root.rglob('*')),before)

    def test_a_user_folder_named_system_is_an_ordinary_folder(self):
        from src.backend.nicknotes_backend.vault import VaultManager
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'Base'
            (root/'system').mkdir(parents=True)
            (root/'system'/'Betrieb.md').write_text('Inhalt',encoding='utf-8')
            vault=VaultManager(root);vault.ensure_structure()
            self.assertIn('system',[group['key'] for group in vault.list_note_groups()])
            from src.backend.nicknotes_backend.inventory import markdown_sources
            self.assertIn(root.resolve()/'system'/'Betrieb.md',markdown_sources(root))
