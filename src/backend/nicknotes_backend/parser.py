from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher, get_close_matches

from .models import ParsedTask, TAG_CATEGORIES, TagSuggestion
from .task_domain import normalize_tag_id, normalize_task_priority, normalize_task_status


TAG_PATTERN = re.compile(
    r"\b([a-zA-Z][a-zA-Z0-9_-]{1,60}):([a-zA-Z0-9][a-zA-Z0-9_-]{1,80})\b",
    flags=re.IGNORECASE,
)
TODO_PATTERN = re.compile(r"^\s*todo:\s*(.+)$", flags=re.IGNORECASE)
WORD_PATTERN = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_\-]{2,}")

@dataclass
class CaptureParseResult:
    explicit_tags: list[TagSuggestion]
    suggested_tags: list[TagSuggestion]
    parsed_tasks: list[ParsedTask]

    def merged_suggestions(self) -> list[TagSuggestion]:
        seen = set()
        merged: list[TagSuggestion] = []
        for item in self.explicit_tags + self.suggested_tags:
            if item.key in seen:
                continue
            seen.add(item.key)
            merged.append(item)
        return merged


class CaptureParser:
    def parse(self, text: str, known_tags: list[dict]) -> CaptureParseResult:
        explicit = self.parse_explicit_tags(text)
        suggested = self.suggest_tags(text, known_tags, existing=explicit)
        tasks = self.parse_tasks(text)
        return CaptureParseResult(explicit_tags=explicit, suggested_tags=suggested, parsed_tasks=tasks)

    def parse_explicit_tags(self, text: str) -> list[TagSuggestion]:
        found: dict[str, TagSuggestion] = {}
        for match in TAG_PATTERN.finditer(text):
            category = normalize_tag_id(match.group(1))
            slug = normalize_tag_id(match.group(2))
            if not category or not slug:
                continue
            key = f"{category}:{slug}"
            found[key] = TagSuggestion(
                category=category,
                slug=slug,
                display_name=slug,
                confidence=1.0,
                source="explicit",
                auto_apply=True,
            )
        return sorted(found.values(), key=lambda x: x.key)

    def suggest_tags(
        self,
        text: str,
        known_tags: list[dict],
        existing: list[TagSuggestion] | None = None,
    ) -> list[TagSuggestion]:
        existing_keys = {item.key for item in (existing or [])}
        tokens = [token.lower() for token in WORD_PATTERN.findall(text)]
        if not tokens or not known_tags:
            return []

        suggestions: dict[str, TagSuggestion] = {}
        token_set = set(tokens)
        for tag in known_tags:
            category = tag["category"]
            slug = tag["slug"]
            display_name = tag.get("display_name") or slug
            key = f"{category}:{slug}"
            if key in existing_keys:
                continue

            slug_text = slug.lower()
            name_text = display_name.lower()
            confidence = 0.0
            source = "context"

            for token in token_set:
                if token in slug_text or token in name_text:
                    confidence = max(confidence, 0.9 if len(token) > 4 else 0.84)
                ratio_slug = SequenceMatcher(a=token, b=slug_text).ratio()
                ratio_name = SequenceMatcher(a=token, b=name_text).ratio()
                confidence = max(confidence, ratio_slug * 0.92, ratio_name * 0.88)

            close = get_close_matches(slug_text, token_set, n=1, cutoff=0.78)
            if close:
                confidence = max(confidence, 0.83)
                source = "fuzzy"

            if confidence < 0.72:
                continue

            suggestions[key] = TagSuggestion(
                category=category,
                slug=slug,
                display_name=display_name,
                confidence=min(confidence, 0.99),
                source=source,
                auto_apply=confidence >= 0.9,
            )

        return sorted(suggestions.values(), key=lambda x: (-x.confidence, x.key))

    def parse_tasks(self, text: str) -> list[ParsedTask]:
        tasks: list[ParsedTask] = []
        for line in text.splitlines():
            match = TODO_PATTERN.match(line)
            if not match:
                continue

            payload = match.group(1).strip()
            if not payload:
                continue

            parts = [part.strip() for part in payload.split("|")]
            title = parts[0]
            if not title:
                continue

            task = ParsedTask(title=title)
            for raw_meta in parts[1:]:
                if ":" not in raw_meta:
                    continue
                key, value = raw_meta.split(":", 1)
                key = key.strip().lower()
                value = value.strip()
                if not value:
                    continue

                if key == "due":
                    task.due_date = value
                elif key in {"prio", "priority"}:
                    task.priority = normalize_task_priority(value)
                elif key == "status":
                    task.status = normalize_task_status(value)
                elif key == "project":
                    task.project_tag = normalize_tag_id(value)
                    task.tags.append(f"project:{task.project_tag}")
                elif key in TAG_CATEGORIES:
                    task.tags.append(f"{key}:{normalize_tag_id(value)}")

            tasks.append(task)
        return tasks

def make_note_id(now: datetime | None = None) -> str:
    now = now or datetime.now()
    return f"nt_{now:%Y%m%d_%H%M%S}_{secrets.token_hex(2)}"


def make_task_id(now: datetime | None = None) -> str:
    now = now or datetime.now()
    return f"tk_{now:%Y%m%d_%H%M%S}_{secrets.token_hex(2)}"
