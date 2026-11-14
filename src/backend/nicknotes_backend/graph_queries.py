"""Read-only graph queries for agents: neighbourhoods with reasons and graph-aware search ranking."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from .graph_index import GraphIndex, related_files


def _adjacency(index: GraphIndex) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    outgoing: dict[str, set[str]] = defaultdict(set)
    incoming: dict[str, set[str]] = defaultdict(set)
    for edge in index.edges:
        if edge.type == 'link' and edge.source != edge.target:
            outgoing[edge.source].add(edge.target)
            incoming[edge.target].add(edge.source)
    return outgoing, incoming


def note_context(index: GraphIndex, relative_path: str, depth: int = 1, limit: int = 30) -> dict[str, Any]:
    """Links, backlinks, tag neighbours and (depth 2) the notes behind direct links, each with a reason."""
    limit = max(1, min(limit, 100))
    entry = index.files.get(relative_path)
    if entry is None:
        return {'note': None, 'links': [], 'backlinks': [], 'related': [], 'secondDegree': []}
    by_id = {item.id: (path, item) for path, item in index.files.items()}
    outgoing, incoming = _adjacency(index)

    def describe(file_id: str) -> dict[str, Any] | None:
        found = by_id.get(file_id)
        return {'path': found[0], 'title': found[1].title, 'tags': found[1].tags} if found else None

    def listing(ids: set[str]) -> list[dict[str, Any]]:
        items = [item for item in (describe(file_id) for file_id in ids) if item]
        return sorted(items, key=lambda item: item['title'].lower())[:limit]

    direct = outgoing[entry.id] | incoming[entry.id]
    result: dict[str, Any] = {
        'note': describe(entry.id),
        'links': listing(outgoing[entry.id]),
        'backlinks': listing(incoming[entry.id]),
        'related': related_files(index, entry.id, limit)['items'],
        'secondDegree': [],
    }
    if depth >= 2:
        via: dict[str, list[str]] = defaultdict(list)
        for neighbour in direct:
            for candidate in outgoing[neighbour] | incoming[neighbour]:
                if candidate != entry.id and candidate not in direct and candidate in by_id:
                    via[candidate].append(by_id[neighbour][1].title)
        ranked = sorted(via.items(), key=lambda item: (-len(item[1]), by_id[item[0]][1].title.lower()))
        result['secondDegree'] = [describe(file_id) | {'via': sorted(titles)[:5]} for file_id, titles in ranked[:limit]]
    return result


def graph_ranked(index: GraphIndex, hits: list[dict[str, Any]], rerank: bool = True) -> list[dict[str, Any]]:
    """Re-rank text hits: notes linked with other hits rise; every hit names its tags, backlinks and linked hits."""
    ids = {path: item.id for path, item in index.files.items()}
    outgoing, incoming = _adjacency(index)
    hit_ids = {ids[hit['relativePath']]: hit for hit in hits if hit.get('relativePath') in ids}
    titles = {file_id: hit['title'] for file_id, hit in hit_ids.items()}
    count = max(len(hits), 1)
    scored = []
    for rank, hit in enumerate(hits):
        file_id = ids.get(hit.get('relativePath', ''))
        neighbours = (outgoing[file_id] | incoming[file_id]) if file_id else set()
        linked = sorted(titles[other] for other in neighbours if other in titles and other != file_id)
        backlinks = len(incoming[file_id]) if file_id else 0
        entry = index.files.get(hit.get('relativePath', ''))
        # Text rank stays the base; each linked hit is worth about a third of the list, capped.
        score = (count - rank) / count + 0.35 * min(len(linked), 3) + 0.05 * min(backlinks, 10)
        scored.append((score, -rank, hit | {'tags': entry.tags if entry else [], 'backlinks': backlinks, 'linkedHits': linked[:5]}))
    if rerank:
        scored.sort(key=lambda item: (-item[0], -item[1]))
    return [hit for _, _, hit in scored]
