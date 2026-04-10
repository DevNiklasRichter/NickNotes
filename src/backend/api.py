from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .nicknotes_backend.ai_client import OpenAIConfig, OpenAISuggester
from .nicknotes_backend.indexer import VaultIndexer
from .nicknotes_backend.markdown_io import dump_markdown, parse_markdown
from .nicknotes_backend.models import ParsedTask, TagSuggestion
from .nicknotes_backend.parser import CaptureParser
from .nicknotes_backend.vault import VaultManager


@dataclass
class RuntimeState:
    vault: VaultManager | None = None
    indexer: VaultIndexer | None = None
    parser: CaptureParser = field(default_factory=CaptureParser)
    openai: OpenAISuggester | None = None

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


class NoteOpenRequest(BaseModel):
    path: str


class NoteSaveRequest(BaseModel):
    path: str
    content: str


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


class FavoriteFolderRequest(BaseModel):
    group_key: str = Field(alias="groupKey")


class UiSettingsUpdateRequest(BaseModel):
    app: dict[str, Any] | None = None
    explorer: dict[str, Any] | None = None


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
    _vault, indexer = _require_loaded()
    merged, parsed_tasks = _compute_capture(req.text, indexer)
    auto_count = sum(1 for item in merged if item.auto_apply or item.source == "explicit")
    return {
        "suggestions": [_tag_payload(item) for item in merged],
        "tasks": [_task_payload(item) for item in parsed_tasks],
        "stats": {
            "tags": len(merged),
            "tasks": len(parsed_tasks),
            "auto": auto_count,
        },
    }


@app.post("/capture/save")
def save_capture(req: CaptureSaveRequest) -> dict[str, Any]:
    vault, indexer = _require_loaded()

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Capture text is empty")

    merged, parsed_tasks = _compute_capture(text, indexer)
    selected_keys = set(req.selected_tag_keys)
    selected_tags = [tag for tag in merged if tag.key in selected_keys]

    result = vault.save_capture(
        text=text,
        selected_tags=selected_tags,
        tasks=parsed_tasks,
        indexer=indexer,
    )

    return {
        "saved": True,
        "noteId": result["note_id"],
        "notePath": str(result["note_path"]),
        "taskIds": result["task_ids"],
        "counts": _counts(indexer),
    }


@app.get("/tasks")
def list_tasks(include_done: bool = False) -> dict[str, Any]:
    _vault, indexer = _require_loaded()
    return {"items": indexer.list_tasks(include_done=include_done)}


@app.post("/tasks/{task_id}/done")
def mark_task_done(task_id: str) -> dict[str, Any]:
    _vault, indexer = _require_loaded()

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
    meta["updated_at"] = datetime.now().isoformat(timespec="seconds")
    done_path = src.parents[1] / "done" / src.name
    done_path.write_text(dump_markdown(meta, body), encoding="utf-8")
    if src != done_path and src.exists():
        src.unlink()

    parsed = ParsedTask(
        title=str(row["title"]),
        due_date=row.get("due_date"),
        priority=str(row.get("priority", "M")),
        status="done",
        project_tag=row.get("project_tag"),
        tags=[],
    )
    indexer.add_or_update_task(
        task_id=str(task_id),
        note_id=None,
        path=str(done_path),
        parsed=parsed,
        created_at=str(meta.get("created_at", meta["updated_at"])),
        updated_at=str(meta["updated_at"]),
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

        if top in {".system", "system", "99_system", "02_entities"}:
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

    file_path.write_text(req.content, encoding="utf-8")
    indexed = indexer.reindex_vault(vault_root)
    tag_groups = vault.sync_tag_groups_with_index(indexer)
    return {
        "saved": True,
        "path": str(file_path),
        "indexed": indexed,
        "counts": _counts(indexer),
        "tagGroups": tag_groups,
    }


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
        created = vault.create_note_in_group(req.group_key, req.title, indexer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "noteId": created["note_id"],
        "notePath": str(created["note_path"]),
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


@app.on_event("shutdown")
def on_shutdown() -> None:
    state.close()


def _require_loaded() -> tuple[VaultManager, VaultIndexer]:
    if not state.vault or not state.indexer:
        raise HTTPException(status_code=400, detail="No NoteBase loaded")
    return state.vault, state.indexer


def _compute_capture(text: str, indexer: VaultIndexer) -> tuple[list[TagSuggestion], list[ParsedTask]]:
    clean_text = text.strip()
    if not clean_text:
        return [], []

    known_tags = indexer.get_all_tags()
    parsed = state.parser.parse(clean_text, known_tags)
    merged = parsed.merged_suggestions()

    if state.openai and state.openai.cfg.enabled:
        ai_suggestions = state.openai.suggest_tags(clean_text, known_tags)
        merged = _merge_suggestions(merged, ai_suggestions)

    return merged, parsed.parsed_tasks


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
