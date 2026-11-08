from __future__ import annotations
from datetime import date, datetime
from pathlib import Path
from typing import Any
import re
import hashlib
import copy
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from dataclasses import dataclass
import yaml

LIST_FIELDS = {'tags', 'tags_auto', 'related', 'related_auto', 'blocked_by_ids', 'mit_ids'}
TEXT_FIELDS = {'id', 'node_id', 'title', 'type', 'status', 'priority', 'due_date', 'created_at', 'updated_at', 'completed_at', 'follow_up_date', 'waiting_for', 'blocked_reason', 'next_action_hint'}

class MarkdownFormatError(ValueError):
    pass

class Loader(getattr(yaml, "CSafeLoader", yaml.SafeLoader)):
    def construct_mapping(self, node, deep=False):
        self.flatten_mapping(node)
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in result:
                raise MarkdownFormatError('Frontmatter keys must be unique strings.')
            result[key] = self.construct_object(value_node, deep=deep)
        return result

class Dumper(yaml.SafeDumper):
    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow, False)

# YAML 1.2 booleans agree with the frontend; "yes" and "on" remain text.
Loader.yaml_implicit_resolvers = {key: [(tag, rule) for tag, rule in values if tag != 'tag:yaml.org,2002:bool'] for key, values in yaml.SafeLoader.yaml_implicit_resolvers.items()}
Loader.add_implicit_resolver('tag:yaml.org,2002:bool', re.compile(r'^(?:true|false|True|False|TRUE|FALSE)$'), list('tTfF'))

def _plain(value, depth=0, budget=None):
    budget = budget if budget is not None else [10000]
    budget[0] -= 1
    if budget[0] < 0:
        raise MarkdownFormatError("Frontmatter expands to too many values.")
    if depth > 20:
        raise MarkdownFormatError('Frontmatter nesting is too deep.')
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _plain(v, depth + 1, budget) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v, depth + 1, budget) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise MarkdownFormatError('Unsupported frontmatter value.')

def dump_markdown(frontmatter: dict[str, Any], body: str) -> str:
    metadata = yaml.dump(_plain(frontmatter), Dumper=Dumper, allow_unicode=True, sort_keys=False, width=120)
    return f'---\n{metadata}---\n\n{body.rstrip()}\n'

def parse_markdown_text(text: str) -> tuple[dict[str, Any], str]:
    text = text.lstrip('\ufeff').replace('\r\n', '\n')
    if not text.startswith('---\n'):
        return {}, text
    lines = text.splitlines()
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == '---'), None)
    if end is None:
        raise MarkdownFormatError('Frontmatter closing delimiter is missing.')
    header = '\n'.join(lines[1:end])
    if len(header) > 65_536:
        raise MarkdownFormatError('Frontmatter is too large.')
    try:
        if sum(isinstance(t, yaml.tokens.AliasToken) for t in yaml.scan(header, Loader=Loader)) > 32:
            raise MarkdownFormatError('Too many YAML aliases.')
        metadata = _plain(yaml.load(header, Loader=Loader) or {})
    except yaml.YAMLError as exc:
        raise MarkdownFormatError('Invalid YAML frontmatter.') from exc
    if not isinstance(metadata, dict):
        raise MarkdownFormatError('Frontmatter must be a mapping.')
    for key, value in list(metadata.items()):
        if value is None and key in LIST_FIELDS | TEXT_FIELDS:
            metadata[key] = [] if key in LIST_FIELDS else ''
    return metadata, '\n'.join(lines[end + 1:]).lstrip('\n')

@dataclass
class MarkdownSnapshot:
    metadata: dict[str, Any]
    body: str
    revision: str
    mtime_ns: int
    size: int

_snapshots = ContextVar('nicknotes_markdown_snapshots', default=None)

@contextmanager
def document_snapshots():
    if _snapshots.get() is not None:
        yield
        return
    token = _snapshots.set({'files': {}, 'bytes': 0})
    try:
        yield
    finally:
        _snapshots.reset(token)

def snapshot_operation(function):
    @wraps(function)
    def invoke(*args, **kwargs):
        with document_snapshots():
            return function(*args, **kwargs)
    return invoke

def _cache_snapshot(scope, path, value):
    import json
    previous=scope['files'].pop(path,None)
    if previous:
        scope['bytes']-=previous[1]
    cost=3*(value.size+len(json.dumps(value.metadata,ensure_ascii=False).encode()))
    while scope['files'] and scope['bytes']+cost>64*1024*1024:
        _, removed=scope['files'].pop(next(iter(scope['files'])))
        scope['bytes']-=removed
    if cost<=64*1024*1024:
        scope['files'][path]=(value,cost)
        scope['bytes']+=cost


def prefetch_markdown(paths):
    """Bounded parallel reads for cold Windows directories; cache lives for one operation."""
    from concurrent.futures import ThreadPoolExecutor
    scope=_snapshots.get()
    if scope is None or len(paths)<128:
        return
    pending=[]
    for raw in paths:
        path=raw.absolute()
        cached=scope['files'].get(path)
        if cached:
            stat=path.stat()
            if (cached[0].mtime_ns,cached[0].size)==(stat.st_mtime_ns,stat.st_size):
                continue
        pending.append(path)
    def read(path):
        try:
            return path,read_markdown_snapshot(path)
        except (OSError,ValueError):
            return path,None  # The normal parser reports the source-specific diagnostic.
    with ThreadPoolExecutor(max_workers=8,thread_name_prefix='markdown-read') as pool:
        for start in range(0,len(pending),32):
            for path,value in pool.map(read,pending[start:start+32]):
                if value is not None:
                    _cache_snapshot(scope,path,value)


def read_markdown_snapshot(path: Path) -> MarkdownSnapshot:
    path = path.absolute()
    stat = path.stat()
    scope = _snapshots.get()
    cached = scope['files'].get(path) if scope is not None else None
    if cached and (cached[0].mtime_ns, cached[0].size) == (stat.st_mtime_ns, stat.st_size):
        value = cached[0]
    else:
        if stat.st_size > 5*1024*1024:
            raise MarkdownFormatError('Markdown document is larger than 5 MB.')
        payload = path.read_bytes()
        metadata, body = parse_markdown_text(payload.decode('utf-8'))
        value = MarkdownSnapshot(metadata, body, hashlib.sha256(payload).hexdigest(), stat.st_mtime_ns, stat.st_size)
        if scope is not None:
            _cache_snapshot(scope,path,value)
    return MarkdownSnapshot(copy.deepcopy(value.metadata), value.body, value.revision, value.mtime_ns, value.size)

def parse_markdown(path: Path) -> tuple[dict[str, Any], str]:
    snapshot = read_markdown_snapshot(path)
    return snapshot.metadata, snapshot.body
