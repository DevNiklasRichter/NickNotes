from __future__ import annotations

import os
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


class CapturePreviewRequest(BaseModel):
    text: str


class CaptureSaveRequest(BaseModel):
    text: str
    selected_tag_keys: list[str] = Field(default_factory=list, alias="selectedTagKeys")


class NoteOpenRequest(BaseModel):
    path: str


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
        "counts": _counts(state.indexer),
    }


@app.post("/vault/open")
def open_vault(req: VaultOpenRequest) -> dict[str, Any]:
    vault_path = Path(req.path).expanduser().resolve()
    if not vault_path.exists():
        raise HTTPException(status_code=400, detail=f"Vault path not found: {vault_path}")

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
    state.vault = vault
    state.indexer = indexer
    state.openai = openai

    return {
        "vaultPath": str(vault_path),
        "indexed": indexed,
        "mode": "smart" if smart_enabled else "core",
        "counts": _counts(indexer),
    }


@app.post("/vault/create")
def create_vault(req: VaultCreateRequest) -> dict[str, Any]:
    parent = Path(req.parent_path).expanduser().resolve()
    if not parent.exists() or not parent.is_dir():
        raise HTTPException(status_code=400, detail=f"Parent path not found: {parent}")

    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Vault name cannot be empty")

    vault_path = parent / name
    vault_path.mkdir(parents=True, exist_ok=True)
    return open_vault(VaultOpenRequest(path=str(vault_path)))


@app.post("/vault/reindex")
def reindex_vault() -> dict[str, Any]:
    vault, indexer = _require_loaded()
    indexed = indexer.reindex_vault(vault.vault_path)
    return {"indexed": indexed, "counts": _counts(indexer)}


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


@app.get("/notes/content")
def read_note_content(path: str) -> dict[str, Any]:
    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    return {"path": str(file_path), "content": file_path.read_text(encoding="utf-8")}


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


@app.on_event("shutdown")
def on_shutdown() -> None:
    state.close()


def _require_loaded() -> tuple[VaultManager, VaultIndexer]:
    if not state.vault or not state.indexer:
        raise HTTPException(status_code=400, detail="No vault loaded")
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
