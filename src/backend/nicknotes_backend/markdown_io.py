from __future__ import annotations

from pathlib import Path
from typing import Any


def dump_markdown(frontmatter: dict[str, Any], body: str) -> str:
    lines: list[str] = ["---"]
    for key, value in frontmatter.items():
        if isinstance(value, list):
            lines.append(f"{key}:")
            for item in value:
                lines.append(f"  - {item}")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    lines.append("")
    lines.append(body.rstrip())
    lines.append("")
    return "\n".join(lines)


def parse_markdown_text(text: str) -> tuple[dict[str, Any], str]:
    normalized_text = text.lstrip("\ufeff")
    if not normalized_text.startswith("---\n"):
        return {}, normalized_text

    lines = normalized_text.splitlines()
    frontmatter: dict[str, Any] = {}
    current_list_key: str | None = None
    end_idx = None

    for idx in range(1, len(lines)):
        line = lines[idx]
        if line.strip() == "---":
            end_idx = idx
            break

        if line.startswith("  - ") and current_list_key:
            frontmatter.setdefault(current_list_key, []).append(line[4:].strip())
            continue

        if ":" in line:
            key, raw_value = line.split(":", 1)
            key = key.strip()
            raw_value = raw_value.strip()
            if raw_value == "":
                frontmatter[key] = []
                current_list_key = key
            else:
                frontmatter[key] = raw_value
                current_list_key = None

    if end_idx is None:
        return {}, normalized_text

    body = "\n".join(lines[end_idx + 1 :]).lstrip("\n")
    return frontmatter, body


def parse_markdown(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    return parse_markdown_text(text)
