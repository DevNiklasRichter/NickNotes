from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


TAG_CATEGORIES = ["person", "project", "customer", "machine_no", "machine_type"]


@dataclass(frozen=True)
class TagRef:
    category: str
    slug: str
    display_name: str

    @property
    def key(self) -> str:
        return f"{self.category}:{self.slug}"


@dataclass(frozen=True)
class TagSuggestion:
    category: str
    slug: str
    display_name: str
    confidence: float
    source: str
    auto_apply: bool = False

    @property
    def key(self) -> str:
        return f"{self.category}:{self.slug}"


@dataclass
class ParsedTask:
    title: str
    due_date: Optional[str] = None
    priority: str = "M"
    status: str = "open"
    project_tag: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    estimate_minutes: Optional[int] = None
    completed_at: Optional[str] = None
    blocked_by_ids: list[str] = field(default_factory=list)
    waiting_for: Optional[str] = None
    follow_up_date: Optional[str] = None
    blocked_reason: Optional[str] = None
    next_action_hint: Optional[str] = None
    repeat: Optional[str] = None
    remind_at: Optional[str] = None
