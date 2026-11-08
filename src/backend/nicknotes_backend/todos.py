from __future__ import annotations

import hashlib
import re
from datetime import datetime
import uuid
from dataclasses import dataclass


TODO_LINE_PATTERN = re.compile(r"^(\s*[-*+]\s+\[([ xX])\]\s+)(.*)$")
from .task_domain import normalize_tag_id
FENCE_PATTERN = re.compile(r"^\s*(`{3,}|~{3,})")
PROMOTION_MARKER_PATTERN = re.compile(r"\s*<!--\s*nn:todo:promoted:([A-Za-z0-9][A-Za-z0-9_-]{1,120})\s*-->\s*$")
HISTORY_PATTERN = re.compile(r'\s*<!-- nn:todo created=([^ ]*) completed=([^ ]*) -->')
BLOCK_REF_PATTERN = re.compile(r"\s+\^([A-Za-z0-9][A-Za-z0-9_-]{0,79})\s*$")
INLINE_TAG_PATTERN = re.compile(r"\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)/([A-Za-z0-9][A-Za-z0-9_-]*)\}")
WIKILINK_PATTERN = re.compile(r"\[\[([^[\]\n]+)\]\]")
MARKDOWN_LINK_PATTERN = re.compile(r"\[[^\]\n]*\]\(([^)\n]+)\)")


@dataclass(frozen=True)
class ExtractedTodo:
    id: str
    line_no: int
    block_ref: str | None
    checked: bool
    raw_text: str
    explicit_tags: list[str]
    inherited_tags: list[str]
    links: list[str]
    promoted: bool
    promoted_task_id: str | None
    created_at: str = ""
    completed_at: str | None = None


@dataclass(frozen=True)
class _TodoMatch:
    id: str
    line_index: int
    line_no: int
    prefix: str
    tail: str
    block_ref: str | None
    checked: bool
    raw_text: str
    explicit_tags: list[str]
    inherited_tags: list[str]
    links: list[str]
    promoted: bool
    promoted_task_id: str | None
    created_at: str = ""
    completed_at: str | None = None


def _normalized_for_id(value: str) -> str:
    return " ".join(value.strip().split()).lower()


def _build_todo_id(note_anchor: str, line_no: int, text: str, block_ref: str | None) -> str:
    if block_ref and block_ref.startswith("nn-todo_"):
        return block_ref[3:]
    clean_anchor = note_anchor.strip() or "note"
    clean_text = _normalized_for_id(text)
    stable_ref = f"ref:{block_ref}" if block_ref else f"line:{line_no}:{clean_text}"
    digest = hashlib.sha1(f"{clean_anchor}|{stable_ref}".encode("utf-8")).hexdigest()[:16]
    return f"todo_{digest}"


def _split_promotion_marker(value: str) -> tuple[str, str | None]:
    match = PROMOTION_MARKER_PATTERN.search(value)
    if not match:
        return value, None
    return value[: match.start()].rstrip(), match.group(1)


def _split_block_ref(value: str) -> tuple[str, str | None]:
    match = BLOCK_REF_PATTERN.search(value)
    if not match:
        return value, None
    return value[: match.start()].rstrip(), match.group(1)


def _extract_tag_keys(text: str) -> list[str]:
    found: set[str] = set()

    for match in INLINE_TAG_PATTERN.finditer(text):
        group = normalize_tag_id(match.group(1))
        tag = normalize_tag_id(match.group(2))
        if not group or not tag:
            continue
        key = f"{group}:{tag}"
        if ":" in key and not key.endswith(":"):
            found.add(key)

    return sorted(found, key=lambda item: item.lower())


def _normalize_link_target(value: str) -> str:
    clean = value.strip()
    if not clean:
        return ""
    if clean.startswith("<") and clean.endswith(">"):
        clean = clean[1:-1].strip()
    if clean.startswith(("http://", "https://", "mailto:", "data:", "file://")):
        return ""
    clean = clean.split('"', 1)[0].split("'", 1)[0].strip()
    clean = clean.split("#", 1)[0].strip().replace("\\", "/")
    if clean.lower().endswith(".md"):
        clean = clean[:-3]
    return clean


def _extract_links(text: str) -> list[str]:
    refs: set[str] = set()
    for match in WIKILINK_PATTERN.finditer(text):
        raw = match.group(1).strip()
        if not raw:
            continue
        target = raw.split("|", 1)[0].strip()
        clean = _normalize_link_target(target)
        if clean:
            refs.add(clean)
    for match in MARKDOWN_LINK_PATTERN.finditer(text):
        clean = _normalize_link_target(match.group(1))
        if clean:
            refs.add(clean)
    return sorted(refs, key=lambda item: item.lower())


def _scan_todos(lines: list[str], note_anchor: str, inherited_tags: list[str]) -> list[_TodoMatch]:
    todos: list[_TodoMatch] = []
    inherited = sorted({item.strip() for item in inherited_tags if item and item.strip()}, key=lambda item: item.lower())

    in_fence = False
    fence_char = ""
    fence_len = 0

    for line_index, line in enumerate(lines):
        fence = FENCE_PATTERN.match(line)
        if fence:
            token = fence.group(1)
            char = token[0]
            length = len(token)
            if not in_fence:
                in_fence = True
                fence_char = char
                fence_len = length
            elif char == fence_char and length >= fence_len:
                in_fence = False
            continue

        if in_fence:
            continue

        match = TODO_LINE_PATTERN.match(line)
        if not match:
            continue

        prefix = match.group(1)
        checked = match.group(2).lower() == "x"
        tail = match.group(3).rstrip()
        without_marker, promoted_task_id = _split_promotion_marker(tail)
        without_block_ref, block_ref = _split_block_ref(without_marker)
        history = HISTORY_PATTERN.search(without_block_ref)
        created_at = history.group(1) if history else ''
        completed_at = (history.group(2) or None) if history else None
        raw_text = HISTORY_PATTERN.sub('', without_block_ref).strip()
        if not raw_text:
            continue

        todo_id = _build_todo_id(note_anchor, line_index + 1, raw_text, block_ref)
        explicit_tags = _extract_tag_keys(raw_text)
        links = _extract_links(raw_text)

        todos.append(
            _TodoMatch(
                id=todo_id,
                line_index=line_index,
                line_no=line_index + 1,
                prefix=prefix,
                tail=tail,
                block_ref=block_ref,
                checked=checked,
                raw_text=raw_text,
                explicit_tags=explicit_tags,
                inherited_tags=inherited,
                links=links,
                promoted=bool(promoted_task_id),
                promoted_task_id=promoted_task_id,
                created_at=created_at,
                completed_at=completed_at,
            )
        )

    return todos


def extract_todos_from_body(body: str, note_anchor: str, inherited_tags: list[str] | None = None) -> list[ExtractedTodo]:
    lines = body.splitlines()
    matches = _scan_todos(lines, note_anchor=note_anchor, inherited_tags=inherited_tags or [])
    return [
        ExtractedTodo(
            id=item.id,
            line_no=item.line_no,
            block_ref=item.block_ref,
            checked=item.checked,
            raw_text=item.raw_text,
            explicit_tags=item.explicit_tags,
            inherited_tags=item.inherited_tags,
            links=item.links,
            promoted=item.promoted,
            promoted_task_id=item.promoted_task_id,
            created_at=item.created_at,
            completed_at=item.completed_at,
        )
        for item in matches
    ]


def toggle_todo_checkbox(
    body: str,
    note_anchor: str,
    todo_id: str,
    checked: bool | None = None,
    inherited_tags: list[str] | None = None,
) -> tuple[str, ExtractedTodo | None]:
    lines = body.splitlines()
    matches = _scan_todos(lines, note_anchor=note_anchor, inherited_tags=inherited_tags or [])
    target = next((item for item in matches if item.id == todo_id), None)
    if target is None:
        return body, None

    next_checked = (not target.checked) if checked is None else bool(checked)
    if next_checked == target.checked:
        return body, ExtractedTodo(
            id=target.id,
            line_no=target.line_no,
            block_ref=target.block_ref,
            checked=target.checked,
            raw_text=target.raw_text,
            explicit_tags=target.explicit_tags,
            inherited_tags=target.inherited_tags,
            links=target.links,
            promoted=target.promoted,
            promoted_task_id=target.promoted_task_id,
            created_at=target.created_at,
            completed_at=target.completed_at,
        )

    next_marker = "[x]" if next_checked else "[ ]"
    next_prefix = re.sub(r"\[[ xX]\]", next_marker, target.prefix, count=1)
    block_ref = target.block_ref or f'nn-{target.id}'
    created = target.created_at
    completed = datetime.now().astimezone().isoformat(timespec='seconds') if next_checked else ''
    tail = f'{target.raw_text} <!-- nn:todo created={created} completed={completed} --> ^{block_ref}'
    if target.promoted_task_id:
        tail += f' <!-- nn:todo:promoted:{target.promoted_task_id} -->'
    lines[target.line_index] = f"{next_prefix}{tail}"

    next_body = "\n".join(lines)
    refreshed = extract_todos_from_body(next_body, note_anchor=note_anchor, inherited_tags=inherited_tags or [])
    updated = next((item for item in refreshed if item.id == todo_id), None)
    return next_body, updated


def mark_todo_promoted(
    body: str,
    note_anchor: str,
    todo_id: str,
    task_id: str,
    inherited_tags: list[str] | None = None,
) -> tuple[str, ExtractedTodo | None]:
    lines = body.splitlines()
    matches = _scan_todos(lines, note_anchor=note_anchor, inherited_tags=inherited_tags or [])
    target = next((item for item in matches if item.id == todo_id), None)
    if target is None:
        return body, None

    if target.promoted and target.promoted_task_id == task_id:
        return body, ExtractedTodo(
            id=target.id,
            line_no=target.line_no,
            block_ref=target.block_ref,
            checked=target.checked,
            raw_text=target.raw_text,
            explicit_tags=target.explicit_tags,
            inherited_tags=target.inherited_tags,
            links=target.links,
            promoted=target.promoted,
            promoted_task_id=target.promoted_task_id,
            created_at=target.created_at,
            completed_at=target.completed_at,
        )

    block_ref=target.block_ref or f'nn-{target.id}'
    updated_tail = f"{target.raw_text} <!-- nn:todo created={target.created_at} completed={target.completed_at or ''} --> ^{block_ref} <!-- nn:todo:promoted:{task_id} -->"
    lines[target.line_index] = f"{target.prefix}{updated_tail}"

    next_body = "\n".join(lines)
    refreshed = extract_todos_from_body(next_body, note_anchor=note_anchor, inherited_tags=inherited_tags or [])
    updated = next((item for item in refreshed if item.id == todo_id), None)
    return next_body, updated


def synchronize_todo_history(previous_body: str, body: str, previous_anchor: str, note_anchor: str) -> str:
    """Adopt stable references and persist editor checkbox transitions in the source."""
    previous=_scan_todos(previous_body.splitlines(),previous_anchor,[])
    current=_scan_todos(body.splitlines(),note_anchor,[])
    by_id={item.id:item for item in previous}
    by_text={}
    for item in previous:
        by_text.setdefault(_normalized_for_id(item.raw_text),[]).append(item)
    lines=body.splitlines()
    now=datetime.now().astimezone().isoformat(timespec='seconds')
    used=set()
    for item in current:
        old=by_id.get(item.id)
        candidates=by_text.get(_normalized_for_id(item.raw_text),[])
        if old is None and len(candidates)==1 and candidates[0].id not in used:
            old=candidates[0]
        if old:
            used.add(old.id)
        stable=item.block_ref or ('nn-'+(old.id if old else item.id))
        created=item.created_at or (old.created_at if old else now)
        completed=item.completed_at if item.checked else None
        if item.checked and not completed:
            completed=(old.completed_at if old and old.checked else now)
        tail=f"{item.raw_text} <!-- nn:todo created={created} completed={completed or ''} --> ^{stable}"
        promoted=item.promoted_task_id or (old.promoted_task_id if old else None)
        if promoted:
            tail+=f' <!-- nn:todo:promoted:{promoted} -->'
        lines[item.line_index]=item.prefix+tail
    return '\n'.join(lines)+('\n' if body.endswith('\n') else '')
