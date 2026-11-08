"""Repeatable shared-tag stress fixture; never opens a personal NoteBase."""
from pathlib import Path
import argparse
import json
import time
import uuid
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from src.backend.nicknotes_backend.graph_index import build_graph_index, update_graph_index_for_file, related_files

parser=argparse.ArgumentParser();parser.add_argument('--count',type=int,default=10000);parser.add_argument('--reuse',type=str,default='');args=parser.parse_args()
root=Path(args.reuse).resolve() if args.reuse else Path(__file__).resolve().parents[1]/'.tmp'/('graph-benchmark-'+uuid.uuid4().hex)
if not args.reuse:
    root.mkdir(parents=True)
    for number in range(args.count):
        (root/f'Note-{number:05}.md').write_text(f'---\nid: note-{number}\ntitle: Note {number}\ntags: [project:shared]\n---\n\nKnowledge {number}\n',encoding='utf-8')
groups=[{'id':'project','tags':[{'id':'shared','displayName':'Shared'}]}]
started=time.perf_counter();index=build_graph_index(root,groups);full=(time.perf_counter()-started)*1000
changed=root/'Note-00000.md';changed.write_text(changed.read_text(encoding='utf-8')+'Edited\n',encoding='utf-8')
started=time.perf_counter();updated=update_graph_index_for_file(vault_path=root,tag_groups=groups,index=index,file_path=changed);single=(time.perf_counter()-started)*1000
started=time.perf_counter();neighbours=related_files(updated,'file:note-0',50);query=(time.perf_counter()-started)*1000
assert len(updated.files)==args.count
assert len(updated.edges)==args.count
assert not any(edge.type=='sharedTag' for edge in updated.edges)
assert len(neighbours['items'])==min(50,args.count-1)
result={'documents':args.count,'nodes':len(updated.nodes),'storedEdges':len(updated.edges),'sharedTagPairs':0,'fullBuildMs':round(full),'incrementalUpdateMs':round(single),'neighbourQueryMs':round(query),'neighboursReturned':len(neighbours['items']),'neighboursTruncated':neighbours['truncated'],'projectionBytes':len(json.dumps(updated.to_dict(),separators=(',',':')).encode()),'fixture':str(root)}
output=root.parent/'graph-benchmark.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
