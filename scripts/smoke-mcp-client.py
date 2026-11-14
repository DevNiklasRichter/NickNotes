import asyncio
import json
import sys
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def main():
    settings=json.loads(sys.stdin.read())
    async with streamablehttp_client(settings['url'],headers={'Authorization':'Bearer '+settings['token']}) as (reader,writer,_):
        async with ClientSession(reader,writer) as client:
            initialized=await client.initialize()
            tools=await client.list_tools()
            names={tool.name for tool in tools.tools}
            assert {'get_workspace_context','search_notes','create_task','add_todo','update_work_item'}<=names
            info=await client.call_tool('get_workspace_context',{})
            assert not info.isError, info
            if settings.get('write',True):
                tag=await client.call_tool('create_tag',{'group_id':'project','tag_id':'sdk','display_name':'SDK'})
                assert not tag.isError,tag
                known=await client.call_tool('list_tags',{})
                assert 'sdk' in json.dumps(known.structuredContent)
                arguments={'title':'SDK Task','body':'Created through the official MCP client.','tags':['project:sdk'],'operation_id':'sdk-create-task-0001','due_date':'2026-12-01'}
                created=await client.call_tool('create_task',arguments)
                assert not created.isError, created
                data=created.structuredContent
                repeated=await client.call_tool('create_task',arguments)
                assert repeated.structuredContent['replayed']
                items=await client.call_tool('list_work_items',{'kind':'tasks'})
                assert any(item['title']=='SDK Task' and item['due_date']=='2026-12-01' for item in items.structuredContent['items'])
                note_created=await client.call_tool('create_note',{'title':'SDK Note','body':'Knowledge','tags':['project:sdk'],'operation_id':'sdk-create-note-0001'})
                assert not note_created.isError,note_created
                note_path=note_created.structuredContent['path']
                related=await client.call_tool('get_note_context',{'path':note_path,'limit':5})
                assert any(item['title']=='SDK Task' and 'project:sdk' in item['sharedTags'] for item in related.structuredContent['related']),related
                filtered=await client.call_tool('search_notes',{'query':'SDK','tag':'project:sdk','limit':10})
                assert len(filtered.structuredContent['items'])==2,filtered
                note=await client.call_tool('read_note',{'path':note_path})
                if not note_created.structuredContent.get('replayed'):
                    added=await client.call_tool('add_todo',{'path':note_path,'text':'Stable SDK todo','expected_revision':note.structuredContent['revision'],'operation_id':'sdk-add-todo-0001'})
                    assert not added.isError, added
                todos=await client.call_tool('list_work_items',{'kind':'todos'})
                assert sum(item['raw_text']=='Stable SDK todo' for item in todos.structuredContent['items'])==1
            print(json.dumps({'client':'mcp-python-sdk','protocolVersion':initialized.protocolVersion,'server':initialized.serverInfo.name,'toolCount':len(names),'connected':True}))

asyncio.run(main())
