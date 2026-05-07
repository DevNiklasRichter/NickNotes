from __future__ import annotations

import base64
import binascii
import logging
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .nicknotes_backend.ai_client import OpenAIConfig, OpenAISuggester
from .nicknotes_backend.graph_index import GraphIndex, build_graph_index, update_graph_index_for_file
from .nicknotes_backend.graph_storage import read_graph_index, read_graph_state, write_graph_index, write_graph_state
from .nicknotes_backend.indexer import VaultIndexer
from .nicknotes_backend.markdown_io import dump_markdown, parse_markdown
from .nicknotes_backend.models import ParsedTask, TagSuggestion
from .nicknotes_backend.parser import CaptureParser
from .nicknotes_backend.vault import VaultManager


logger = logging.getLogger(__name__)


@dataclass
class GraphRuntimeStatus:
    is_updating: bool = False
    last_error: str | None = None


@dataclass
class RuntimeState:
    vault: VaultManager | None = None
    indexer: VaultIndexer | None = None
    parser: CaptureParser = field(default_factory=CaptureParser)
    openai: OpenAISuggester | None = None
    graph_status: GraphRuntimeStatus = field(default_factory=GraphRuntimeStatus)

    def close(self) -> None:
        if self.indexer:
            self.indexer.close()
            self.indexer = None
        self.vault = None
        self.openai = None


state = RuntimeState()

app = FastAPI(title="NickNotes Backend", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class VaultOpenRequest(BaseModel):
    path: str


class VaultCreateRequest(BaseModel):
    parent_path: str = Field(alias="parentPath")
    name: str


class NoteBaseRenameRequest(BaseModel):
    new_name: str = Field(alias="newName")


class NoteBaseDeleteRequest(BaseModel):
    confirm_delete: bool = Field(default=False, alias="confirmDelete")


class CapturePreviewRequest(BaseModel):
    text: str


class CaptureSaveRequest(BaseModel):
    text: str
    selected_tag_keys: list[str] = Field(default_factory=list, alias="selectedTagKeys")
    selected_todo_texts: list[str] = Field(default_factory=list, alias="selectedTodoTexts")


class FocusMitUpdateRequest(BaseModel):
    date: str | None = None
    mit_ids: list[str] = Field(default_factory=list, alias="mitIds")


class FocusQuickCaptureRequest(BaseModel):
    text: str
    date: str | None = None


class NoteOpenRequest(BaseModel):
    path: str


class NoteSaveRequest(BaseModel):
    path: str
    content: str


class NoteMediaAddRequest(BaseModel):
    path: str
    file_name: str = Field(alias="fileName")
    content_type: str = Field(default="", alias="contentType")
    data_base64: str = Field(alias="dataBase64")


class TagGroupRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    display_name: str = Field(default="", alias="displayName")
    color: str = Field(default="#4f8cff")


class TagCreateRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    display_name: str = Field(default="", alias="displayName")


class TagRenameRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    new_tag_id: str = Field(alias="newTagId")
    new_display_name: str = Field(default="", alias="newDisplayName")
    apply_to_notes: bool = Field(default=True, alias="applyToNotes")


class TagGroupRenameRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    new_group_id: str = Field(alias="newGroupId")
    new_display_name: str = Field(default="", alias="newDisplayName")
    new_color: str = Field(default="#4f8cff", alias="newColor")
    apply_to_notes: bool = Field(default=True, alias="applyToNotes")


class TagGroupDeleteRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    remove_from_notes: bool = Field(default=False, alias="removeFromNotes")


class TagMoveRequest(BaseModel):
    from_group: str = Field(alias="fromGroup")
    tag_id: str = Field(alias="tagId")
    to_group: str = Field(alias="toGroup")
    apply_to_notes: bool = Field(default=True, alias="applyToNotes")


class TagDeleteRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    remove_from_notes: bool = Field(default=False, alias="removeFromNotes")


class NoteGroupCreateRequest(BaseModel):
    group_name: str = Field(alias="groupName")
    parent_key: str = Field(default="", alias="parentKey")


class NoteCreateRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    title: str = ""
    note_type: str = Field(default="note", alias="noteType")
    status: str = "open"


class NoteGroupRenameRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    new_name: str = Field(alias="newName")


class NoteGroupDeleteRequest(BaseModel):
    group_key: str = Field(alias="groupKey")


class NoteGroupMoveRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    target_parent_key: str = Field(alias="targetParentKey")


class NoteFileRenameRequest(BaseModel):
    path: str
    new_name: str = Field(alias="newName")


class NoteFileDeleteRequest(BaseModel):
    path: str


class NoteFileMoveRequest(BaseModel):
    path: str
    target_group_key: str = Field(alias="targetGroupKey")


class NoteFileMoveBatchRequest(BaseModel):
    paths: list[str] = Field(default_factory=list)
    target_group_key: str = Field(alias="targetGroupKey")


class FavoriteFolderRequest(BaseModel):
    group_key: str = Field(alias="groupKey")


class UiSettingsUpdateRequest(BaseModel):
    app: dict[str, Any] | None = None
    explorer: dict[str, Any] | None = None


class TodoToggleRequest(BaseModel):
    checked: bool | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "vaultLoaded": state.vault is not None}


@app.get("/state")
def get_state() -> dict[str, Any]:
    if not state.vault or not state.indexer:
        return {"vaultLoaded": False}
    return {
        "vaultLoaded": True,
        "vaultPath": str(state.vault.vault_path),
        "noteBasePath": str(state.vault.vault_path),
        "counts": _counts(state.indexer),
    }


@app.post("/vault/open")
def open_vault(req: VaultOpenRequest) -> dict[str, Any]:
    vault_path = Path(req.path).expanduser().resolve()
    if not vault_path.exists():
        raise HTTPException(status_code=400, detail=f"NoteBase path not found: {vault_path}")

    state.close()
    vault = VaultManager(vault_path)
    vault.ensure_structure()
    indexer = VaultIndexer(vault.db_path)

    cfg = vault.read_config()
    openai_cfg = cfg.get("openai", {})
    smart_enabled = cfg.get("mode", "core") == "smart" and bool(openai_cfg.get("enabled"))
    openai = OpenAISuggester(
        OpenAIConfig(
            enabled=smart_enabled,
            model=str(openai_cfg.get("model", "gpt-4.1-mini")),
            api_key_env=str(openai_cfg.get("api_key_env", "OPENAI_API_KEY")),
        )
    )

    indexed = indexer.reindex_vault(vault_path)
    try:
        vault.bootstrap_task_status_links(indexer)
    except OSError:
        # Task-Link bootstrap is best-effort and should not block opening the NoteBase.
        pass
    tag_groups = vault.sync_tag_groups_with_index(indexer)
    state.vault = vault
    state.indexer = indexer
    state.openai = openai

    return {
        "vaultPath": str(vault_path),
        "noteBasePath": str(vault_path),
        "indexed": indexed,
        "mode": "smart" if smart_enabled else "core",
        "tagGroups": tag_groups,
        "counts": _counts(indexer),
    }


@app.post("/vault/create")
def create_vault(req: VaultCreateRequest) -> dict[str, Any]:
    parent = Path(req.parent_path).expanduser().resolve()
    if not parent.exists() or not parent.is_dir():
        raise HTTPException(status_code=400, detail=f"Parent path not found: {parent}")

    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="NoteBase name cannot be empty")

    vault_path = parent / name
    vault_path.mkdir(parents=True, exist_ok=True)
    return open_vault(VaultOpenRequest(path=str(vault_path)))


@app.post("/vault/reindex")
def reindex_vault() -> dict[str, Any]:
    vault, indexer = _require_loaded()
    indexed = indexer.reindex_vault(vault.vault_path)
    vault.rebuild_task_status_links(indexer)
    tag_groups = vault.sync_tag_groups_with_index(indexer)
    return {"indexed": indexed, "counts": _counts(indexer), "tagGroups": tag_groups}


@app.post("/notebase/open")
def open_notebase(req: VaultOpenRequest) -> dict[str, Any]:
    return open_vault(req)


@app.post("/notebase/create")
def create_notebase(req: VaultCreateRequest) -> dict[str, Any]:
    return create_vault(req)


@app.post("/notebase/reindex")
def reindex_notebase() -> dict[str, Any]:
    return reindex_vault()


@app.post("/notebase/rename")
def rename_notebase(req: NoteBaseRenameRequest) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    old_path = vault.vault_path.resolve()
    new_name = req.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="New NoteBase name cannot be empty")
    if any(token in new_name for token in ("/", "\\")):
        raise HTTPException(status_code=400, detail="New NoteBase name must not contain path separators")
    if new_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid NoteBase name")

    new_path = old_path.parent / new_name
    if new_path == old_path:
        return {
            "vaultPath": str(old_path),
            "noteBasePath": str(old_path),
            "counts": _counts(state.indexer) if state.indexer else {"notes": 0, "openTasks": 0, "doneTasks": 0},
        }
    if new_path.exists():
        raise HTTPException(status_code=400, detail=f"Target path already exists: {new_path}")

    try:
        state.close()
        old_path.rename(new_path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not rename NoteBase: {exc}") from exc

    return open_vault(VaultOpenRequest(path=str(new_path)))


@app.post("/notebase/delete")
def delete_notebase(req: NoteBaseDeleteRequest) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    if not req.confirm_delete:
        raise HTTPException(status_code=400, detail="confirmDelete must be true to delete a NoteBase")

    target = vault.vault_path.resolve()
    try:
        state.close()
        shutil.rmtree(target)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete NoteBase: {exc}") from exc

    return {"deleted": True, "deletedPath": str(target), "vaultLoaded": False}


@app.post("/capture/preview")
def preview_capture(req: CapturePreviewRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    merged, parsed_todos = _compute_capture(req.text, vault, indexer)
    auto_count = sum(1 for item in merged if item.auto_apply or item.source == "explicit")
    return {
        "suggestions": [_tag_payload(item) for item in merged],
        "todos": parsed_todos,
        "tasks": [],
        "stats": {
            "tags": len(merged),
            "todos": len(parsed_todos),
            "tasks": 0,
            "auto": auto_count,
        },
    }


@app.post("/capture/save")
def save_capture(req: CaptureSaveRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Capture text is empty")

    merged, parsed_todos = _compute_capture(text, vault, indexer)
    selected_keys = set(req.selected_tag_keys)
    selected_tags = [tag for tag in merged if tag.key in selected_keys]
    selected_todos = _normalize_todo_selection(req.selected_todo_texts, fallback=parsed_todos)

    result = vault.save_capture(
        text=text,
        selected_tags=selected_tags,
        todos=selected_todos,
        indexer=indexer,
    )

    return {
        "saved": True,
        "noteId": result["note_id"],
        "date": result["date"],
        "notePath": str(result["note_path"]),
        "todoTexts": result["todo_texts"],
        "todoCount": len(result["todo_texts"]),
        "counts": _counts(indexer),
    }


@app.get("/focus/mit")
def get_focus_mit(date: str | None = None) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    state = vault.get_daily_mit(day_iso=date)
    return {
        "date": state["date"],
        "notePath": str(state["note_path"]),
        "mitIds": state["mit_ids"],
    }


@app.post("/focus/mit")
def save_focus_mit(req: FocusMitUpdateRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    state = vault.set_daily_mit(day_iso=req.date, mit_ids=req.mit_ids, indexer=indexer)
    return {
        "saved": True,
        "date": state["date"],
        "notePath": str(state["note_path"]),
        "mitIds": state["mit_ids"],
        "counts": _counts(indexer),
    }


@app.post("/focus/quick-capture")
def quick_capture_focus_todo(req: FocusQuickCaptureRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        result = vault.add_quick_todo_to_daily(text=req.text, indexer=indexer, day_iso=req.date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "saved": True,
        "date": result["date"],
        "notePath": str(result["note_path"]),
        "todoText": result["todo_text"],
        "counts": _counts(indexer),
    }


@app.post("/daily/open-today")
def open_or_create_daily(date: str | None = None) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    state = vault.ensure_daily_note(day_iso=date, indexer=indexer)
    return {
        "date": state["date"],
        "notePath": str(state["note_path"]),
        "title": state["title"],
        "created": bool(state["created"]),
        "counts": _counts(indexer),
    }


@app.get("/focus/dashboard")
def get_focus_dashboard(date: str | None = None) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    day_iso = _normalize_iso_day_param(date)
    return _build_focus_dashboard_payload(vault=vault, indexer=indexer, day_iso=day_iso)


@app.get("/tasks")
def list_tasks(include_done: bool = False) -> dict[str, Any]:
    _vault, indexer = _require_loaded()
    return {"items": indexer.list_tasks(include_done=include_done)}


@app.get("/todos")
def list_todos() -> dict[str, Any]:
    _vault, indexer = _require_loaded()
    return {"items": indexer.list_todos()}


@app.post("/todos/{todo_id}/toggle")
def toggle_todo(todo_id: str, req: TodoToggleRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        result = vault.toggle_todo(todo_id=todo_id, indexer=indexer, checked=req.checked)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return result


@app.post("/todos/{todo_id}/promote")
def promote_todo(todo_id: str) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        result = vault.promote_todo_to_task(todo_id=todo_id, indexer=indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@app.post("/tasks/{task_id}/done")
def mark_task_done(task_id: str) -> dict[str, Any]:
    vault, indexer = _require_loaded()

    rows = [r for r in indexer.list_tasks(include_done=True) if r["id"] == task_id]
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")

    row = rows[0]
    path = row.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Task file path missing")

    src = Path(path)
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"Task file not found: {src}")

    meta, body = parse_markdown(src)
    meta["status"] = "done"
    now_iso = datetime.now().isoformat(timespec="seconds")
    meta["updated_at"] = now_iso
    # `completed_at` is the canonical completion timestamp for task done metrics.
    meta["completed_at"] = now_iso
    done_path = src
    if src.parent.name.lower() == "open":
        done_dir = src.parent.parent / "done"
        done_dir.mkdir(parents=True, exist_ok=True)
        done_path = done_dir / src.name
        suffix = 2
        while done_path.exists() and done_path != src:
            done_path = done_dir / f"{src.stem}_{suffix}{src.suffix}"
            suffix += 1
    done_path.write_text(dump_markdown(meta, body), encoding="utf-8")
    if src != done_path and src.exists():
        src.unlink()

    blocked_by_raw = meta.get("blocked_by_ids")
    blocked_by_ids: list[str] = []
    if isinstance(blocked_by_raw, list):
        iterable = [str(item) for item in blocked_by_raw]
    elif isinstance(blocked_by_raw, str):
        iterable = blocked_by_raw.split(",")
    else:
        iterable = []
    seen_blockers: set[str] = set()
    for item in iterable:
        clean = item.strip()
        if not clean:
            continue
        lowered = clean.lower()
        if lowered in seen_blockers:
            continue
        seen_blockers.add(lowered)
        blocked_by_ids.append(clean)

    parsed = ParsedTask(
        title=str(meta.get("title", row["title"])),
        due_date=str(meta.get("due_date", "")).strip() or row.get("due_date"),
        priority=str(meta.get("priority", row.get("priority", "M"))).upper()[:1] or "M",
        status="done",
        project_tag=str(meta.get("project_tag", "")).strip() or row.get("project_tag"),
        tags=[],
        estimate_minutes=row.get("estimate_minutes"),
        completed_at=str(meta.get("completed_at", "")).strip() or None,
        blocked_by_ids=blocked_by_ids,
        waiting_for=str(meta.get("waiting_for", "")).strip() or None,
        follow_up_date=str(meta.get("follow_up_date", "")).strip() or None,
        blocked_reason=str(meta.get("blocked_reason", "")).strip() or None,
        next_action_hint=str(meta.get("next_action_hint", "")).strip() or None,
    )
    indexer.add_or_update_task(
        task_id=str(task_id),
        note_id=str(meta.get("note_id", "")).strip() or None,
        path=str(done_path),
        parsed=parsed,
        created_at=str(meta.get("created_at", meta["updated_at"])),
        updated_at=str(meta["updated_at"]),
    )
    vault.sync_task_status_link(
        task_id=str(task_id),
        title=parsed.title,
        status="done",
        task_path=str(done_path),
        indexer=indexer,
    )

    return {"done": True, "taskId": task_id}


@app.get("/search")
def search_notes(query: str = "") -> dict[str, Any]:
    _vault, indexer = _require_loaded()
    return {"items": indexer.search_notes(query)}


@app.get("/explorer/files")
def explorer_files() -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    items: list[dict[str, Any]] = []

    root = vault.vault_path.resolve()
    hide_legacy_daily = (root / "daily").is_dir()
    hide_legacy_tags = (root / "tags").is_dir()
    hide_legacy_tasks = (root / "tasks").is_dir()
    hide_dot_system = (root / ".system").is_dir()
    hide_legacy_system = (root / "system").is_dir()

    text_extensions = {
        ".md",
        ".txt",
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        ".ini",
        ".cfg",
        ".csv",
        ".log",
        ".xml",
        ".html",
        ".css",
        ".js",
        ".ts",
        ".tsx",
        ".jsx",
        ".py",
        ".sh",
        ".ps1",
        ".bat",
    }

    for file_path in root.rglob("*"):
        if not file_path.is_file():
            continue
        try:
            relative = file_path.resolve().relative_to(root).as_posix()
        except ValueError:
            continue
        top = relative.split("/", 1)[0]

        if top in {".system", "system", "99_system", "02_entities", ".media"}:
            continue
        if hide_legacy_daily and top == "01_daily":
            continue
        if hide_legacy_tags and top == "02_tags":
            continue
        if hide_legacy_tasks and top == "03_tasks":
            continue
        if hide_dot_system and top == "system":
            continue
        if hide_legacy_system and top == "99_system":
            continue

        extension = file_path.suffix.lower()
        if extension and extension not in text_extensions:
            continue

        stat = file_path.stat()
        note_type = "markdown" if extension == ".md" else "text"
        items.append(
            {
                "id": f"explorer:{relative}",
                "title": file_path.stem,
                "note_type": note_type,
                "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                "path": str(file_path),
            }
        )

    items.sort(key=lambda row: (row["updated_at"], row["path"]), reverse=True)
    return {"items": items}


@app.get("/notes/content")
def read_note_content(path: str) -> dict[str, Any]:
    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    return {"path": str(file_path), "content": file_path.read_text(encoding="utf-8")}


@app.post("/notes/save")
def save_note_content(req: NoteSaveRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    file_path = Path(req.path).expanduser().resolve()
    vault_root = vault.vault_path.resolve()

    try:
        file_path.relative_to(vault_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Can only save files inside the loaded NoteBase") from exc

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail=f"Not a file: {file_path}")

    try:
        result = vault.save_note_document(req.path, req.content, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    tag_groups = vault.sync_tag_groups_with_index(indexer) if bool(result.get("tag_rebuild_required")) else None
    graph_status = _update_graph_after_note_save(
        vault=vault,
        saved_path=Path(result["path"]),
        previous_path=file_path,
        tag_groups=tag_groups,
    )
    return {
        "saved": True,
        "path": str(result["path"]),
        "title": str(result["title"]),
        "counts": _counts(indexer),
        "tagGroups": tag_groups,
        "tagGroupsRebuilt": bool(tag_groups is not None),
        "graphStatus": graph_status,
    }


@app.post("/notes/media/add")
def add_note_media_asset(req: NoteMediaAddRequest) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    try:
        payload = base64.b64decode(req.data_base64.encode("utf-8"), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail=f"Ungueltige Bilddaten: {exc}") from exc

    try:
        result = vault.add_note_media_asset(
            note_path=req.path,
            filename=req.file_name or "image",
            content_type=req.content_type or "",
            data=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "mediaPath": result["media_path"],
        "markdownPath": result["markdown_path"],
        "fileName": result["file_name"],
    }


@app.get("/notes/media/content")
def get_note_media_content(path: str, source: str) -> FileResponse:
    vault, _indexer = _require_loaded()
    try:
        asset_path, mime_type = vault.resolve_note_media_asset(note_path=path, source=source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(path=asset_path, media_type=mime_type, filename=asset_path.name)


@app.post("/notes/open")
def open_note_file(req: NoteOpenRequest) -> dict[str, Any]:
    file_path = Path(req.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    try:
        if sys.platform.startswith("win"):
            os.startfile(str(file_path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.run(["open", str(file_path)], check=False)
        else:
            subprocess.run(["xdg-open", str(file_path)], check=False)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not open file: {exc}") from exc

    return {"opened": True, "path": str(file_path)}


@app.get("/review")
def get_review() -> dict[str, Any]:
    _vault, indexer = _require_loaded()
    today = date.today()
    return {
        "daily": indexer.daily_summary(today),
        "weekly": indexer.weekly_summary(today),
    }


@app.get("/review/dashboard")
def get_review_dashboard(days: int = 30, day: str | None = None, top: int = 8) -> dict[str, Any]:
    _vault, indexer = _require_loaded()
    day_iso = _normalize_iso_day_param(day)
    try:
        end_day = datetime.fromisoformat(day_iso).date()
    except ValueError:
        end_day = date.today()

    safe_days = max(1, min(int(days), 120))
    safe_top = max(3, min(int(top), 20))
    return indexer.review_dashboard(end_day=end_day, window_days=safe_days, top_notes_limit=safe_top)


@app.get("/ui-settings")
def get_ui_settings() -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"settings": vault.read_ui_settings()}


@app.post("/ui-settings")
def update_ui_settings(req: UiSettingsUpdateRequest) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    settings = vault.update_ui_settings(app_settings=req.app, explorer_settings=req.explorer)
    return {"settings": settings}


@app.get("/tag-groups")
def get_tag_groups() -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"groups": vault.read_tag_groups()}


@app.get("/graph-index")
def get_graph_index() -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"index": read_graph_index(vault.graph_index_path).to_dict()}


@app.get("/graph-index/status")
def get_graph_index_status() -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return _graph_index_status(vault)


@app.post("/graph-index/rebuild")
def rebuild_graph_index() -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    state.graph_status.is_updating = True
    state.graph_status.last_error = None
    try:
        index = build_graph_index(vault_path=vault.vault_path, tag_groups=vault.read_tag_groups())
        write_graph_index(vault.graph_index_path, index)
        return {"index": index.to_dict(), "status": _graph_index_status(vault, index)}
    except Exception as exc:
        state.graph_status.last_error = str(exc)
        logger.exception("Graph index rebuild failed.")
        raise
    finally:
        state.graph_status.is_updating = False


def _update_graph_after_note_save(
    *,
    vault: VaultManager,
    saved_path: Path,
    previous_path: Path,
    tag_groups: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    state.graph_status.is_updating = True
    state.graph_status.last_error = None
    try:
        groups = tag_groups if tag_groups is not None else vault.read_tag_groups()
        if not vault.graph_index_path.exists():
            index = build_graph_index(vault_path=vault.vault_path, tag_groups=groups)
        else:
            index = read_graph_index(vault.graph_index_path)
            if _graph_index_needs_rebuild(index):
                index = build_graph_index(vault_path=vault.vault_path, tag_groups=groups)
            else:
                index = update_graph_index_for_file(
                    vault_path=vault.vault_path,
                    tag_groups=groups,
                    index=index,
                    file_path=saved_path,
                    previous_path=previous_path if previous_path.resolve() != saved_path.resolve() else None,
                )
        write_graph_index(vault.graph_index_path, index)
        return _graph_index_status(vault, index)
    except Exception as exc:
        state.graph_status.last_error = str(exc)
        logger.exception("Incremental graph update failed.")
        return _graph_index_status(vault)
    finally:
        state.graph_status.is_updating = False


def _graph_index_needs_rebuild(index: GraphIndex) -> bool:
    return any(item.type == "graphIndexReadFailed" for item in index.diagnostics)


def _graph_index_status(vault: VaultManager, index: GraphIndex | None = None) -> dict[str, Any]:
    loaded = index if index is not None else read_graph_index(vault.graph_index_path)
    read_failed = _graph_index_needs_rebuild(loaded)
    return {
        "available": vault.graph_index_path.exists() and not read_failed,
        "updated_at": loaded.updated_at or None,
        "node_count": len(loaded.nodes),
        "edge_count": len(loaded.edges),
        "diagnostic_count": len(loaded.diagnostics),
        "is_updating": state.graph_status.is_updating,
        "last_error": state.graph_status.last_error,
    }


@app.get("/graph-state")
def get_graph_state() -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"state": read_graph_state(vault.graph_state_path)}


@app.put("/graph-state")
def update_graph_state(state_payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"state": write_graph_state(vault.graph_state_path, state_payload)}


@app.get("/tags/overview")
def get_tag_overview(groupId: str, tagId: str) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        result = vault.resolve_tag_overview_note(group_id=groupId, tag_id=tagId, indexer=indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "path": str(result["path"]),
        "title": str(result["title"]),
    }


@app.post("/tag-groups/add-group")
def add_tag_group(req: TagGroupRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    groups = vault.add_tag_group(req.group_id, req.display_name, req.color, indexer)
    return {"groups": groups}


@app.post("/tag-groups/add-tag")
def add_tag(req: TagCreateRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    groups = vault.add_tag_to_group(req.group_id, req.tag_id, req.display_name, indexer)
    return {"groups": groups}


@app.post("/tag-groups/rename-group")
def rename_tag_group(req: TagGroupRenameRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        groups, touched = vault.rename_tag_group(
            group_id=req.group_id,
            new_group_id=req.new_group_id,
            new_display_name=req.new_display_name,
            new_color=req.new_color,
            apply_to_notes=req.apply_to_notes,
            indexer=indexer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer)}


@app.post("/tag-groups/delete-group")
def delete_tag_group(req: TagGroupDeleteRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        groups, touched = vault.delete_tag_group(
            group_id=req.group_id,
            remove_from_notes=req.remove_from_notes,
            indexer=indexer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer)}


@app.post("/tag-groups/rename-tag")
def rename_tag(req: TagRenameRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        groups, touched = vault.rename_tag(
            group_id=req.group_id,
            tag_id=req.tag_id,
            new_tag_id=req.new_tag_id,
            new_display_name=req.new_display_name,
            apply_to_notes=req.apply_to_notes,
            indexer=indexer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer)}


@app.post("/tag-groups/move-tag")
def move_tag(req: TagMoveRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        groups, touched = vault.move_tag(
            from_group=req.from_group,
            tag_name=req.tag_id,
            to_group=req.to_group,
            apply_to_notes=req.apply_to_notes,
            indexer=indexer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer)}


@app.post("/tag-groups/delete-tag")
def delete_tag(req: TagDeleteRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        groups, touched = vault.delete_tag(
            group_id=req.group_id,
            tag_id=req.tag_id,
            remove_from_notes=req.remove_from_notes,
            indexer=indexer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"groups": groups, "notesUpdated": touched, "counts": _counts(indexer)}


@app.get("/note-groups")
def get_note_groups() -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    return {"groups": vault.list_note_groups()}


@app.post("/note-groups/add-group")
def add_note_group(req: NoteGroupCreateRequest) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    try:
        created = vault.create_note_group(req.group_name, req.parent_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"group": created, "groups": vault.list_note_groups()}


@app.post("/note-groups/rename")
def rename_note_group(req: NoteGroupRenameRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        renamed = vault.rename_note_group(req.group_key, req.new_name, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"group": renamed, "groups": vault.list_note_groups(), "counts": _counts(indexer)}


@app.post("/note-groups/delete")
def delete_note_group(req: NoteGroupDeleteRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        vault.delete_note_group(req.group_key, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"deleted": True, "groups": vault.list_note_groups(), "counts": _counts(indexer)}


@app.post("/note-groups/move")
def move_note_group(req: NoteGroupMoveRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        moved = vault.move_note_group(req.group_key, req.target_parent_key, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"group": moved, "groups": vault.list_note_groups(), "counts": _counts(indexer)}


@app.post("/note-groups/favorite")
def favorite_note_group(req: FavoriteFolderRequest) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    try:
        favorites = vault.add_favorite_folder(req.group_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"favorites": favorites, "groups": vault.list_note_groups()}


@app.post("/note-groups/unfavorite")
def unfavorite_note_group(req: FavoriteFolderRequest) -> dict[str, Any]:
    vault, _indexer = _require_loaded()
    try:
        favorites = vault.remove_favorite_folder(req.group_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"favorites": favorites, "groups": vault.list_note_groups()}


@app.post("/note-groups/add-note")
def add_note(req: NoteCreateRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        created = vault.create_note_in_group(
            group_key=req.group_key,
            title=req.title,
            indexer=indexer,
            note_type=req.note_type,
            status=req.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "noteId": created["note_id"],
        "notePath": str(created["note_path"]),
        "title": str(created.get("title", "")),
        "noteType": req.note_type,
        "groups": vault.list_note_groups(),
        "counts": _counts(indexer),
    }


@app.post("/notes/rename")
def rename_note(req: NoteFileRenameRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        renamed_path = vault.rename_note_file(req.path, req.new_name, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"renamedPath": str(renamed_path), "counts": _counts(indexer)}


@app.post("/notes/delete")
def delete_note(req: NoteFileDeleteRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        vault.delete_note_file(req.path, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"deleted": True, "counts": _counts(indexer)}


@app.post("/notes/move")
def move_note(req: NoteFileMoveRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        moved_path = vault.move_note_file(req.path, req.target_group_key, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"movedPath": str(moved_path), "counts": _counts(indexer)}


@app.post("/notes/move-batch")
def move_notes_batch(req: NoteFileMoveBatchRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()
    try:
        moved_paths = vault.move_note_files(req.paths, req.target_group_key, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"movedPaths": moved_paths, "counts": _counts(indexer)}


@app.post("/notes/migrate-templates")
def migrate_note_templates() -> dict[str, Any]:
    vault, indexer = _require_loaded()
    result = vault.migrate_note_templates(indexer)
    tag_groups = vault.sync_tag_groups_with_index(indexer)
    return {
        "updated": int(result.get("updated", 0)),
        "paths": result.get("paths", []),
        "counts": _counts(indexer),
        "tagGroups": tag_groups,
    }


@app.on_event("shutdown")
def on_shutdown() -> None:
    state.close()


def _require_loaded() -> tuple[VaultManager, VaultIndexer]:
    if not state.vault or not state.indexer:
        raise HTTPException(status_code=400, detail="No NoteBase loaded")
    return state.vault, state.indexer


def _compute_capture(text: str, vault: VaultManager, indexer: VaultIndexer) -> tuple[list[TagSuggestion], list[str]]:
    clean_text = text.strip()
    if not clean_text:
        return [], []

    known_tags = _known_tags_for_capture(vault, indexer)
    parsed = state.parser.parse(clean_text, known_tags)
    merged = parsed.merged_suggestions()
    todo_candidates = state.parser.parse_todos(clean_text)

    if state.openai and state.openai.cfg.enabled:
        ai_suggestions = state.openai.suggest_tags(clean_text, known_tags)
        merged = _merge_suggestions(merged, ai_suggestions)

    return merged, todo_candidates


def _known_tags_for_capture(vault: VaultManager, indexer: VaultIndexer) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, str]] = {}

    def add_tag(category: str, slug: str, display_name: str) -> None:
        clean_category = str(category or "").strip().lower()
        clean_slug = str(slug or "").strip().lower()
        clean_display = str(display_name or "").strip() or clean_slug
        if not clean_category or not clean_slug:
            return
        key = f"{clean_category}:{clean_slug}"
        if key not in by_key:
            by_key[key] = {
                "category": clean_category,
                "slug": clean_slug,
                "display_name": clean_display,
            }
            return
        if clean_display:
            by_key[key]["display_name"] = clean_display

    for row in indexer.get_all_tags():
        add_tag(
            category=str(row.get("category", "")),
            slug=str(row.get("slug", "")),
            display_name=str(row.get("display_name", "")),
        )

    for group in vault.read_tag_groups():
        group_id = str(group.get("id", "")).strip()
        tags = group.get("tags", [])
        if not isinstance(tags, list):
            continue
        for tag in tags:
            if not isinstance(tag, dict):
                continue
            add_tag(
                category=group_id,
                slug=str(tag.get("id", "")).strip(),
                display_name=str(tag.get("displayName", "")).strip() or str(tag.get("id", "")).strip(),
            )

    return sorted(by_key.values(), key=lambda item: (item["category"], item["display_name"], item["slug"]))


def _normalize_todo_selection(selected: list[str], fallback: list[str]) -> list[str]:
    source = selected if selected else fallback
    clean: list[str] = []
    seen: set[str] = set()
    for raw_item in source:
        value = " ".join(str(raw_item or "").strip().split())
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        clean.append(value)
    return clean


def _merge_suggestions(base: list[TagSuggestion], extra: list[TagSuggestion]) -> list[TagSuggestion]:
    by_key = {item.key: item for item in base}
    for item in extra:
        current = by_key.get(item.key)
        if not current or item.confidence > current.confidence:
            by_key[item.key] = item
    return sorted(by_key.values(), key=lambda item: (-item.confidence, item.key))


def _tag_payload(item: TagSuggestion) -> dict[str, Any]:
    return {
        "key": item.key,
        "category": item.category,
        "slug": item.slug,
        "displayName": item.display_name,
        "confidence": round(item.confidence, 4),
        "source": item.source,
        "autoApply": item.auto_apply,
    }


def _task_payload(item: ParsedTask) -> dict[str, Any]:
    return {
        "title": item.title,
        "dueDate": item.due_date,
        "priority": item.priority,
        "status": item.status,
        "projectTag": item.project_tag,
        "tags": item.tags,
        "estimateMinutes": item.estimate_minutes,
        "completedAt": item.completed_at,
        "blockedByIds": item.blocked_by_ids,
        "waitingFor": item.waiting_for,
        "followUpDate": item.follow_up_date,
        "blockedReason": item.blocked_reason,
        "nextActionHint": item.next_action_hint,
    }


def _counts(indexer: VaultIndexer) -> dict[str, int]:
    cur = indexer.conn.cursor()
    cur.execute("SELECT COUNT(*) AS cnt FROM notes;")
    notes = int(cur.fetchone()["cnt"])
    cur.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE status <> 'done';")
    open_tasks = int(cur.fetchone()["cnt"])
    cur.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'done';")
    done_tasks = int(cur.fetchone()["cnt"])
    return {
        "notes": notes,
        "openTasks": open_tasks,
        "doneTasks": done_tasks,
    }


def _normalize_iso_day_param(raw: str | None) -> str:
    clean = (raw or "").strip()
    if len(clean) >= 10:
        candidate = clean[:10]
        try:
            datetime.fromisoformat(candidate)
            return candidate
        except ValueError:
            pass
    return date.today().isoformat()


def _to_iso_day(value: Any) -> str:
    clean = str(value or "").strip()
    if not clean:
        return ""
    candidate = clean[:10]
    try:
        datetime.fromisoformat(candidate)
    except ValueError:
        return ""
    return candidate


def _compute_done_today_counts(tasks: list[dict[str, Any]], todos: list[dict[str, Any]], day_iso: str) -> tuple[int, int]:
    done_tasks = 0
    for task in tasks:
        status = str(task.get("status", "")).strip().lower().replace("-", "_")
        if status != "done":
            continue
        completed_day = _to_iso_day(task.get("completed_at"))
        updated_day = _to_iso_day(task.get("updated_at"))
        # Transitional fallback for legacy items without completed_at.
        effective_day = completed_day or updated_day
        if effective_day == day_iso:
            done_tasks += 1

    done_todos = 0
    for todo in todos:
        if not bool(todo.get("checked")):
            continue
        completed_day = _to_iso_day(todo.get("completed_at"))
        updated_day = _to_iso_day(todo.get("updated_at"))
        # Transitional fallback for legacy items without completed_at.
        effective_day = completed_day or updated_day
        if effective_day == day_iso:
            done_todos += 1

    return done_tasks, done_todos


def _to_blocked_by_ids(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = [str(item).strip() for item in raw]
    elif isinstance(raw, str):
        values = [item.strip() for item in raw.split(",")]
    else:
        values = []
    seen: set[str] = set()
    normalized: list[str] = []
    for value in values:
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(value)
    return normalized


def _to_estimate_minutes(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return value


def _is_task_blocked(task: dict[str, Any], status_by_id: dict[str, str]) -> bool:
    status = str(task.get("status", "")).strip().lower().replace("-", "_")
    if status == "done":
        return False

    waiting_for = str(task.get("waiting_for", "")).strip()
    if waiting_for:
        return True

    blocked_by_ids = _to_blocked_by_ids(task.get("blocked_by_ids"))
    for blocker_id in blocked_by_ids:
        blocker_status = status_by_id.get(blocker_id.lower())
        if not blocker_status:
            return True
        normalized_blocker_status = blocker_status.strip().lower().replace("-", "_")
        if normalized_blocker_status != "done":
            return True
    return False


def _compute_focus_stats(tasks: list[dict[str, Any]], todos: list[dict[str, Any]], day_iso: str) -> dict[str, int]:
    status_by_id = {str(task.get("id", "")).strip().lower(): str(task.get("status", "")) for task in tasks if task.get("id")}
    overdue_count = 0
    blocked_count = 0
    waiting_count = 0
    open_tasks_without_estimate_count = 0
    waiting_without_follow_up_count = 0
    unknown_blocker_task_count = 0
    unknown_blocker_reference_count = 0
    for task in tasks:
        status = str(task.get("status", "")).strip().lower().replace("-", "_")
        if status == "done":
            continue
        if _to_estimate_minutes(task.get("estimate_minutes")) is None:
            open_tasks_without_estimate_count += 1
        due_date = str(task.get("due_date", "")).strip()
        if len(due_date) >= 10:
            due_iso = due_date[:10]
            if due_iso < day_iso:
                overdue_count += 1
        waiting_for = str(task.get("waiting_for", "")).strip()
        follow_up_day = _to_iso_day(task.get("follow_up_date"))
        if waiting_for:
            waiting_count += 1
            if not follow_up_day:
                waiting_without_follow_up_count += 1
        blocked_by_ids = _to_blocked_by_ids(task.get("blocked_by_ids"))
        unknown_refs_for_task = 0
        for blocker_id in blocked_by_ids:
            if blocker_id.lower() not in status_by_id:
                unknown_refs_for_task += 1
        if unknown_refs_for_task > 0:
            unknown_blocker_task_count += 1
            unknown_blocker_reference_count += unknown_refs_for_task
        if _is_task_blocked(task, status_by_id):
            blocked_count += 1

    done_today_tasks, done_today_todos = _compute_done_today_counts(tasks, todos, day_iso)

    return {
        "overdueCount": overdue_count,
        "blockedCount": blocked_count,
        "waitingCount": waiting_count,
        "doneToday": done_today_tasks + done_today_todos,
        "doneTodayTasks": done_today_tasks,
        "doneTodayTodos": done_today_todos,
        "openTasksWithoutEstimateCount": open_tasks_without_estimate_count,
        "waitingWithoutFollowUpCount": waiting_without_follow_up_count,
        "unknownBlockerTaskCount": unknown_blocker_task_count,
        "unknownBlockerReferenceCount": unknown_blocker_reference_count,
    }


def _build_focus_dashboard_payload(vault: VaultManager, indexer: VaultIndexer, day_iso: str) -> dict[str, Any]:
    tasks = indexer.list_tasks(include_done=True)
    todos = indexer.list_todos()
    notes = indexer.search_notes(query="", limit=500)
    mit_state = vault.get_daily_mit(day_iso=day_iso)
    return {
        "date": day_iso,
        "tasks": tasks,
        "todos": todos,
        "notes": notes,
        "mitIds": mit_state.get("mit_ids", []),
        "mitNotePath": str(mit_state.get("note_path", "")),
        "stats": _compute_focus_stats(tasks=tasks, todos=todos, day_iso=day_iso),
        "counts": _counts(indexer),
    }
