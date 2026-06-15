from __future__ import annotations

import re


TASK_STATUSES = ("new_topic", "open", "in_progress", "on_hold", "done")
TASK_PRIORITIES = ("low", "medium", "high")


def slugify(value: str) -> str:
    value = str(value or "").strip().lower()
    value = re.sub(r"[^a-z0-9_-]+", "_", value)
    value = re.sub(r"_+", "_", value)
    return value.strip("_")


def normalize_tag_id(value: str) -> str:
    value = str(value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def normalize_tag_key(raw: str) -> str:
    clean = str(raw or "").strip().replace("{tag:", "").replace("}", "")
    clean = clean.lstrip("#")
    if not clean:
        return ""
    if ":" in clean:
        group_raw, tag_raw = clean.split(":", 1)
        group = normalize_tag_id(group_raw)
        tag = normalize_tag_id(tag_raw)
        return f"{group}:{tag}" if group and tag else ""
    if "/" in clean:
        group_raw, tag_raw = clean.split("/", 1)
        group = normalize_tag_id(group_raw)
        tag = normalize_tag_id(tag_raw)
        return f"{group}:{tag}" if group and tag else ""
    topic = normalize_tag_id(clean)
    return f"topic:{topic}" if topic else ""


def normalize_task_status(raw: str) -> str:
    clean = str(raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    return clean if clean in TASK_STATUSES else "open"


def normalize_task_priority(raw: str) -> str:
    clean = str(raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    if clean in {"h", "high"}:
        return "high"
    if clean in {"m", "medium"}:
        return "medium"
    if clean in {"l", "low"}:
        return "low"
    return clean if clean in TASK_PRIORITIES else "medium"


def task_status_folder_token(raw: str) -> str:
    clean = str(raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    clean = re.sub(r"[^a-z0-9_]+", "_", clean)
    clean = re.sub(r"_+", "_", clean).strip("_")
    return clean or "open"

