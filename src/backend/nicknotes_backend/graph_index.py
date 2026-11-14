from __future__ import annotations
from .inventory import markdown_sources

import hashlib
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .markdown_io import read_markdown_snapshot, snapshot_operation, prefetch_markdown
from .parser import slugify
from .projection_registry import GRAPH_INDEX_SCHEMA_VERSION


GRAPH_INDEX_VERSION = GRAPH_INDEX_SCHEMA_VERSION
INLINE_TAG_PATTERN = re.compile(r"\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)/([A-Za-z0-9][A-Za-z0-9_-]*)\}")
WIKILINK_PATTERN = re.compile(r"\[\[([^[\]\n]+)\]\]")
TITLE_HEADING_PATTERN = re.compile(r"^\s{0,3}#\s+(.+?)\s*$")


@dataclass
class GraphNode:
    id: str
    type: str
    label: str
    path: str | None = None
    group: str | None = None
    tag: str | None = None


@dataclass
class GraphEdge:
    id: str
    source: str
    target: str
    type: str
    weight: float
    reasons: list[str] = field(default_factory=list)


@dataclass
class GraphFileEntry:
    id: str
    type: str
    title: str
    hash: str
    mtime: str
    tags: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)


@dataclass
class GraphDiagnostic:
    type: str
    severity: str
    message: str
    path: str | None = None
    target: str | None = None
    tag: str | None = None


@dataclass
class GraphIndex:
    version: int
    updated_at: str
    source: dict[str, Any]
    files: dict[str, GraphFileEntry] = field(default_factory=dict)
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    diagnostics: list[GraphDiagnostic] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "updated_at": self.updated_at,
            "source": self.source,
            "files": {path: asdict(entry) for path, entry in sorted(self.files.items())},
            "nodes": [_drop_none(asdict(node)) for node in self.nodes],
            "edges": [asdict(edge) for edge in self.edges],
            "diagnostics": [_drop_none(asdict(item)) for item in self.diagnostics],
        }

    @classmethod
    def empty(cls, diagnostic: GraphDiagnostic | None = None) -> GraphIndex:
        diagnostics = [diagnostic] if diagnostic else []
        return cls(
            version=GRAPH_INDEX_VERSION,
            updated_at=datetime.now().isoformat(timespec="seconds"),
            source={"tag_groups_hash": "", "note_base_relative": True},
            diagnostics=diagnostics,
        )


@snapshot_operation
def build_graph_index(vault_path: Path, tag_groups: list[dict[str, Any]]) -> GraphIndex:
    vault_root = vault_path.resolve()
    known_tags = _known_tag_map(tag_groups)
    files: dict[str, GraphFileEntry] = {}
    nodes_by_id: dict[str, GraphNode] = {}
    edges_by_id: dict[str, GraphEdge] = {}
    diagnostics: list[GraphDiagnostic] = []
    file_records: list[dict[str, Any]] = []

    sources = _iter_markdown_sources(vault_root)
    prefetch_markdown(sources)
    for md_path in sources:
        relative_path = md_path.relative_to(vault_root).as_posix()
        try:
            snapshot = read_markdown_snapshot(md_path)
            meta, body = snapshot.metadata, snapshot.body
        except (OSError, ValueError) as exc:
            diagnostics.append(
                GraphDiagnostic(
                    type="markdownReadFailed",
                    severity="warning",
                    message=f"Markdown file could not be read: {exc}",
                    path=relative_path,
                )
            )
            continue

        note_type = _note_type_for_path(vault_root, md_path, meta)
        if note_type in {"tag_index", "task_link"}:
            continue
        title = _title_for_markdown(md_path, meta, body)
        file_id = _file_node_id(meta, relative_path)
        if file_id in nodes_by_id:
            raise ValueError(f'Doppelte Graph-ID {file_id}: {nodes_by_id[file_id].path} und {relative_path}')
        content_hash = snapshot.revision
        tags = _extract_tags(meta, body)
        links = _extract_links(meta, body, relative_path)

        files[relative_path] = GraphFileEntry(
            id=file_id,
            type=note_type,
            title=title,
            hash=content_hash,
            mtime=datetime.fromtimestamp(snapshot.mtime_ns/1_000_000_000).isoformat(timespec="seconds"),
            tags=tags,
            links=[link["target"] for link in links],
        )
        nodes_by_id[file_id] = GraphNode(id=file_id, type=note_type, label=title, path=relative_path)
        file_records.append(
            {
                "id": file_id,
                "relative_path": relative_path,
                "path": md_path,
                "tags": tags,
                "links": links,
            }
        )

    link_lookup = _build_link_lookup(file_records)

    for record in file_records:
        file_id = str(record["id"])
        relative_path = str(record["relative_path"])
        for tag_key in record["tags"]:
            group, tag = tag_key.split(":", 1)
            tag_node_id = f"tag:{group}/{tag}"
            known_tag = known_tags.get(tag_key)
            label = str((known_tag or {}).get("displayName") or tag).replace("_", " ").replace("-", " ").strip() or tag
            nodes_by_id.setdefault(
                tag_node_id,
                GraphNode(id=tag_node_id, type="tag", label=label, group=group, tag=tag),
            )
            _add_edge(
                edges_by_id,
                source=file_id,
                target=tag_node_id,
                edge_type="tagUsage",
                weight=2,
                reason=f"Tag {tag_key}",
            )
            if tag_key not in known_tags:
                diagnostics.append(
                    GraphDiagnostic(
                        type="unknownTag",
                        severity="warning",
                        message=f"Tag is used but not defined in tag groups: {tag_key}",
                        path=relative_path,
                        tag=tag_key,
                    )
                )

        for link in record["links"]:
            target = str(link["target"])
            resolved = _resolve_link_target(target, link_lookup)
            if not resolved:
                diagnostics.append(
                    GraphDiagnostic(
                        type="unresolvedLink",
                        severity="warning",
                        message=f"WikiLink could not be resolved: [[{target}]]",
                        path=relative_path,
                        target=target,
                    )
                )
                continue
            _add_edge(
                edges_by_id,
                source=file_id,
                target=str(resolved["id"]),
                edge_type="link",
                weight=5,
                reason=_link_reason(link),
            )


    return GraphIndex(
        version=GRAPH_INDEX_VERSION,
        updated_at=datetime.now().isoformat(timespec="seconds"),
        source={
            "tag_groups_hash": _stable_json_hash(tag_groups),
            "note_base_relative": True,
        },
        files=files,
        nodes=sorted(nodes_by_id.values(), key=lambda node: (node.type, node.label.lower(), node.id)),
        edges=sorted(edges_by_id.values(), key=lambda edge: edge.id),
        diagnostics=diagnostics,
    )


@snapshot_operation
def update_graph_index_for_file(
    *,
    vault_path: Path,
    tag_groups: list[dict[str, Any]],
    index: GraphIndex,
    file_path: Path,
    previous_path: Path | None = None,
) -> GraphIndex:
    vault_root = vault_path.resolve()
    resolved = file_path.resolve()
    known_tags = _known_tag_map(tag_groups)
    previous_relative_path = _relative_markdown_path(vault_root, previous_path.resolve()) if previous_path else None
    relative_path = _relative_markdown_path(vault_root, resolved)

    old_file_entry = index.files.get(previous_relative_path or "") if previous_relative_path else None
    current_file_entry = index.files.get(relative_path or "") if relative_path else None
    old_file_ids = {entry.id for entry in (old_file_entry, current_file_entry) if entry and entry.id}

    files = dict(index.files)
    if previous_relative_path:
        files.pop(previous_relative_path, None)
    if relative_path:
        files.pop(relative_path, None)

    nodes_by_id = {
        node.id: node
        for node in index.nodes
        if node.id and node.id not in old_file_ids and not (node.path and node.path in {previous_relative_path, relative_path})
    }
    edges_by_id = {
        edge.id: edge
        for edge in index.edges
        if edge.type != "sharedTag" and edge.source not in old_file_ids
    }
    diagnostics = [
        item
        for item in index.diagnostics
        if item.path not in {previous_relative_path, relative_path}
        and item.type not in {"graphIndexReadFailed", "graphIndexUpdateFailed"}
    ]

    file_records = [
        {
            "id": entry.id,
            "relative_path": stored_relative_path,
            "tags": list(entry.tags),
            "links": [{"raw": link, "target": link} for link in entry.links],
        }
        for stored_relative_path, entry in files.items()
        if entry.id
    ]

    if not relative_path or not resolved.exists() or not resolved.is_file() or resolved.suffix.lower() != ".md":
        return _finalize_incremental_index(index, tag_groups, files, nodes_by_id, edges_by_id, diagnostics)
    if relative_path.split("/", 1)[0] in {".system", ".media"}:
        return _finalize_incremental_index(index, tag_groups, files, nodes_by_id, edges_by_id, diagnostics)

    try:
        snapshot = read_markdown_snapshot(resolved)
        meta, body = snapshot.metadata, snapshot.body
    except (OSError, ValueError) as exc:
        diagnostics.append(
            GraphDiagnostic(
                type="markdownReadFailed",
                severity="warning",
                message=f"Markdown file could not be read: {exc}",
                path=relative_path,
            )
        )
        return _finalize_incremental_index(index, tag_groups, files, nodes_by_id, edges_by_id, diagnostics)

    note_type = _note_type_for_path(vault_root, resolved, meta)
    if note_type in {"tag_index", "task_link"}:
        return _finalize_incremental_index(index, tag_groups, files, nodes_by_id, edges_by_id, diagnostics)

    title = _title_for_markdown(resolved, meta, body)
    file_id = _file_node_id(meta, relative_path)
    content_hash = snapshot.revision
    tags = _extract_tags(meta, body)
    links = _extract_links(meta, body, relative_path)

    files[relative_path] = GraphFileEntry(
        id=file_id,
        type=note_type,
        title=title,
        hash=content_hash,
        mtime=datetime.fromtimestamp(snapshot.mtime_ns/1_000_000_000).isoformat(timespec="seconds"),
        tags=tags,
        links=[link["target"] for link in links],
    )
    nodes_by_id[file_id] = GraphNode(id=file_id, type=note_type, label=title, path=relative_path)
    if file_id not in old_file_ids:
        edges_by_id = {edge_id: edge for edge_id, edge in edges_by_id.items() if edge.target not in old_file_ids}

    current_record = {
        "id": file_id,
        "relative_path": relative_path,
        "tags": tags,
        "links": links,
    }
    link_lookup = _build_link_lookup([*file_records, current_record])

    for tag_key in tags:
        group, tag = tag_key.split(":", 1)
        tag_node_id = f"tag:{group}/{tag}"
        known_tag = known_tags.get(tag_key)
        label = str((known_tag or {}).get("displayName") or tag).replace("_", " ").replace("-", " ").strip() or tag
        nodes_by_id.setdefault(
            tag_node_id,
            GraphNode(id=tag_node_id, type="tag", label=label, group=group, tag=tag),
        )
        _add_edge(
            edges_by_id,
            source=file_id,
            target=tag_node_id,
            edge_type="tagUsage",
            weight=2,
            reason=f"Tag {tag_key}",
        )
        if tag_key not in known_tags:
            diagnostics.append(
                GraphDiagnostic(
                    type="unknownTag",
                    severity="warning",
                    message=f"Tag is used but not defined in tag groups: {tag_key}",
                    path=relative_path,
                    tag=tag_key,
                )
            )

    for link in links:
        target = str(link["target"])
        resolved_target = _resolve_link_target(target, link_lookup)
        if not resolved_target:
            diagnostics.append(
                GraphDiagnostic(
                    type="unresolvedLink",
                    severity="warning",
                    message=f"WikiLink could not be resolved: [[{target}]]",
                    path=relative_path,
                    target=target,
                )
            )
            continue
        _add_edge(
            edges_by_id,
            source=file_id,
            target=str(resolved_target["id"]),
            edge_type="link",
            weight=5,
            reason=_link_reason(link),
        )

    _prune_orphan_tag_nodes(nodes_by_id, edges_by_id)
    return _finalize_incremental_index(index, tag_groups, files, nodes_by_id, edges_by_id, diagnostics)


def graph_index_from_dict(payload: Any) -> GraphIndex:
    if not isinstance(payload, dict):
        raise ValueError("Graph index payload must be an object.")
    if int(payload.get("version", 0) or 0) != GRAPH_INDEX_VERSION:
        raise ValueError("Unsupported graph index version.")

    files: dict[str, GraphFileEntry] = {}
    raw_files = payload.get("files", {})
    if isinstance(raw_files, dict):
        for raw_path, raw_entry in raw_files.items():
            if not isinstance(raw_entry, dict):
                continue
            path = str(raw_path).replace("\\", "/").strip().strip("/")
            if not path:
                continue
            files[path] = GraphFileEntry(
                id=str(raw_entry.get("id", "")),
                type=str(raw_entry.get("type", "note")),
                title=str(raw_entry.get("title", "")),
                hash=str(raw_entry.get("hash", "")),
                mtime=str(raw_entry.get("mtime", "")),
                tags=_string_list(raw_entry.get("tags")),
                links=_string_list(raw_entry.get("links")),
            )

    return GraphIndex(
        version=GRAPH_INDEX_VERSION,
        updated_at=str(payload.get("updated_at", "")),
        source=payload.get("source") if isinstance(payload.get("source"), dict) else {},
        files=files,
        nodes=[
            GraphNode(
                id=str(item.get("id", "")),
                type=str(item.get("type", "")),
                label=str(item.get("label", "")),
                path=str(item.get("path")) if item.get("path") is not None else None,
                group=str(item.get("group")) if item.get("group") is not None else None,
                tag=str(item.get("tag")) if item.get("tag") is not None else None,
            )
            for item in payload.get("nodes", [])
            if isinstance(item, dict)
        ],
        edges=[
            GraphEdge(
                id=str(item.get("id", "")),
                source=str(item.get("source", "")),
                target=str(item.get("target", "")),
                type=str(item.get("type", "")),
                weight=float(item.get("weight", 1) or 1),
                reasons=_string_list(item.get("reasons")),
            )
            for item in payload.get("edges", [])
            if isinstance(item, dict) and str(item.get("type", "")) not in {"backlink", "sharedTag"}
        ],
        diagnostics=[
            GraphDiagnostic(
                type=str(item.get("type", "")),
                severity=str(item.get("severity", "warning")),
                message=str(item.get("message", "")),
                path=str(item.get("path")) if item.get("path") is not None else None,
                target=str(item.get("target")) if item.get("target") is not None else None,
                tag=str(item.get("tag")) if item.get("tag") is not None else None,
            )
            for item in payload.get("diagnostics", [])
            if isinstance(item, dict)
        ],
    )


def _iter_markdown_sources(vault_root: Path) -> list[Path]:
    return markdown_sources(vault_root)


def _relative_markdown_path(vault_root: Path, file_path: Path) -> str | None:
    try:
        relative = file_path.relative_to(vault_root).as_posix()
    except ValueError:
        return None
    return relative if relative.lower().endswith(".md") else None


def _finalize_incremental_index(
    previous_index: GraphIndex,
    tag_groups: list[dict[str, Any]],
    files: dict[str, GraphFileEntry],
    nodes_by_id: dict[str, GraphNode],
    edges_by_id: dict[str, GraphEdge],
    diagnostics: list[GraphDiagnostic],
) -> GraphIndex:
    file_ids = {entry.id for entry in files.values()}
    edges_by_id = {key: edge for key, edge in edges_by_id.items() if edge.type == 'tagUsage' and edge.source in file_ids}
    records = [{"id": entry.id, "relative_path": path} for path, entry in files.items()]
    lookup = _build_link_lookup(records)
    diagnostics = [item for item in diagnostics if item.type != 'unresolvedLink']
    for path, entry in files.items():
        for target in entry.links:
            resolved = _resolve_link_target(target, lookup)
            if resolved:
                _add_edge(edges_by_id, entry.id, str(resolved['id']), 'link', 5, f'Link {target}')
            else:
                diagnostics.append(GraphDiagnostic(type='unresolvedLink', severity='warning', message=f'Link could not be resolved: {target}', path=path, target=target))
    _prune_orphan_tag_nodes(nodes_by_id, edges_by_id)
    return GraphIndex(
        version=GRAPH_INDEX_VERSION,
        updated_at=datetime.now().isoformat(timespec="seconds"),
        source={
            **previous_index.source,
            "tag_groups_hash": _stable_json_hash(tag_groups),
            "note_base_relative": True,
        },
        files=files,
        nodes=sorted(nodes_by_id.values(), key=lambda node: (node.type, node.label.lower(), node.id)),
        edges=sorted(edges_by_id.values(), key=lambda edge: edge.id),
        diagnostics=diagnostics,
    )


def _prune_orphan_tag_nodes(nodes_by_id: dict[str, GraphNode], edges_by_id: dict[str, GraphEdge]) -> None:
    referenced = {edge.source for edge in edges_by_id.values()} | {edge.target for edge in edges_by_id.values()}
    for node_id, node in list(nodes_by_id.items()):
        if node.type == "tag" and node_id not in referenced:
            nodes_by_id.pop(node_id, None)


def related_files(index: GraphIndex, file_id: str, limit: int = 50) -> dict[str, Any]:
    """Bounded neighbourhood; never materialise all pairs sharing a popular tag."""
    limit = max(1, min(limit, 200))
    source = next((entry for entry in index.files.values() if entry.id == file_id), None)
    if source is None:
        return {"items": [], "truncated": False, "limit": limit}
    tags = set(source.tags)
    direct = {edge.target if edge.source == file_id else edge.source for edge in index.edges if edge.type == 'link' and file_id in {edge.source, edge.target}}
    candidates = []
    for path, entry in index.files.items():
        if entry.id == file_id:
            continue
        shared = sorted(tags.intersection(entry.tags))
        weight = sum(_shared_tag_weight(tag) for tag in shared) + (5 if entry.id in direct else 0)
        if weight:
            candidates.append({"id": entry.id, "path": path, "title": entry.title, "weight": weight, "sharedTags": shared, "sharedWeight": sum(_shared_tag_weight(tag) for tag in shared), "linked": entry.id in direct})
    candidates.sort(key=lambda item: (-item['weight'], item['path'].lower()))
    return {"items": candidates[:limit], "truncated": len(candidates) > limit, "limit": limit, "total": len(candidates)}


def _shared_tag_weight(tag_key: str) -> int:
    group = tag_key.split(":", 1)[0]
    if group == "project":
        return 3
    if group == "person":
        return 2
    return 1


def _known_tag_map(tag_groups: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    known: dict[str, dict[str, str]] = {}
    for group in tag_groups:
        if not isinstance(group, dict):
            continue
        group_id = _normalize_tag_token(str(group.get("id", "")))
        if not group_id:
            continue
        raw_tags = group.get("tags", [])
        if not isinstance(raw_tags, list):
            continue
        for tag in raw_tags:
            if not isinstance(tag, dict):
                continue
            tag_id = _normalize_tag_token(str(tag.get("id", "")))
            if not tag_id:
                continue
            known[f"{group_id}:{tag_id}"] = {
                "displayName": str(tag.get("displayName", "")).strip() or tag_id,
            }
    return known


def _note_type_for_path(vault_root: Path, file_path: Path, meta: dict[str, Any]) -> str:
    raw_type = str(meta.get("type", "")).strip().lower().replace("-", "_").replace(" ", "_")
    if raw_type in {"tag_index", "task_link"}:
        return raw_type
    if raw_type == "task":
        return "task"
    return "note"


def _title_for_markdown(file_path: Path, meta: dict[str, Any], body: str) -> str:
    title = str(meta.get("title", "")).strip()
    if title:
        return _normalize_label(title)
    for line in body.splitlines():
        heading = TITLE_HEADING_PATTERN.match(line)
        if heading:
            return _normalize_label(heading.group(1))
        stripped = line.strip()
        if stripped:
            return _normalize_label(stripped[:120])
    return file_path.stem


def _file_node_id(meta: dict[str, Any], relative_path: str) -> str:
    raw_id = str(meta.get("node_id") or meta.get("id") or "").strip()
    if raw_id:
        return f"file:{raw_id}"
    digest = hashlib.sha1(relative_path.encode("utf-8")).hexdigest()[:16]
    return f"file:{digest}"



def _extract_tags(meta: dict[str, Any], body: str) -> list[str]:
    found: set[str] = set()
    for key in ("tags", "tags_auto"):
        for item in _string_list(meta.get(key)):
            tag_key = _normalize_tag_key(item)
            if tag_key:
                found.add(tag_key)

    from .markdown_syntax import prose_text
    for match in INLINE_TAG_PATTERN.finditer(prose_text(body)):
        tag_key = _normalize_tag_key(f"{match.group(1)}:{match.group(2)}")
        if tag_key:
            found.add(tag_key)

    return sorted(found, key=lambda item: item.lower())


def _extract_links(meta: dict[str, Any], body: str, source_path: str = '') -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(raw: str, target: str, source: str) -> None:
        clean_target = _normalize_link_target(target)
        if not clean_target:
            return
        key = clean_target.lower()
        if key in seen:
            return
        seen.add(key)
        links.append({"raw": raw, "target": clean_target, "source": source})

    for key in ("related", "related_auto"):
        for item in _string_list(meta.get(key)):
            add(item, item, key)

    from .markdown_syntax import prose_text, split_markdown_destination
    import posixpath
    from urllib.parse import unquote, urlsplit
    prose = prose_text(body)
    for link in _extract_wikilinks(prose):
        add(link["raw"], link["target"], "wikilink")
    for match in re.finditer(r'(?<!!)\[[^]\n]*\]\(([^)\n]+)\)', prose):
        parts = split_markdown_destination(match.group(1))
        if parts is None:
            continue
        target = unquote(parts[0])
        path = target.split('#', 1)[0]
        if urlsplit(target).scheme or not path.lower().endswith('.md'):
            continue
        resolved = posixpath.normpath(path.lstrip('/') if path.startswith('/') else posixpath.join(posixpath.dirname(source_path), path))
        if not resolved.startswith('../'):
            add(target, resolved, 'markdown')

    return links


def _link_reason(link: dict[str, str]) -> str:
    if link.get("source") in {"related", "related_auto"}:
        return f"Frontmatter {link['source']} {link['target']}"
    return f"WikiLink [[{link['raw']}]]"


def _extract_wikilinks(body: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for match in WIKILINK_PATTERN.finditer(body):
        raw = match.group(1).strip()
        if not raw:
            continue
        target = _normalize_link_target(raw)
        if not target:
            continue
        key = target.lower()
        if key in seen:
            continue
        seen.add(key)
        links.append({"raw": raw, "target": target})
    return links


def _normalize_link_target(raw: str) -> str:
    target = str(raw or "").split("|", 1)[0].strip()
    target = target.split("#", 1)[0].strip().replace("\\", "/")
    target = target[:-3] if target.lower().endswith(".md") else target
    return target.strip().strip("/")


def _build_link_lookup(records: list[dict[str, Any]]) -> dict[str, dict[str, Any] | None]:
    lookup: dict[str, dict[str, Any] | None] = {}

    def add(key: str, record: dict[str, Any]) -> None:
        for clean in {_normalize_link_lookup_key(key), _slugified_link_lookup_key(key), _loose_link_lookup_key(key)}:
            if not clean:
                continue
            if clean not in lookup:
                lookup[clean] = record
                continue
            current = lookup.get(clean)
            if current and current.get("id") == record.get("id"):
                continue
            lookup[clean] = None

    for record in records:
        relative_path = str(record["relative_path"])
        no_ext = relative_path[:-3] if relative_path.lower().endswith(".md") else relative_path
        add(relative_path, record)
        add(no_ext, record)
        add(Path(no_ext).name, record)
    return lookup


def _resolve_link_target(target: str, lookup: dict[str, dict[str, Any] | None]) -> dict[str, Any] | None:
    clean = _normalize_link_lookup_key(target)
    if not clean:
        return None
    return lookup.get(clean) or lookup.get(_slugified_link_lookup_key(target)) or lookup.get(_loose_link_lookup_key(target))


def _add_edge(
    edges_by_id: dict[str, GraphEdge],
    source: str,
    target: str,
    edge_type: str,
    weight: float,
    reason: str,
) -> None:
    edge_id = f"{edge_type}:{_edge_token(source)}->{_edge_token(target)}"
    existing = edges_by_id.get(edge_id)
    if existing:
        if reason not in existing.reasons:
            existing.reasons.append(reason)
        existing.weight = max(existing.weight, weight)
        return
    edges_by_id[edge_id] = GraphEdge(
        id=edge_id,
        source=source,
        target=target,
        type=edge_type,
        weight=weight,
        reasons=[reason],
    )


def _normalize_tag_key(raw: str) -> str:
    clean = raw.strip().replace("{tag:", "").replace("}", "").lstrip("#")
    delimiter = ":" if ":" in clean else "/" if "/" in clean else ""
    if delimiter:
        left, right = clean.split(delimiter, 1)
        group = _normalize_tag_token(left)
        tag = _normalize_tag_token(right)
        return f"{group}:{tag}" if group and tag else ""
    topic = _normalize_tag_token(clean)
    return f"topic:{topic}" if topic else ""


def _normalize_tag_token(raw: str) -> str:
    return slugify(raw.strip().replace("-", "_")).replace("_", "-")


def _normalize_link_lookup_key(raw: str) -> str:
    clean = str(raw or "").strip().replace("\\", "/").strip("/")
    clean = clean[:-3] if clean.lower().endswith(".md") else clean
    return clean.lower()


def _slugified_link_lookup_key(raw: str) -> str:
    clean = _normalize_link_lookup_key(raw)
    return "/".join(slugify(part) for part in clean.split("/") if part)


def _loose_link_lookup_key(raw: str) -> str:
    clean = _normalize_link_lookup_key(raw)
    return "/".join(re.sub(r"[^a-z0-9]+", "", part) for part in clean.split("/") if part)


def _normalize_label(value: str) -> str:
    return " ".join(value.strip().split())


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _drop_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _edge_token(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:/-]+", "_", value)


def _stable_json_hash(value: Any) -> str:
    import json

    payload = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
