from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from .markdown_io import dump_markdown
from .parser import make_note_id, slugify
from .vault import VaultManager


SUPPORTED_PAGE_EXTENSIONS = {".html", ".htm", ".mht", ".mhtml", ".md", ".markdown", ".txt"}
UNSUPPORTED_ONENOTE_EXTENSIONS = {".one", ".onepkg", ".onetoc2"}
MEDIA_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".avif",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
}


@dataclass
class ImportPage:
    source_path: Path
    notebook: str
    section_parts: list[str]
    title: str
    extension: str


@dataclass
class ImportPreview:
    sources: list[str]
    notebooks: int = 0
    sections: int = 0
    pages: int = 0
    media_candidates: int = 0
    unsupported_files: int = 0
    warnings: list[str] = field(default_factory=list)
    pages_preview: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "sources": self.sources,
            "notebooks": self.notebooks,
            "sections": self.sections,
            "pages": self.pages,
            "mediaCandidates": self.media_candidates,
            "unsupportedFiles": self.unsupported_files,
            "warnings": self.warnings,
            "pagesPreview": self.pages_preview,
        }


@dataclass
class ImportResult:
    imported_pages: int = 0
    skipped_pages: int = 0
    media_files: int = 0
    warnings: list[str] = field(default_factory=list)
    created_notes: list[str] = field(default_factory=list)
    report_path: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "importedPages": self.imported_pages,
            "skippedPages": self.skipped_pages,
            "mediaFiles": self.media_files,
            "warnings": self.warnings,
            "createdNotes": self.created_notes,
            "reportPath": self.report_path,
        }


class OneNoteLocalImporter:
    def __init__(self, vault: VaultManager):
        self.vault = vault

    def preview(self, source_paths: list[str]) -> dict[str, Any]:
        clean_sources = self._resolve_source_paths(source_paths)
        pages, warnings, unsupported_count = self._discover_pages(clean_sources)
        notebooks = {page.notebook for page in pages}
        sections = {"/".join([page.notebook, *page.section_parts]) for page in pages}
        media_candidates = self._count_media_candidates(clean_sources)
        preview = ImportPreview(
            sources=[str(path) for path in clean_sources],
            notebooks=len(notebooks),
            sections=len(sections),
            pages=len(pages),
            media_candidates=media_candidates,
            unsupported_files=unsupported_count,
            warnings=warnings,
            pages_preview=[self._page_preview_payload(page) for page in pages[:30]],
        )
        return preview.as_dict()

    def import_sources(self, source_paths: list[str], target_folder: str = "") -> dict[str, Any]:
        clean_sources = self._resolve_source_paths(source_paths)
        pages, warnings, _unsupported_count = self._discover_pages(clean_sources)
        target_base = self._resolve_target_base(target_folder)
        result = ImportResult(warnings=list(warnings))

        for page in pages:
            try:
                note_path, media_count = self._import_page(page, target_base)
            except OSError as exc:
                result.skipped_pages += 1
                result.warnings.append(f"{page.source_path}: konnte nicht importiert werden ({exc}).")
                continue
            result.imported_pages += 1
            result.media_files += media_count
            result.created_notes.append(note_path.relative_to(self.vault.vault_path).as_posix())

        result.report_path = self._write_report(clean_sources, target_folder, result)
        return result.as_dict()

    def _resolve_source_paths(self, source_paths: list[str]) -> list[Path]:
        paths: list[Path] = []
        seen: set[str] = set()
        for raw_path in source_paths:
            clean = str(raw_path or "").strip().strip('"')
            if not clean:
                continue
            path = Path(clean).expanduser().resolve()
            key = str(path).lower()
            if key in seen:
                continue
            seen.add(key)
            if not path.exists():
                raise ValueError(f"Quelle nicht gefunden: {path}")
            paths.append(path)
        if not paths:
            raise ValueError("Bitte mindestens eine OneNote-Quelle auswaehlen.")
        return paths

    def _discover_pages(self, source_paths: list[Path]) -> tuple[list[ImportPage], list[str], int]:
        pages: list[ImportPage] = []
        warnings: list[str] = []
        unsupported_count = 0

        for source in source_paths:
            notebook_name = self._safe_display_name(source.stem if source.is_file() else source.name)
            candidates = [source] if source.is_file() else sorted(source.rglob("*"), key=lambda item: str(item).lower())
            for candidate in candidates:
                if candidate.is_dir():
                    continue
                suffix = candidate.suffix.lower()
                if suffix in UNSUPPORTED_ONENOTE_EXTENSIONS:
                    unsupported_count += 1
                    warnings.append(self._unsupported_message(candidate))
                    continue
                if suffix not in SUPPORTED_PAGE_EXTENSIONS:
                    continue
                section_parts = self._section_parts_for(source, candidate)
                title = self._page_title(candidate)
                pages.append(
                    ImportPage(
                        source_path=candidate,
                        notebook=notebook_name,
                        section_parts=section_parts,
                        title=title,
                        extension=suffix,
                    )
                )

        if not pages and unsupported_count:
            warnings.append(
                "Es wurden nur native OneNote-Dateien gefunden. Diese lokalen .one/.onepkg-Dateien koennen ohne OneNote-Export oder Microsoft Graph nicht zuverlaessig gelesen werden."
            )
        elif not pages:
            warnings.append("Keine importierbaren HTML-, MHTML-, Markdown- oder Textdateien gefunden.")
        return pages, self._dedupe(warnings), unsupported_count

    def _unsupported_message(self, path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix == ".onepkg":
            try:
                with zipfile.ZipFile(path) as archive:
                    one_files = [name for name in archive.namelist() if name.lower().endswith(".one")]
            except zipfile.BadZipFile:
                one_files = []
            if one_files:
                return f"{path.name}: .onepkg enthaelt native .one-Dateien und braucht einen OneNote-Export nach HTML/PDF oder Graph-Zugriff."
        return f"{path.name}: natives OneNote-Format ({suffix}) wird lokal noch nicht direkt gelesen."

    def _section_parts_for(self, source_root: Path, page_path: Path) -> list[str]:
        if source_root.is_file():
            return []
        try:
            relative_parent = page_path.parent.relative_to(source_root)
        except ValueError:
            return []
        return [self._safe_display_name(part) for part in relative_parent.parts if part not in {"", "."}]

    def _page_title(self, path: Path) -> str:
        try:
            if path.suffix.lower() in {".html", ".htm"}:
                text = path.read_text(encoding="utf-8", errors="replace")
                title = _extract_html_title(text)
                if title:
                    return title
            if path.suffix.lower() in {".mht", ".mhtml"}:
                html, _resources = _read_mhtml(path)
                title = _extract_html_title(html)
                if title:
                    return title
            if path.suffix.lower() in {".md", ".markdown", ".txt"}:
                first_title = _extract_text_title(path.read_text(encoding="utf-8", errors="replace"))
                if first_title:
                    return first_title
        except OSError:
            pass
        return self._safe_display_name(path.stem)

    def _count_media_candidates(self, source_paths: list[Path]) -> int:
        count = 0
        for source in source_paths:
            candidates = [source] if source.is_file() else source.rglob("*")
            for candidate in candidates:
                if candidate.is_file() and candidate.suffix.lower() in MEDIA_EXTENSIONS:
                    count += 1
        return count

    def _resolve_target_base(self, target_folder: str) -> Path:
        clean = target_folder.replace("\\", "/").strip().strip("/")
        if not clean:
            return self.vault.vault_path
        if clean.startswith(".") or clean.startswith("/"):
            raise ValueError("Der Zielordner muss ein relativer Ordner innerhalb der NoteBase sein.")
        parts = [self._safe_path_token(part) for part in clean.split("/") if part.strip()]
        if not parts:
            return self.vault.vault_path
        target = self.vault.vault_path.joinpath(*parts).resolve()
        target.relative_to(self.vault.vault_path.resolve())
        if target.name in {self.vault.system_root_name, self.vault.media_root_name}:
            raise ValueError("System- und Medienordner koennen nicht als Importziel verwendet werden.")
        target.mkdir(parents=True, exist_ok=True)
        return target

    def _import_page(self, page: ImportPage, target_base: Path) -> tuple[Path, int]:
        note_dir = target_base / self._safe_path_token(page.notebook)
        for section in page.section_parts:
            note_dir = note_dir / self._safe_path_token(section)
        note_dir.mkdir(parents=True, exist_ok=True)

        note_stem = self._safe_path_token(page.title) or "OneNote_Seite"
        note_path = self._next_available_path(note_dir, note_stem, ".md")
        media_dir = self.vault.media_root_path / self._safe_path_token(page.notebook)
        for section in page.section_parts:
            media_dir = media_dir / self._safe_path_token(section)
        media_dir = media_dir / note_path.stem
        media_dir.mkdir(parents=True, exist_ok=True)

        if page.extension in {".html", ".htm"}:
            html = page.source_path.read_text(encoding="utf-8", errors="replace")
            body, media_count = self._html_to_markdown(html, page.source_path.parent, media_dir, note_path)
        elif page.extension in {".mht", ".mhtml"}:
            html, resources = _read_mhtml(page.source_path)
            body, media_count = self._html_to_markdown(html, page.source_path.parent, media_dir, note_path, resources)
        elif page.extension in {".md", ".markdown"}:
            body, media_count = self._import_markdown_body(page.source_path, media_dir, note_path)
        else:
            body = page.source_path.read_text(encoding="utf-8", errors="replace").strip()
            media_count = 0

        now = datetime.now()
        try:
            created = datetime.fromtimestamp(page.source_path.stat().st_ctime).isoformat(timespec="seconds")
            updated = datetime.fromtimestamp(page.source_path.stat().st_mtime).isoformat(timespec="seconds")
        except OSError:
            created = updated = now.isoformat(timespec="seconds")
        note_id = make_note_id(now)
        frontmatter = {
            "id": note_id,
            "node_id": note_id,
            "title": page.title,
            "type": "note",
            "status": "open",
            "priority": "medium",
            "due_date": "",
            "created_at": created,
            "updated_at": updated,
            "tags": [],
            "tags_auto": [],
            "related": [],
            "related_auto": [],
        }
        body = body.strip() or "_Leere OneNote-Seite importiert._"
        note_path.write_text(dump_markdown(frontmatter, body), encoding="utf-8")
        return note_path, media_count

    def _html_to_markdown(
        self,
        html: str,
        base_dir: Path,
        media_dir: Path,
        note_path: Path,
        resources: dict[str, tuple[bytes, str, str]] | None = None,
    ) -> tuple[str, int]:
        converter = _HtmlToMarkdown(
            copy_asset=lambda src, alt: self._copy_html_asset(src, alt, base_dir, media_dir, note_path, resources or {})
        )
        converter.feed(html)
        converter.close()
        return converter.markdown(), converter.media_count

    def _copy_html_asset(
        self,
        src: str,
        alt: str,
        base_dir: Path,
        media_dir: Path,
        note_path: Path,
        resources: dict[str, tuple[bytes, str, str]],
    ) -> str:
        clean_src = unquote((src or "").strip())
        if not clean_src:
            return ""
        if clean_src in resources:
            data, filename, content_type = resources[clean_src]
            target = self._write_media_bytes(media_dir, filename, data, content_type)
            return _markdown_relative_path(note_path, target)
        parsed = urlparse(clean_src)
        if parsed.scheme in {"http", "https"}:
            return clean_src
        if parsed.scheme == "file":
            source_path = Path(unquote(parsed.path)).resolve()
        else:
            source_path = (base_dir / clean_src.replace("/", "\\")).resolve()
        try:
            source_path.relative_to(base_dir.resolve())
        except ValueError:
            return clean_src
        if not source_path.exists() or not source_path.is_file():
            return clean_src
        target = self._copy_media_file(source_path, media_dir)
        return _markdown_relative_path(note_path, target)

    def _import_markdown_body(self, source_path: Path, media_dir: Path, note_path: Path) -> tuple[str, int]:
        body = source_path.read_text(encoding="utf-8", errors="replace")
        media_count = 0

        def replace_image(match: re.Match[str]) -> str:
            nonlocal media_count
            alt = match.group(1)
            target = match.group(2).strip()
            if re.match(r"^(https?:)?//", target, flags=re.IGNORECASE):
                return match.group(0)
            source = (source_path.parent / target).resolve()
            try:
                source.relative_to(source_path.parent.resolve())
            except ValueError:
                return match.group(0)
            if not source.exists() or not source.is_file():
                return match.group(0)
            copied = self._copy_media_file(source, media_dir)
            media_count += 1
            return f"![{alt}]({_markdown_relative_path(note_path, copied)})"

        body = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", replace_image, body)
        return body, media_count

    def _copy_media_file(self, source_path: Path, media_dir: Path) -> Path:
        media_dir.mkdir(parents=True, exist_ok=True)
        target = self._next_available_path(media_dir, self._safe_path_token(source_path.stem), source_path.suffix.lower())
        shutil.copy2(source_path, target)
        return target

    def _write_media_bytes(self, media_dir: Path, filename: str, data: bytes, content_type: str) -> Path:
        media_dir.mkdir(parents=True, exist_ok=True)
        raw_name = filename.strip() or "asset"
        suffix = Path(raw_name).suffix.lower()
        if not suffix:
            suffix = mimetypes.guess_extension(content_type or "") or ".bin"
        target = self._next_available_path(media_dir, self._safe_path_token(Path(raw_name).stem), suffix)
        target.write_bytes(data)
        return target

    def _next_available_path(self, directory: Path, stem: str, suffix: str) -> Path:
        clean_stem = stem or "item"
        clean_suffix = suffix if suffix.startswith(".") else f".{suffix}"
        candidate = directory / f"{clean_stem}{clean_suffix}"
        counter = 2
        while candidate.exists():
            candidate = directory / f"{clean_stem}_{counter}{clean_suffix}"
            counter += 1
        return candidate

    def _write_report(self, sources: list[Path], target_folder: str, result: ImportResult) -> str:
        report_dir = self.vault.system_path / "imports" / "onenote"
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path = report_dir / f"import_{datetime.now():%Y%m%d_%H%M%S}.json"
        payload = {
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "sources": [str(source) for source in sources],
            "target_folder": target_folder,
            "result": result.as_dict() | {"reportPath": ""},
        }
        report_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        return report_path.relative_to(self.vault.vault_path).as_posix()

    def _page_preview_payload(self, page: ImportPage) -> dict[str, Any]:
        return {
            "title": page.title,
            "notebook": page.notebook,
            "section": " / ".join(page.section_parts),
            "sourcePath": str(page.source_path),
        }

    def _safe_display_name(self, value: str) -> str:
        clean = " ".join(str(value or "").replace("_", " ").split())
        return clean or "OneNote"

    def _safe_path_token(self, value: str) -> str:
        clean = " ".join(str(value or "").split()).strip()
        slug = slugify(clean).replace("_", " ").strip()
        if not slug:
            return "OneNote"
        token = "".join(char if char.isalnum() or char in {" ", "_", "-"} else "_" for char in clean)
        token = "_".join(part for part in token.replace(" ", "_").split("_") if part)
        return token[:80] or "OneNote"

    def _dedupe(self, values: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            result.append(value)
        return result


class _HtmlToMarkdown(HTMLParser):
    def __init__(self, copy_asset: Any):
        super().__init__(convert_charrefs=True)
        self.copy_asset = copy_asset
        self.parts: list[str] = []
        self.href_stack: list[str] = []
        self.list_stack: list[str] = []
        self.in_title = False
        self.table_depth = 0
        self.media_count = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key.lower(): value or "" for key, value in attrs}
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._block()
            self.parts.append(f"{'#' * int(tag[1])} ")
        elif tag in {"p", "div", "section", "article"}:
            self._block()
        elif tag == "br":
            self.parts.append("\n")
        elif tag in {"strong", "b"}:
            self.parts.append("**")
        elif tag in {"em", "i"}:
            self.parts.append("*")
        elif tag == "code":
            self.parts.append("`")
        elif tag == "pre":
            self._block()
            self.parts.append("```\n")
        elif tag in {"ul", "ol"}:
            self._block()
            self.list_stack.append(tag)
        elif tag == "li":
            self._block()
            marker = "1. " if self.list_stack and self.list_stack[-1] == "ol" else "- "
            self.parts.append(marker)
        elif tag == "a":
            self.href_stack.append(attr.get("href", ""))
            self.parts.append("[")
        elif tag == "img":
            source = attr.get("data-fullres-src") or attr.get("src") or ""
            alt = attr.get("alt") or "Bild"
            target = self.copy_asset(source, alt)
            if target:
                if not re.match(r"^https?://", target, flags=re.IGNORECASE):
                    self.media_count += 1
                self.parts.append(f"![{alt}]({target})")
        elif tag == "object":
            source = attr.get("data") or ""
            label = attr.get("data-attachment") or "Anhang"
            target = self.copy_asset(source, label)
            if target:
                if not re.match(r"^https?://", target, flags=re.IGNORECASE):
                    self.media_count += 1
                self.parts.append(f"[{label}]({target})")
        elif tag == "table":
            self._block()
            self.table_depth += 1
            self.parts.append("<table>\n")
        elif tag in {"tr", "td", "th"} and self.table_depth:
            self.parts.append(f"<{tag}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "section", "article", "li"}:
            self._block()
        elif tag in {"strong", "b"}:
            self.parts.append("**")
        elif tag in {"em", "i"}:
            self.parts.append("*")
        elif tag == "code":
            self.parts.append("`")
        elif tag == "pre":
            self.parts.append("\n```")
            self._block()
        elif tag in {"ul", "ol"}:
            if self.list_stack:
                self.list_stack.pop()
            self._block()
        elif tag == "a":
            href = self.href_stack.pop() if self.href_stack else ""
            self.parts.append(f"]({href})" if href else "]")
        elif tag == "table":
            self.parts.append("</table>")
            self.table_depth = max(0, self.table_depth - 1)
            self._block()
        elif tag in {"tr", "td", "th"} and self.table_depth:
            self.parts.append(f"</{tag}>")
            if tag == "tr":
                self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not data:
            return
        self.parts.append(data)

    def markdown(self) -> str:
        text = "".join(self.parts)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _block(self) -> None:
        current = "".join(self.parts)
        if not current:
            return
        if not current.endswith("\n\n"):
            if current.endswith("\n"):
                self.parts.append("\n")
            else:
                self.parts.append("\n\n")


class _TitleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_title = False
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "title":
            self.in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.parts.append(data)


def _extract_html_title(html: str) -> str:
    parser = _TitleParser()
    parser.feed(html)
    title = " ".join("".join(parser.parts).split())
    return title[:160]


def _extract_text_title(text: str) -> str:
    for line in text.splitlines():
        clean = line.strip().lstrip("#").strip()
        if clean:
            return clean[:160]
    return ""


def _read_mhtml(path: Path) -> tuple[str, dict[str, tuple[bytes, str, str]]]:
    message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
    html = ""
    resources: dict[str, tuple[bytes, str, str]] = {}
    for part in message.walk():
        content_type = part.get_content_type()
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        location = str(part.get("Content-Location") or part.get("Content-ID") or "").strip("<>")
        filename = part.get_filename() or Path(urlparse(location).path).name or "asset"
        if content_type in {"text/html", "application/xhtml+xml"} and not html:
            charset = part.get_content_charset() or "utf-8"
            html = payload.decode(charset, errors="replace")
            continue
        if location:
            resources[unquote(location)] = (payload, filename, content_type)
    return html, resources


def _markdown_relative_path(note_path: Path, asset_path: Path) -> str:
    return os.path.relpath(asset_path, start=note_path.parent).replace("\\", "/")
