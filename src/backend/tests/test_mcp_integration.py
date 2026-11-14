from pathlib import Path
import tempfile
import unittest
from src.backend import api
from src.backend.security import INTERNAL_TOKEN
from fastapi.testclient import TestClient

class MCPIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.previous = api.grant_store.path
        api.grant_store.path = self.root / 'profile' / 'grants.json'
        self.client = TestClient(api.app, base_url='http://127.0.0.1:8765', headers={'Authorization': f'Bearer {INTERNAL_TOKEN}'}, raise_server_exceptions=False)
        self.client.__enter__()
        response = self.client.post('/notebase/create', json={'parentPath': str(self.root), 'name':'TestVault'})
        self.assertEqual(response.status_code, 200, response.text)
        self.read = self.client.post('/agents', json={'name':'reader','write':False}).json()
        self.write = self.client.post('/agents', json={'name':'writer','write':True}).json()
    def tearDown(self):
        self.client.__exit__(None,None,None)
        api.backend_api_service.sessions.close_idle(float('inf'))
        api.grant_store.path = self.previous
        self.temp.cleanup()
    def rpc(self, method, params=None, grant=None):
        response = self.client.post('/mcp/', headers={'Authorization':f"Bearer {(grant or self.read)['token']}", 'Accept':'application/json, text/event-stream', 'MCP-Protocol-Version':'2025-03-26'}, json={'jsonrpc':'2.0','id':1,'method':method,'params':params or {}})
        self.assertEqual(response.status_code,200,response.text)
        return response.json()
    def call(self, tool, arguments, grant=None):
        return self.rpc('tools/call', {'name':tool,'arguments':arguments}, grant)['result']
    def test_protocol_read_grants_revocation_and_vault_binding(self):
        self.assertEqual(self.client.post('/mcp/',json={}).status_code,401)
        self.assertEqual(self.client.post('/mcp/',headers={'Authorization':f'Bearer {INTERNAL_TOKEN}'},json={}).status_code,401)
        initialized = self.rpc('initialize', {'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'test','version':'1'}})
        self.assertEqual(initialized['result']['serverInfo']['name'],'NickNotes')
        tools = self.rpc('tools/list')['result']['tools']
        self.assertIn('get_note_context', {tool['name'] for tool in tools})
        info = self.call('get_workspace_context',{})
        self.assertFalse(info.get('isError',False), info)
        denied = self.call('create_note', {'title':'Denied','body':'','tags':[],'operation_id':'denied-0001'})
        self.assertTrue(denied['isError'])
        self.client.delete('/agents/'+self.read['id'])
        self.assertEqual(self.client.post('/mcp/',headers={'Authorization':'Bearer '+self.read['token']},json={}).status_code,401)
        # The app switching NoteBases must not cut the agent off from its own one.
        self.client.post('/notebase/create',json={'parentPath':str(self.root),'name':'Other'})
        own = self.call('get_workspace_context',{},self.write)
        self.assertFalse(own.get('isError',False), own)
        self.assertEqual(Path(own['structuredContent']['vaultPath']).name,'TestVault')
        self.assertEqual(Path(self.client.get('/state').json()['vaultPath']).name,'Other')
        created = self.call('create_note',{'title':'Im Hintergrund','body':'','tags':[],'operation_id':'background-0001'},self.write)
        self.assertFalse(created.get('isError',False), created)
        written = Path(created['structuredContent']['path'])
        self.assertTrue(written.exists() and written.resolve().is_relative_to((self.root/'TestVault').resolve()), written)
        # Opening it in the app hands over to one session; a replaced folder is refused.
        self.client.post('/notebase/open',json={'path':str(self.root/'TestVault')})
        self.assertEqual(api.backend_api_service.sessions.extra,{})
        (self.root/'TestVault'/'.system'/'config.json').write_text('{"vault_id": "fremd"}',encoding='utf-8')
        self.assertTrue(self.call('get_workspace_context',{},self.write)['isError'])
    def test_write_revision_and_durable_idempotency(self):
        args = {'title':'MCP Note','body':'Knowledge','tags':[],'operation_id':'create-0001'}
        first = self.call('create_note',args,self.write)
        self.assertFalse(first.get('isError',False),first)
        data = first['structuredContent']
        repeated = self.call('create_note',args,self.write)
        self.assertTrue(repeated['structuredContent']['replayed'])
        self.assertEqual(data['path'],repeated['structuredContent']['path'])
        conflict = self.call('create_note',args|{'body':'Other'},self.write)
        self.assertTrue(conflict['isError'])
        document = self.call('read_note',{'path':data['path']},self.write)['structuredContent']
        appended = self.call('append_to_note',{'path':data['path'],'text':'Append','expected_revision':document['revision'],'operation_id':'append-0001'},self.write)
        self.assertFalse(appended.get('isError',False),appended)
        stale = self.call('update_note',{'path':data['path'],'content':document['content'],'expected_revision':document['revision']},self.write)
        self.assertTrue(stale['isError'])
        actual = self.call('read_note',{'path':data['path']},self.write)['structuredContent']
        self.assertIn('Append',actual['content'])
        unknown = self.call('append_to_note',{'path':data['path'],'text':'{tag:undefined/unknown}','expected_revision':actual['revision'],'operation_id':'unknown-tag-0001'},self.write)
        self.assertTrue(unknown['isError'])
        unchanged = self.call('read_note',{'path':data['path']},self.write)['structuredContent']
        self.assertEqual(unchanged['content'],actual['content'])
        todo = self.call('add_todo',{'path':data['path'],'text':'Nachfassen','expected_revision':actual['revision'],'operation_id':'todo-0001'},self.write)
        self.assertFalse(todo.get('isError',False),todo)
        self.assertRegex(todo['structuredContent']['content'], r'- \[ \] Nachfassen <!-- nn:todo created=\S+ --> \^nn-todo_[0-9a-f]{16}\n')
        listed = self.call('list_work_items',{'kind':'todos'},self.write)['structuredContent']['items']
        # The UI's stable block reference format gives the todo its identity.
        self.assertEqual([item['id'] for item in listed], ['todo_'+item['block_ref'][len('nn-todo_'):] for item in listed])
        self.assertEqual(len(listed),1)
        actual = self.call('read_note',{'path':data['path']},self.write)['structuredContent']
        self.assertNotIn(self.write['token'], api.grant_store.path.read_text())
        self.assertEqual(len(list((self.root/'TestVault').glob('*.md'))),1)
