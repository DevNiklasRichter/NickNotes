from __future__ import annotations

import base64
import binascii
import json
import os
import re
import subprocess
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from itertools import groupby
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree as ET

from .file_io import atomic_write_bytes, atomic_write_text
from .markdown_io import dump_markdown
from .parser import make_note_id
from .process_limits import bounded_export
from .source_journal import SourceJournal
from .task_domain import normalize_tag_id
from .todos import format_todo_tail
from ..config import (
    ONENOTE_IMPORT_EXPORT_TIMEOUT_SECONDS,
    ONENOTE_IMPORT_MAX_RESULT_BYTES,
    ONENOTE_IMPORT_MAX_SOURCE_FILE_BYTES,
    ONENOTE_IMPORT_MAX_SOURCE_FILES,
    ONENOTE_IMPORT_MAX_SOURCE_PATH_LENGTH,
)
from .vault import VaultManager


ONEPKG_EXTENSIONS = {".onepkg"}
ONENOTE_TAG_GROUP_ID = "onenote"
ONENOTE_TAG_GROUP_NAME = "OneNote"
MAX_PAGES_PER_PACKAGE = 2000
MAX_PAGE_XML_BYTES = 16 * 1024 * 1024
MAX_IMAGE_BASE64_BYTES = 28 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
# Leaves room for the media folder (".media/<note>/image_001.jpeg") below the classic Windows path limit.
MAX_NOTE_PATH_LENGTH = 220
MAX_REPORTED_WARNINGS = 200
EMPTY_PAGE_BODY = "_Leere OneNote-Seite importiert._"
UNTITLED_PAGE = "Unbenannte Seite"

_WINDOWS_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)), *(f"LPT{n}" for n in range(1, 10))}
_TODO_TAG_NAME_PATTERN = re.compile(r"to ?do|aufgabe|erledigen", re.IGNORECASE)
_TODO_TAG_SYMBOLS = {"3"}
_PAGE_ID_PATTERN = re.compile(r"page-id=(\{[0-9a-f-]+\})", re.IGNORECASE)
_FRONTMATTER_PAGE_ID_PATTERN = re.compile(r"^onenote_page_id:\s*['\"]?(\{[0-9A-Fa-f-]+\})", re.MULTILINE)
_FRONTMATTER_ID_PATTERN = re.compile(r"^id:\s*['\"]?([A-Za-z0-9_-]+)", re.MULTILINE)
_GENERATED_ALT_TEXT_PATTERN = re.compile(r"^(computergenerierter alternativtext|machine generated alternative text)", re.IGNORECASE)
_HEADING_LEVELS = {f"h{level}": level for level in range(1, 7)}
_QUOTE_STYLES = {"blockquote", "cite"}
_INK_ELEMENTS = {"InkDrawing", "InkParagraph", "InkWord"}
_FILE_ELEMENTS = {"InsertedFile", "MediaFile"}
_PAGE_OBJECT_ELEMENTS = {"Outline", "Image", "InkDrawing", *_FILE_ELEMENTS}
_BLOCKED_LINK_SCHEMES = {"javascript", "vbscript", "data"}
_UMLAUT_TRANSLATION = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"})


class OneNoteImportError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        is_validation: bool = True,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details: dict[str, Any] = details or {}
        self.is_validation = is_validation

    def payload(self) -> dict[str, Any]:
        payload = {"code": self.code, "message": self.message}
        if self.details:
            payload["details"] = self.details
        return payload


class OneNoteImportValidationError(OneNoteImportError):
    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(code, message, details=details, is_validation=True)


class OneNoteImportExecutionError(OneNoteImportError):
    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(code, message, details=details, is_validation=False)


# Written with a BOM so Windows PowerShell 5.1 reads the umlauts in its messages correctly.
_ONEPKG_EXPORT_POWERSHELL = r"""
param(
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [Parameter(Mandatory=$true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'
$MaxAttachmentBytes = 50MB

function ConvertTo-SafeFileName([string]$Value) {
  $name = if ([string]::IsNullOrWhiteSpace($Value)) { 'Page' } else { $Value.Trim() }
  foreach ($char in [System.IO.Path]::GetInvalidFileNameChars()) {
    $name = $name.Replace($char, '_')
  }
  $name = ($name -replace '\s+', '_').Trim('_')
  if ([string]::IsNullOrWhiteSpace($name)) { $name = 'Page' }
  if ($name.Length -gt 60) { $name = $name.Substring(0, 60) }
  return $name
}

function ConvertTo-SafeExtension([string]$Value) {
  if ($Value -match '^\.[A-Za-z0-9]{1,10}$') { return $Value.ToLowerInvariant() }
  return '.bin'
}

function Test-RecycleBinPath([string]$RelativePath) {
  return @($RelativePath -split '[\\/]' | Where-Object { $_ -ieq 'OneNote_RecycleBin' }).Count -gt 0
}

if (-not (Test-Path -LiteralPath $PackagePath)) {
  throw "Paketdatei nicht gefunden: $PackagePath"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$extractDir = Join-Path $OutDir 'extracted'
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

$expandOutput = & expand.exe -F:* $PackagePath $extractDir 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "OneNote-Paket konnte nicht entpackt werden: $expandOutput"
}

$extractRoot = (Get-Item -LiteralPath $extractDir).FullName.TrimEnd('\')
$sectionFiles = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File |
  Where-Object { $_.Extension -ieq '.one' -and -not (Test-RecycleBinPath $_.FullName.Substring($extractRoot.Length)) } |
  Sort-Object FullName)
if ($sectionFiles.Count -eq 0) {
  throw "Im OneNote-Paket wurden keine Abschnitte (.one-Dateien) gefunden."
}

$oneNote = $null
try {
  $oneNote = New-Object -ComObject OneNote.Application
} catch {
  throw "OneNote Desktop ist nicht als COM-Anwendung verfügbar. Bitte OneNote Desktop installieren und einmal starten."
}

$resultPages = @()
$warnings = @()
$index = 0
$notebookName = [System.IO.Path]::GetFileNameWithoutExtension($PackagePath)
$notebookId = ''

try {
  try {
    $oneNote.OpenHierarchy($extractRoot, '', [ref]$notebookId, 0)
    Start-Sleep -Seconds 8
  } catch {
    $notebookId = ''
    $warnings += "Der entpackte Notizbuch-Ordner konnte nicht vorab geöffnet werden: $($_.Exception.Message)"
  }

  foreach ($sectionFile in $sectionFiles) {
    $relativeDir = [System.IO.Path]::GetDirectoryName($sectionFile.FullName.Substring($extractRoot.Length).TrimStart('\'))
    $groupParts = @()
    if (-not [string]::IsNullOrWhiteSpace($relativeDir)) {
      $groupParts = @($relativeDir -split '[\\/]' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    $sectionId = ''
    try {
      $oneNote.OpenHierarchy($sectionFile.FullName, '', [ref]$sectionId, 0)
    } catch {
      $warnings += "Abschnitt '$($sectionFile.Name)' konnte nicht geöffnet werden: $($_.Exception.Message)"
      continue
    }
    if ([string]::IsNullOrWhiteSpace($sectionId)) {
      $warnings += "Abschnitt '$($sectionFile.Name)' lieferte keine OneNote-ID."
      continue
    }

    $doc = $null
    $pages = $null
    for ($attempt = 1; $attempt -le 30; $attempt++) {
      try {
        $hierarchyXml = ''
        $oneNote.GetHierarchy($sectionId, 4, [ref]$hierarchyXml)
        [xml]$doc = $hierarchyXml
        $ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
        $ns.AddNamespace('one', $doc.DocumentElement.NamespaceURI)
        $pages = $doc.SelectNodes('//one:Page', $ns)
        $allPagesAvailable = $doc.DocumentElement.areAllPagesAvailable
        if ($pages -and $pages.Count -gt 0) { break }
        if ($allPagesAvailable -and [string]$allPagesAvailable -ne 'false') { break }
      } catch {
        if ($attempt -ge 30) {
          $warnings += "Abschnitt '$($sectionFile.Name)' konnte nicht gelesen werden: $($_.Exception.Message)"
        }
      }
      Start-Sleep -Seconds 2
    }
    if (-not $doc) { continue }
    $sectionNode = $doc.DocumentElement
    if ([string]$sectionNode.isInRecycleBin -eq 'true' -or [string]$sectionNode.isDeletedPages -eq 'true') { continue }
    if (-not $pages -or $pages.Count -eq 0) {
      $warnings += "Abschnitt '$($sectionFile.Name)' enthält keine exportierbaren Seiten oder OneNote hat sie nicht geladen."
      continue
    }
    $sectionName = if ($sectionNode.name) { [string]$sectionNode.name } else { [System.IO.Path]::GetFileNameWithoutExtension($sectionFile.Name) }
    $sectionParts = @($groupParts) + @($sectionName)

    foreach ($page in $pages) {
      if ([string]$page.isInRecycleBin -eq 'true') { continue }
      $index += 1
      $title = if ($page.name) { [string]$page.name } else { 'Unbenannte Seite' }
      $safeTitle = ConvertTo-SafeFileName $title
      $target = Join-Path $OutDir ("{0:D4}_{1}.xml" -f $index, $safeTitle)
      $binaryDir = Join-Path $OutDir ("{0:D4}_media" -f $index)

      try {
        $pageContent = ''
        $oneNote.GetPageContent($page.ID, [ref]$pageContent, 0)
        $pageContent | Set-Content -LiteralPath $target -Encoding UTF8
      } catch {
        $warnings += "Seite '$title' konnte nicht gelesen werden: $($_.Exception.Message)"
        continue
      }

      $pageLinkId = ''
      try {
        $pageLink = ''
        $oneNote.GetHyperlinkToObject([string]$page.ID, '', [ref]$pageLink)
        if ($pageLink -match 'page-id=(\{[0-9A-Fa-f-]+\})') { $pageLinkId = $Matches[1] }
      } catch {}

      $binaryObjects = @()
      $attachments = @()
      try {
        [xml]$pageDoc = $pageContent
        $pageNs = New-Object System.Xml.XmlNamespaceManager($pageDoc.NameTable)
        $pageNs.AddNamespace('one', $pageDoc.DocumentElement.NamespaceURI)

        $binaryIndex = 0
        foreach ($callback in @($pageDoc.SelectNodes('//one:Image/one:CallbackID', $pageNs))) {
          $callbackId = [string]$callback.callbackID
          if ([string]::IsNullOrWhiteSpace($callbackId)) { continue }
          $binaryIndex += 1
          try {
            $binaryB64 = ''
            $oneNote.GetBinaryPageContent($page.ID, $callbackId, [ref]$binaryB64)
            if ([string]::IsNullOrWhiteSpace($binaryB64)) { continue }
            New-Item -ItemType Directory -Force -Path $binaryDir | Out-Null
            $binaryTarget = Join-Path $binaryDir ("image_{0:D3}.b64" -f $binaryIndex)
            $binaryB64 | Set-Content -LiteralPath $binaryTarget -Encoding ASCII
            $binaryObjects += [pscustomobject]@{ callbackId = $callbackId; path = $binaryTarget }
          } catch {
            $warnings += "Bild $binaryIndex auf Seite '$title' konnte nicht gelesen werden: $($_.Exception.Message)"
          }
        }

        $fileIndex = 0
        foreach ($fileNode in @($pageDoc.SelectNodes('//one:InsertedFile | //one:MediaFile', $pageNs))) {
          $fileIndex += 1
          $fileName = [string]$fileNode.preferredName
          if ([string]::IsNullOrWhiteSpace($fileName) -and $fileNode.pathSource) { $fileName = [System.IO.Path]::GetFileName([string]$fileNode.pathSource) }
          if ([string]::IsNullOrWhiteSpace($fileName)) { $fileName = "Anhang $fileIndex" }
          $cachePath = [string]$fileNode.pathCache
          if ([string]::IsNullOrWhiteSpace($cachePath) -or -not (Test-Path -LiteralPath $cachePath -PathType Leaf)) {
            $warnings += "Anhang '$fileName' auf Seite '$title' liegt nicht im OneNote-Cache und wurde nicht übernommen."
            continue
          }
          try {
            $cacheItem = Get-Item -LiteralPath $cachePath
            if ($cacheItem.Length -gt $MaxAttachmentBytes) {
              $warnings += "Anhang '$fileName' auf Seite '$title' ist größer als 50 MB und wurde nicht übernommen."
              continue
            }
            New-Item -ItemType Directory -Force -Path $binaryDir | Out-Null
            $extension = [System.IO.Path]::GetExtension($fileName)
            if ([string]::IsNullOrWhiteSpace($extension)) { $extension = $cacheItem.Extension }
            $fileTarget = Join-Path $binaryDir ("file_{0:D3}{1}" -f $fileIndex, (ConvertTo-SafeExtension $extension))
            Copy-Item -LiteralPath $cachePath -Destination $fileTarget -Force
            $attachments += [pscustomobject]@{ ordinal = $fileIndex; name = $fileName; path = $fileTarget }
          } catch {
            $warnings += "Anhang '$fileName' auf Seite '$title' konnte nicht gelesen werden: $($_.Exception.Message)"
          }
        }
      } catch {
        $warnings += "Bilder und Anhänge auf Seite '$title' konnten nicht gelesen werden: $($_.Exception.Message)"
      }

      $resultPages += [pscustomobject]@{
        path = $target
        title = $title
        notebook = $notebookName
        sections = $sectionParts
        pageLinkId = $pageLinkId
        binaryObjects = $binaryObjects
        attachments = $attachments
      }
    }
  }
} finally {
  if (-not [string]::IsNullOrWhiteSpace($notebookId)) {
    try {
      $oneNote.CloseNotebook($notebookId)
    } catch {
      $warnings += "Das temporäre Notizbuch konnte in OneNote nicht geschlossen werden und kann dort manuell geschlossen werden."
    }
  }
}

[pscustomobject]@{
  pages = $resultPages
  warnings = $warnings
} | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $ResultPath -Encoding UTF8
"""


@dataclass
class ExportedFile:
    path: Path
    name: str


@dataclass
class ImportPage:
    source_path: Path
    notebook: str
    section_parts: list[str]
    title: str
    binary_objects: dict[str, Path] = field(default_factory=dict)
    attachments: dict[int, ExportedFile] = field(default_factory=dict)
    page_link_id: str = ""

    @property
    def location(self) -> str:
        return " / ".join([self.notebook, *self.section_parts, self.title])


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
    skipped_duplicates: int = 0
    media_files: int = 0
    warnings: list[str] = field(default_factory=list)
    created_notes: list[str] = field(default_factory=list)
    report_path: str = ""
    suppressed_warnings: int = 0

    def add_warning(self, message: str) -> None:
        clean = _clean_optional_text(message)
        if not clean:
            return
        if len(self.warnings) >= MAX_REPORTED_WARNINGS:
            self.suppressed_warnings += 1
            return
        self.warnings.append(clean)

    def as_dict(self) -> dict[str, Any]:
        warnings = list(self.warnings)
        if self.suppressed_warnings:
            warnings.append(f"... und {self.suppressed_warnings} weitere Hinweise.")
        return {
            "importedPages": self.imported_pages,
            "skippedPages": self.skipped_pages,
            "skippedDuplicates": self.skipped_duplicates,
            "mediaFiles": self.media_files,
            "warnings": warnings,
            "createdNotes": self.created_notes,
            "reportPath": self.report_path,
        }


class OneNoteLocalImporter:
    def __init__(self, vault: VaultManager, progress_callback: Any | None = None):
        self.vault = vault
        self.progress_callback = progress_callback
        # OneNote tags (other than to-do checkboxes) found on imported pages: tag id -> display name.
        self.discovered_tags: dict[str, str] = {}
        self._used_note_ids: set[str] = set()

    def preview(self, source_paths: list[str]) -> dict[str, Any]:
        clean_sources = self._resolve_source_paths(source_paths)
        warnings = [
            "Die Seitenzahl von .onepkg-Dateien wird erst beim Import ermittelt. Beim Import muss OneNote Desktop installiert sein und darf kurz gestartet werden."
        ]
        if not _onenote_desktop_available():
            warnings.insert(0, _ONENOTE_MISSING_MESSAGE)
        preview = ImportPreview(sources=[str(path) for path in clean_sources], notebooks=len(clean_sources), warnings=warnings)
        return preview.as_dict()

    def import_sources(self, source_paths: list[str], target_folder: str = "") -> dict[str, Any]:
        clean_sources = self._resolve_source_paths(source_paths)
        if not _onenote_desktop_available():
            raise OneNoteImportValidationError("onenote.import.onenote_missing", _ONENOTE_MISSING_MESSAGE)
        target_base = self._resolve_target_base(target_folder)
        result = ImportResult()
        pages: list[ImportPage] = []
        failed_packages: list[str] = []
        self._progress(f"{len(clean_sources)} OneNote-Paketdatei(en) werden gelesen ...", 0, len(clean_sources), None)

        # OneNote may still hold the extracted section files for a moment; a leftover temp folder must not fail the import.
        with tempfile.TemporaryDirectory(prefix="nicknotes_onepkg_", ignore_cleanup_errors=True) as temp_dir:
            for source_index, package_source in enumerate(clean_sources, start=1):
                self._progress(
                    f"{package_source.name} wird über OneNote Desktop vorbereitet ({source_index}/{len(clean_sources)}) ...",
                    source_index - 1,
                    len(clean_sources),
                    str(package_source),
                )
                try:
                    exported_pages, export_warnings = self._export_onepkg_with_onenote(package_source, Path(temp_dir), source_index)
                except OneNoteImportError as exc:
                    failed_packages.append(f"{package_source.name}: {exc.message}")
                    result.add_warning(f"{package_source.name}: {exc.message}")
                    continue
                pages.extend(exported_pages)
                for warning in export_warnings:
                    result.add_warning(warning)

            if not pages:
                reason = f" {failed_packages[0]}" if failed_packages else ""
                raise OneNoteImportValidationError(
                    "onenote.import.no_pages",
                    f"Es wurden keine importierbaren OneNote-Seiten gefunden.{reason}",
                    details={"failedPackages": failed_packages},
                )

            existing_page_targets = self._scan_existing_notes()
            new_pages: list[ImportPage] = []
            seen_page_ids: set[str] = set()
            for page in pages:
                page_key = page.page_link_id.lower()
                if page_key and (page_key in existing_page_targets or page_key in seen_page_ids):
                    result.skipped_duplicates += 1
                    continue
                if page_key:
                    seen_page_ids.add(page_key)
                new_pages.append(page)
            if result.skipped_duplicates:
                result.add_warning(f"{result.skipped_duplicates} Seite(n) waren bereits in dieser NoteBase importiert und wurden übersprungen.")

            planned_note_paths = self._planned_note_paths(new_pages, target_base)
            page_targets = dict(existing_page_targets)
            for page in new_pages:
                if page.page_link_id:
                    page_targets[page.page_link_id.lower()] = self._wiki_target(planned_note_paths[page.source_path])
            resolver = _LinkResolver(page_targets, self._build_import_wiki_target_map(new_pages, planned_note_paths))

            total_pages = len(new_pages)
            for page in new_pages:
                self._progress("OneNote-Seiten werden importiert ...", result.imported_pages, total_pages, page.title)
                try:
                    with SourceJournal(self.vault, "import-page"):
                        note_path, media_count, page_warnings = self._import_page(page, planned_note_paths[page.source_path], resolver)
                except (OSError, ValueError, UnicodeError, ET.ParseError) as exc:
                    result.skipped_pages += 1
                    result.add_warning(f"Seite „{page.location}“ konnte nicht importiert werden: {exc}")
                    continue
                result.imported_pages += 1
                result.media_files += media_count
                result.created_notes.append(note_path.relative_to(self.vault.vault_path).as_posix())
                for warning in page_warnings:
                    result.add_warning(warning)
                self._progress("OneNote-Seiten werden importiert ...", result.imported_pages, total_pages, page.title)

        self._progress("Importbericht wird geschrieben ...", result.imported_pages, max(result.imported_pages, 1), None)
        result.report_path = self._write_report(clean_sources, target_folder, result)
        return result.as_dict()

    def _resolve_source_paths(self, source_paths: list[str]) -> list[Path]:
        paths: list[Path] = []
        seen: set[str] = set()

        if len(source_paths) > ONENOTE_IMPORT_MAX_SOURCE_FILES:
            raise OneNoteImportValidationError(
                "onenote.import.too_many_sources",
                f"Zu viele Quellpakete ausgewählt: max. {ONENOTE_IMPORT_MAX_SOURCE_FILES} erlaubt.",
                details={"maxSources": ONENOTE_IMPORT_MAX_SOURCE_FILES, "provided": len(source_paths)},
            )

        for source_index, raw_path in enumerate(source_paths, start=1):
            clean = str(raw_path or "").strip().strip('"')
            if not clean:
                raise OneNoteImportValidationError(
                    "onenote.import.empty_source",
                    "Leerer Dateipfad wurde übergeben.",
                    details={"index": source_index},
                )
            raw = Path(clean).expanduser()
            if raw.is_symlink():
                raise OneNoteImportValidationError(
                    "onenote.import.source_not_supported",
                    f"Symbolische Links sind nicht erlaubt: {raw}",
                    details={"path": str(raw)},
                )
            path = raw.resolve()
            key = str(path).lower()
            if key in seen:
                continue
            seen.add(key)

            if len(str(path)) > ONENOTE_IMPORT_MAX_SOURCE_PATH_LENGTH:
                raise OneNoteImportValidationError(
                    "onenote.import.path_too_long",
                    f"Ein Quellpfad ist zu lang: {path}",
                    details={"maxLength": ONENOTE_IMPORT_MAX_SOURCE_PATH_LENGTH, "pathLength": len(str(path))},
                )
            if not path.exists():
                raise OneNoteImportValidationError(
                    "onenote.import.source_not_found",
                    f"Quelle nicht gefunden: {path}",
                    details={"path": str(path)},
                )
            if path.is_dir():
                raise OneNoteImportValidationError(
                    "onenote.import.source_is_directory",
                    f"Bitte einzelne .onepkg-Dateien auswählen, keine ganzen Ordner: {path}.",
                    details={"path": str(path)},
                )
            if path.suffix.lower() not in ONEPKG_EXTENSIONS:
                raise OneNoteImportValidationError(
                    "onenote.import.invalid_extension",
                    f"Bitte nur OneNote-Paketdateien (.onepkg) auswählen: {path}",
                    details={"path": str(path), "extension": path.suffix.lower()},
                )
            try:
                size = path.stat().st_size
            except OSError as exc:
                raise OneNoteImportValidationError(
                    "onenote.import.source_not_accessible",
                    f"Quelle konnte nicht gelesen werden: {path}",
                    details={"path": str(path), "reason": str(exc)},
                ) from exc
            if size <= 0:
                raise OneNoteImportValidationError(
                    "onenote.import.source_empty_file",
                    f"Quellpaket ist leer: {path}",
                    details={"path": str(path)},
                )
            if size > ONENOTE_IMPORT_MAX_SOURCE_FILE_BYTES:
                raise OneNoteImportValidationError(
                    "onenote.import.source_too_large",
                    f"Quellpaket ist zu groß: {path}",
                    details={"path": str(path), "sizeBytes": size, "maxBytes": ONENOTE_IMPORT_MAX_SOURCE_FILE_BYTES},
                )
            paths.append(path)

        if not paths:
            raise OneNoteImportValidationError("onenote.import.no_sources", "Bitte mindestens eine .onepkg-Datei auswählen.")
        return paths

    def _export_onepkg_with_onenote(self, package_path: Path, temp_root: Path, package_index: int = 1) -> tuple[list[ImportPage], list[str]]:
        # The index keeps two packages with the same file name apart.
        package_output_dir = temp_root / f"{package_index:02d}_{self._safe_path_token(package_path.stem)}"
        package_output_dir.mkdir(parents=True, exist_ok=True)
        script_path = package_output_dir / "export_onepkg.ps1"
        result_path = package_output_dir / "export_result.json"
        script_path.write_text(_ONEPKG_EXPORT_POWERSHELL, encoding="utf-8-sig")

        try:
            completed = bounded_export(
                self._build_export_command(script_path=script_path, package_path=package_path, output_dir=package_output_dir, result_path=result_path),
                package_output_dir,
                self.vault.vault_path,
                ONENOTE_IMPORT_EXPORT_TIMEOUT_SECONDS,
                ONENOTE_IMPORT_MAX_RESULT_BYTES,
            )
        except (ValueError, subprocess.TimeoutExpired) as exc:
            raise OneNoteImportExecutionError(
                "onenote.import.resource_limit",
                f"OneNote-Export hat eine Zeit-, Ausgabe- oder Entpackgrenze erreicht ({exc}).",
            ) from exc
        if completed.returncode != 0:
            detail = _powershell_error_detail(_decode_process_output(completed.stderr or completed.stdout))
            raise OneNoteImportExecutionError(
                "onenote.import.powershell_failed",
                f"Export über OneNote Desktop fehlgeschlagen. {detail or 'OneNote Desktop konnte die Paketdatei nicht öffnen.'}",
                details={"returnCode": completed.returncode, "detail": detail, "packagePath": str(package_path)},
            )

        raw_output = ""
        if result_path.exists():
            if result_path.stat().st_size > ONENOTE_IMPORT_MAX_RESULT_BYTES:
                raise OneNoteImportExecutionError("onenote.import.result_too_large", "Das Ergebnis des OneNote-Exports ist zu groß.")
            try:
                raw_output = _clean_optional_text(result_path.read_text(encoding="utf-8-sig"))
            except (OSError, UnicodeError):
                raw_output = ""
        if not raw_output:
            raw_output = _decode_process_output(completed.stdout)
        if not raw_output:
            raise OneNoteImportExecutionError(
                "onenote.import.empty_result",
                "Der OneNote-Export lieferte keine Ausgabe.",
                details={"packagePath": str(package_path), "detail": _decode_process_output(completed.stderr) or None},
            )
        try:
            payload = json.loads(raw_output)
        except json.JSONDecodeError as exc:
            raise OneNoteImportExecutionError(
                "onenote.import.invalid_result_json",
                "Der OneNote-Export lieferte keine lesbare Antwort.",
                details={"jsonError": str(exc)},
            ) from exc

        raw_pages = _as_list(payload.get("pages")) if isinstance(payload, dict) else []
        raw_warnings = [str(warning).strip() for warning in _as_list(payload.get("warnings") if isinstance(payload, dict) else None) if str(warning).strip()]
        if not raw_pages:
            detail = f" Details: {' | '.join(raw_warnings[:5])}" if raw_warnings else ""
            raise OneNoteImportValidationError(
                "onenote.import.no_pages_exported",
                f"OneNote Desktop hat keine Seiten aus dem Paket exportiert.{detail}",
                details={"packagePath": str(package_path)},
            )
        if len(raw_pages) > MAX_PAGES_PER_PACKAGE:
            raise OneNoteImportExecutionError(
                "onenote.import.too_many_pages",
                f"Ein Paket darf höchstens {MAX_PAGES_PER_PACKAGE} Seiten enthalten.",
                details={"pages": len(raw_pages)},
            )

        pages: list[ImportPage] = []
        package_notebook = self._safe_display_name(package_path.stem)
        package_output_root = package_output_dir.resolve()
        for raw_page in raw_pages:
            if not isinstance(raw_page, dict):
                continue
            exported_path = self._exported_path(raw_page.get("path"), package_output_root)
            if exported_path is None or not exported_path.is_file() or exported_path.suffix.lower() != ".xml":
                continue
            title = self._safe_display_name(str(raw_page.get("title", "")) or UNTITLED_PAGE)
            if exported_path.stat().st_size > MAX_PAGE_XML_BYTES:
                raw_warnings.append(f"Seite „{title}“ ist größer als 16 MB und wurde nicht übernommen.")
                continue
            notebook = self._safe_display_name(str(raw_page.get("notebook", "")) or package_notebook)
            sections = [self._safe_display_name(str(section)) for section in _as_list(raw_page.get("sections")) if str(section).strip()]

            binary_objects: dict[str, Path] = {}
            for raw_binary in _as_list(raw_page.get("binaryObjects")):
                if not isinstance(raw_binary, dict):
                    continue
                callback_id = _clean_optional_text(raw_binary.get("callbackId"))
                binary_path = self._exported_path(raw_binary.get("path"), package_output_root)
                if callback_id and binary_path is not None and binary_path.is_file():
                    binary_objects[callback_id] = binary_path

            attachments: dict[int, ExportedFile] = {}
            for raw_attachment in _as_list(raw_page.get("attachments")):
                if not isinstance(raw_attachment, dict):
                    continue
                try:
                    ordinal = int(raw_attachment.get("ordinal", 0))
                except (TypeError, ValueError):
                    continue
                attachment_path = self._exported_path(raw_attachment.get("path"), package_output_root)
                if ordinal > 0 and attachment_path is not None and attachment_path.is_file():
                    attachments[ordinal] = ExportedFile(attachment_path, _clean_optional_text(raw_attachment.get("name")) or attachment_path.name)

            page_link_id = _clean_optional_text(raw_page.get("pageLinkId"))
            pages.append(
                ImportPage(
                    source_path=exported_path,
                    notebook=notebook,
                    section_parts=sections,
                    title=title,
                    binary_objects=binary_objects,
                    attachments=attachments,
                    page_link_id=page_link_id if _PAGE_ID_PATTERN.fullmatch(f"page-id={page_link_id}") else "",
                )
            )

        if not pages:
            raise OneNoteImportValidationError(
                "onenote.import.no_pages_importable",
                "OneNote Desktop hat keine importierbaren Seiten erzeugt.",
                details={"packagePath": str(package_path)},
            )
        return pages, [f"{package_path.name}: {warning}" for warning in raw_warnings]

    def _exported_path(self, raw_value: Any, allowed_root: Path) -> Path | None:
        raw_path = _clean_optional_text(raw_value)
        if not raw_path:
            return None
        try:
            candidate = Path(raw_path).resolve()
        except OSError:
            return None
        if not self._is_within(allowed_root, candidate):
            raise OneNoteImportExecutionError(
                "onenote.import.path_escape",
                "Ein Exportpfad lag unerwartet außerhalb des temporären Exportordners.",
                details={"exportPath": raw_path},
            )
        return candidate

    @staticmethod
    def _build_export_command(*, script_path: Path, package_path: Path, output_dir: Path, result_path: Path) -> list[str]:
        return [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
            "-PackagePath",
            str(package_path),
            "-OutDir",
            str(output_dir),
            "-ResultPath",
            str(result_path),
        ]

    @staticmethod
    def _is_within(allowed_root: Path, candidate: Path) -> bool:
        try:
            return candidate.resolve().is_relative_to(allowed_root.resolve())
        except OSError:
            return False

    def _resolve_target_base(self, target_folder: str) -> Path:
        clean = str(target_folder or "").replace("\\", "/").strip().strip("/")
        if not clean:
            return self.vault.vault_path
        raw_parts = [part.strip() for part in clean.split("/") if part.strip()]
        if clean.startswith(".") or ":" in clean or any(part.startswith(".") for part in raw_parts):
            raise OneNoteImportValidationError(
                "onenote.import.invalid_target_folder",
                "Der Zielordner muss ein relativer Ordner innerhalb der NoteBase sein.",
                details={"targetFolder": target_folder},
            )
        parts = [self._safe_path_token(part) for part in raw_parts]
        if not parts:
            return self.vault.vault_path
        target = self.vault.vault_path.joinpath(*parts).resolve()
        if not target.is_relative_to(self.vault.vault_path.resolve()) or target.name in {self.vault.system_root_name, self.vault.media_root_name}:
            raise OneNoteImportValidationError(
                "onenote.import.reserved_target_folder",
                "System- und Medienordner können nicht als Importziel verwendet werden.",
                details={"targetFolder": target_folder},
            )
        if self.vault._is_creation_locked_path(target):
            raise OneNoteImportValidationError(
                "onenote.import.reserved_target_folder",
                "In daily-, tags- und tasks-Ordner kann nicht importiert werden.",
                details={"targetFolder": target_folder},
            )
        target.mkdir(parents=True, exist_ok=True)
        return target

    def _planned_note_paths(self, pages: list[ImportPage], target_base: Path) -> dict[Path, Path]:
        planned: dict[Path, Path] = {}
        reserved: set[str] = set()
        for page in pages:
            notebook_dir = target_base / self._safe_path_token(page.notebook)
            note_dir = notebook_dir
            for section in page.section_parts:
                note_dir = note_dir / self._safe_path_token(section)
            if len(str(note_dir)) > MAX_NOTE_PATH_LENGTH - 30:
                # Deep section groups would exceed the Windows path limit; keep the page in its notebook folder.
                note_dir = notebook_dir / self._safe_path_token(page.section_parts[-1] if page.section_parts else page.notebook)
            note_stem = self._safe_path_token(page.title, fallback="OneNote_Seite")
            room = MAX_NOTE_PATH_LENGTH - len(str(note_dir)) - len("/_99.md")
            if room < len(note_stem):
                note_stem = note_stem[: max(room, 12)].rstrip("_-") or "OneNote_Seite"
            note_path = self._next_available_path(note_dir, note_stem, ".md", reserved)
            planned[page.source_path] = note_path
            reserved.add(str(note_path).lower())
        return planned

    def _wiki_target(self, note_path: Path) -> str:
        return note_path.relative_to(self.vault.vault_path).with_suffix("").as_posix()

    def _build_import_wiki_target_map(self, pages: list[ImportPage], planned_note_paths: dict[Path, Path]) -> dict[str, str]:
        target_map: dict[str, str] = {}
        ambiguous: set[str] = set()

        def add(key: str, relative_target: str) -> None:
            clean = _normalize_wiki_compare(key)
            if not clean or clean in ambiguous:
                return
            existing = target_map.get(clean)
            if existing and existing != relative_target:
                target_map.pop(clean, None)
                ambiguous.add(clean)
                return
            target_map[clean] = relative_target

        for page in pages:
            note_path = planned_note_paths.get(page.source_path)
            if not note_path:
                continue
            relative_target = self._wiki_target(note_path)
            add(page.title, relative_target)
            add(self._safe_path_token(page.title), relative_target)
        return target_map

    def _scan_existing_notes(self) -> dict[str, str]:
        """Collects earlier OneNote imports (page id -> wiki target) and all note ids already in use."""
        found: dict[str, str] = {}
        root = self.vault.vault_path
        for directory, dir_names, file_names in os.walk(root):
            dir_names[:] = [name for name in dir_names if not name.startswith(".")]
            for file_name in file_names:
                if not file_name.lower().endswith(".md"):
                    continue
                path = Path(directory) / file_name
                try:
                    with path.open("r", encoding="utf-8", errors="ignore") as stream:
                        head = stream.read(8192)
                except OSError:
                    continue
                if not head.startswith("---"):
                    continue
                id_match = _FRONTMATTER_ID_PATTERN.search(head)
                if id_match:
                    self._used_note_ids.add(id_match.group(1))
                page_match = _FRONTMATTER_PAGE_ID_PATTERN.search(head)
                if page_match:
                    found[page_match.group(1).lower()] = path.relative_to(root).with_suffix("").as_posix()
        return found

    def _import_page(self, page: ImportPage, note_path: Path, resolver: "_LinkResolver") -> tuple[Path, int, list[str]]:
        root = _parse_page_xml(page.source_path)
        media_dir = self.vault.note_media_directory(note_path)
        media_refs, image_count = self._import_page_images(page, media_dir)
        attachment_refs, attachment_count = self._import_page_attachments(page, media_dir)
        converted = _PageConverter(root, media_refs, attachment_refs, resolver).convert()
        body = _rewrite_wikilinks_to_relative_paths(converted.body, resolver.title_map) or EMPTY_PAGE_BODY

        now = datetime.now().astimezone()
        created = converted.created or now
        updated = converted.updated or created
        note_id = self._unique_note_id(created)
        frontmatter: dict[str, Any] = {
            "id": note_id,
            "node_id": note_id,
            "title": page.title,
            "type": "note",
            "created_at": created.isoformat(timespec="seconds"),
            "updated_at": updated.isoformat(timespec="seconds"),
            "onenote_notebook": page.notebook,
            "onenote_section": "/".join(page.section_parts),
        }
        if page.page_link_id:
            frontmatter["onenote_page_id"] = page.page_link_id
        if converted.page_level > 1:
            frontmatter["onenote_page_level"] = converted.page_level
        if len(converted.authors) > 1:
            frontmatter["onenote_authors"] = converted.authors
        # The vault normalizer derives tags_auto/related_auto and fills the remaining default fields.
        document, _meta = self.vault.normalize_note_markdown_text(
            text=dump_markdown(frontmatter, body),
            path=note_path,
            touch_updated=False,
            previous_status="open",
        )
        atomic_write_text(note_path, document)
        self.discovered_tags.update(converted.tags)

        warnings: list[str] = []
        if converted.ink_count:
            warnings.append(f"Seite „{page.location}“: {converted.ink_count} Freihandelement(e) (Zeichnungen, Handschrift) wurden nicht übernommen.")
        if converted.missing_media:
            warnings.append(f"Seite „{page.location}“: {converted.missing_media} Bild(er) oder Anhang/Anhänge fehlen und sind in der Notiz markiert.")
        return note_path, image_count + attachment_count, warnings

    def _unique_note_id(self, created: datetime) -> str:
        for _attempt in range(64):
            candidate = make_note_id(created)
            if candidate not in self._used_note_ids:
                self._used_note_ids.add(candidate)
                return candidate
        candidate = f"nt_{created:%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}"
        self._used_note_ids.add(candidate)
        return candidate

    def _import_page_images(self, page: ImportPage, media_dir: Path) -> tuple[dict[str, str], int]:
        media_refs: dict[str, str] = {}
        imported = 0
        for index, (callback_id, b64_path) in enumerate(page.binary_objects.items(), start=1):
            try:
                payload = _read_base64_file(b64_path)
            except (OSError, ValueError):
                continue
            suffix = _image_suffix_from_bytes(payload)
            target_path = self._next_available_path(media_dir, f"image_{index:03d}", suffix)
            atomic_write_bytes(target_path, payload)
            media_refs[callback_id] = self._media_link(target_path)
            imported += 1
        return media_refs, imported

    def _import_page_attachments(self, page: ImportPage, media_dir: Path) -> tuple[dict[int, tuple[str, str]], int]:
        refs: dict[int, tuple[str, str]] = {}
        imported = 0
        for ordinal, exported in sorted(page.attachments.items()):
            try:
                if exported.path.stat().st_size > MAX_ATTACHMENT_BYTES:
                    continue
                payload = exported.path.read_bytes()
            except OSError:
                continue
            suffix = exported.path.suffix.lower() if re.fullmatch(r"\.[a-z0-9]{1,10}", exported.path.suffix.lower()) else ".bin"
            stem = self._safe_path_token(Path(exported.name).stem, fallback=f"Anhang_{ordinal}")
            target_path = self._next_available_path(media_dir, stem, suffix)
            atomic_write_bytes(target_path, payload)
            refs[ordinal] = (exported.name, self._media_link(target_path))
            imported += 1
        return refs, imported

    def _media_link(self, target_path: Path) -> str:
        return f"/{target_path.relative_to(self.vault.vault_path).as_posix()}"

    def _next_available_path(self, directory: Path, stem: str, suffix: str, reserved: set[str] | None = None) -> Path:
        clean_stem = stem or "item"
        clean_suffix = suffix if suffix.startswith(".") else f".{suffix}"
        candidate = directory / f"{clean_stem}{clean_suffix}"
        counter = 2
        reserved = reserved or set()
        while candidate.exists() or str(candidate).lower() in reserved:
            candidate = directory / f"{clean_stem}_{counter}{clean_suffix}"
            counter += 1
        return candidate

    def _write_report(self, sources: list[Path], target_folder: str, result: ImportResult) -> str:
        report_dir = self.vault.system_path / "imports" / "onenote"
        report_path = report_dir / f"import_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:4]}.json"
        payload = {
            "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "sources": [str(source) for source in sources],
            "target_folder": target_folder,
            "result": result.as_dict() | {"reportPath": ""},
        }
        atomic_write_text(report_path, json.dumps(payload, indent=2, ensure_ascii=False))
        return report_path.relative_to(self.vault.vault_path).as_posix()

    def _safe_display_name(self, value: str) -> str:
        clean = " ".join(str(value or "").replace("_", " ").split())
        return clean or "OneNote"

    def _safe_path_token(self, value: str, fallback: str = "OneNote") -> str:
        token = self.vault._safe_entry_name(" ".join(str(value or "").split()))
        if not token:
            return fallback
        if token.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES:
            token = f"{token}_"
        return token

    def _progress(self, phase: str, processed: int, total: int, current_path: str | None) -> None:
        if self.progress_callback:
            self.progress_callback(phase, processed, total, current_path)


_ONENOTE_MISSING_MESSAGE = (
    "OneNote Desktop wurde auf diesem Rechner nicht gefunden. Der Import von .onepkg-Dateien "
    "benötigt die Desktop-Version von OneNote (Microsoft 365 oder OneNote 2016)."
)


def _onenote_desktop_available() -> bool:
    """True when the OneNote COM server the export script talks to is registered."""
    if os.name != "nt":
        return False
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"OneNote.Application\CLSID"):
            return True
    except OSError:
        return False


class _LinkResolver:
    def __init__(self, page_targets: dict[str, str], title_map: dict[str, str]):
        self.page_targets = page_targets
        self.title_map = title_map

    def resolve(self, href: str) -> str | None:
        match = _PAGE_ID_PATTERN.search(unquote(href))
        if match:
            target = self.page_targets.get(match.group(1).lower())
            if target:
                return target
        title = _onenote_wiki_target_from_href(href)
        return self.title_map.get(_normalize_wiki_compare(title)) if title else None


@dataclass
class _Block:
    kind: str
    text: str


@dataclass
class _ConvertedPage:
    body: str
    created: datetime | None
    updated: datetime | None
    page_level: int
    authors: list[str]
    tags: dict[str, str]
    ink_count: int
    missing_media: int


def _local_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1] if "}" in element.tag else element.tag


def _parse_page_xml(path: Path) -> ET.Element:
    if path.stat().st_size > MAX_PAGE_XML_BYTES:
        raise ValueError("Die exportierte Seite ist größer als 16 MB.")
    text = path.read_text(encoding="utf-8-sig")
    if "<!DOCTYPE" in text[:2048].upper():
        raise ValueError("Unerwartete DTD im OneNote-Export.")
    return ET.fromstring(text)


class _PageConverter:
    """Turns one OneNote page (2013 page schema) into NickNotes Markdown."""

    def __init__(
        self,
        root: ET.Element,
        media_refs: dict[str, str],
        attachment_refs: dict[int, tuple[str, str]],
        resolver: _LinkResolver | None = None,
    ):
        self.root = root
        self.media_refs = media_refs
        self.attachment_refs = attachment_refs
        self.resolver = resolver
        self.quick_styles: dict[str, str] = {}
        self.tag_defs: dict[str, ET.Element] = {}
        for child in root:
            name = _local_name(child)
            if name == "QuickStyleDef":
                self.quick_styles[child.get("index", "")] = child.get("name", "").strip().lower()
            elif name == "TagDef":
                self.tag_defs[child.get("index", "")] = child
        # Attachments are exported in document order, so their ordinal links XML element and exported file.
        self.file_ordinals: dict[int, int] = {}
        for element in root.iter():
            if _local_name(element) in _FILE_ELEMENTS:
                self.file_ordinals[id(element)] = len(self.file_ordinals) + 1
        self.tags: dict[str, str] = {}
        self.authors: dict[str, int] = {}
        self.ink_count = 0
        self.missing_media = 0
        self.in_cell = False

    def convert(self) -> _ConvertedPage:
        blocks: list[_Block] = []
        for element in self._page_objects_in_reading_order():
            name = _local_name(element)
            if name == "Outline":
                for child in element:
                    if _local_name(child) == "OEChildren":
                        self._container(child, "", blocks)
            else:
                self._object(element, "", blocks)
        try:
            page_level = max(1, int(self.root.get("pageLevel", "1") or 1))
        except ValueError:
            page_level = 1
        created = _parse_onenote_datetime(self.root.get("dateTime"))
        updated = _parse_onenote_datetime(self.root.get("lastModifiedTime"))
        return _ConvertedPage(
            body=_join_blocks(blocks),
            created=created,
            updated=updated or created,
            page_level=page_level,
            authors=list(self.authors)[:10],
            tags=self.tags,
            ink_count=self.ink_count,
            missing_media=self.missing_media,
        )

    def _page_objects_in_reading_order(self) -> list[ET.Element]:
        # Page objects float freely in OneNote; the XML order is the z-order, not the reading order.
        keyed: list[tuple[tuple[float, float, int], ET.Element]] = []
        last_y = last_x = 0.0
        for index, child in enumerate(self.root):
            if _local_name(child) not in _PAGE_OBJECT_ELEMENTS:
                continue
            position = next((item for item in child if _local_name(item) == "Position"), None)
            try:
                last_y = float(position.get("y", last_y)) if position is not None else last_y
                last_x = float(position.get("x", last_x)) if position is not None else last_x
            except ValueError:
                pass
            keyed.append(((round(last_y), last_x, index), child))
        return [element for _key, element in sorted(keyed, key=lambda item: item[0])]

    def _container(self, container: ET.Element, indent: str, blocks: list[_Block]) -> None:
        for child in container:
            name = _local_name(child)
            if name == "OE":
                self._oe(child, indent, blocks)
            elif name == "OEChildren":
                self._container(child, indent, blocks)
            else:
                self._object(child, indent, blocks)

    def _object(self, element: ET.Element, indent: str, blocks: list[_Block]) -> None:
        name = _local_name(element)
        if name == "Table":
            table = self._table(element)
            if table:
                blocks.append(_Block("table", table))
        elif name == "Image":
            self._append_line(self._image(element), indent, "image", blocks)
        elif name in _FILE_ELEMENTS:
            self._append_line(self._file(element), indent, "file", blocks)
        elif name in _INK_ELEMENTS:
            self.ink_count += 1

    @staticmethod
    def _append_line(line: str, indent: str, kind: str, blocks: list[_Block]) -> None:
        if line:
            # Inside a list item the object stays part of the item instead of breaking the list.
            blocks.append(_Block("list", f"{indent}{line}") if indent else _Block(kind, line))

    def _oe(self, oe: ET.Element, indent: str, blocks: list[_Block]) -> None:
        for attribute in ("author", "lastModifiedBy"):
            author = " ".join(oe.get(attribute, "").split())
            if author:
                self.authors[author] = self.authors.get(author, 0) + 1
        style = self.quick_styles.get(oe.get("quickStyleIndex", ""), "")
        list_marker = ""
        todo: tuple[bool, str, str] | None = None
        tag_keys: list[str] = []
        texts: list[str] = []
        nested: list[ET.Element] = []
        for child in oe:
            name = _local_name(child)
            if name == "List":
                list_marker = _list_marker(child)
            elif name == "Tag":
                todo = self._tag(child, tag_keys) or todo
            elif name == "T":
                text = self._text(child, oe.get("style", ""), code=style == "code")
                if text:
                    texts.append(text)
            elif name in _INK_ELEMENTS:
                self.ink_count += 1
            elif name in {"OEChildren", "Table", "Image", *_FILE_ELEMENTS}:
                nested.append(child)

        text = " ".join(texts)
        # Code keeps its leading indentation; everything else is trimmed.
        text = text.rstrip() if style == "code" else text.strip()
        tag_suffix = "".join(f" {{tag:{ONENOTE_TAG_GROUP_ID}/{key}}}" for key in tag_keys)
        child_indent = indent
        if todo is not None:
            checked, created_at, completed_at = todo
            line_text = (" ".join(text.split()) + tag_suffix).strip()
            box = "[x]" if checked else "[ ]"
            if self.in_cell:
                blocks.append(_Block("list", f"{box} {line_text}"))
            else:
                block_ref = f"nn-todo_{uuid.uuid4().hex[:16]}"
                tail = format_todo_tail(line_text or "...", block_ref, created_at, completed_at if checked else None)
                blocks.append(_Block("list", f"{indent}- {box} {tail}"))
            child_indent = indent + "  "
        elif text or tag_suffix:
            content = (text + tag_suffix).strip()
            if list_marker:
                continuation = indent + " " * (len(list_marker) + 1)
                lines = content.split("\n")
                blocks.append(_Block("list", "\n".join([f"{indent}{list_marker} {lines[0]}", *(continuation + line for line in lines[1:])])))
                child_indent = continuation
            elif style in _HEADING_LEVELS and not indent:
                blocks.append(_Block("heading", f"{'#' * _HEADING_LEVELS[style]} {' '.join(content.split())}"))
            elif style == "code" and not indent:
                blocks.append(_Block("code", text))
            elif style in _QUOTE_STYLES and not indent:
                blocks.append(_Block("quote", "\n".join(f"> {line}" for line in content.split("\n"))))
            elif indent:
                blocks.append(_Block("list", "\n".join(indent + line for line in content.split("\n"))))
            else:
                blocks.append(_Block("text", _escape_block_start(content)))
        elif list_marker:
            child_indent = indent + " " * (len(list_marker) + 1)

        for child in nested:
            if _local_name(child) == "OEChildren":
                self._container(child, child_indent, blocks)
            else:
                self._object(child, child_indent, blocks)

    def _tag(self, tag: ET.Element, tag_keys: list[str]) -> tuple[bool, str, str] | None:
        tag_def = self.tag_defs.get(tag.get("index", ""))
        name = " ".join((tag_def.get("name", "") if tag_def is not None else "").split())
        symbol = tag_def.get("symbol", "") if tag_def is not None else ""
        checked = tag.get("completed", "").lower() == "true"
        if checked or tag.get("completionDate") or symbol in _TODO_TAG_SYMBOLS or _TODO_TAG_NAME_PATTERN.search(name):
            return checked, _onenote_timestamp(tag.get("creationDate")), _onenote_timestamp(tag.get("completionDate"))
        key = _onenote_tag_key(name)
        if key:
            self.tags[key] = name
            if key not in tag_keys:
                tag_keys.append(key)
        return None

    def _text(self, element: ET.Element, inherited_style: str, *, code: bool = False) -> str:
        raw = "".join(element.itertext())
        if not raw.strip():
            return ""
        style = ";".join(part for part in (inherited_style, element.get("style", "")) if part)
        return _InlineMarkdown(_apply_style_traits(set(), style), self.resolver).convert(raw, plain=code)

    def _table(self, table: ET.Element) -> str:
        rows: list[list[str]] = []
        for row in table:
            if _local_name(row) != "Row":
                continue
            cells = [self._cell(cell) for cell in row if _local_name(cell) == "Cell"]
            if cells:
                rows.append(cells)
        if not rows:
            return ""
        width = max(len(row) for row in rows)
        normalized = [row + [""] * (width - len(row)) for row in rows]
        lines = ["| " + " | ".join(normalized[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
        lines.extend("| " + " | ".join(row) + " |" for row in normalized[1:])
        return "\n".join(lines)

    def _cell(self, cell: ET.Element) -> str:
        blocks: list[_Block] = []
        previous = self.in_cell
        self.in_cell = True
        try:
            for child in cell:
                if _local_name(child) == "OEChildren":
                    self._container(child, "", blocks)
        finally:
            self.in_cell = previous
        lines: list[str] = []
        for block in blocks:
            lines.extend(line.strip() for line in block.text.split("\n") if line.strip())
        return "<br>".join(lines).replace("|", "\\|")

    def _image(self, image: ET.Element) -> str:
        callback_id = ""
        for child in image:
            if _local_name(child) == "CallbackID":
                callback_id = _clean_optional_text(child.get("callbackID"))
                break
        source = self.media_refs.get(callback_id)
        if not source:
            self.missing_media += 1
            return "_[Bild aus OneNote nicht übernommen]_"
        alt = " ".join(image.get("alt", "").split())
        if not alt or _GENERATED_ALT_TEXT_PATTERN.match(alt):
            alt = "Bild"
        return f"![{_escape_link_label(alt[:120])}]({source})"

    def _file(self, element: ET.Element) -> str:
        ref = self.attachment_refs.get(self.file_ordinals.get(id(element), 0))
        name = " ".join((element.get("preferredName", "") or Path(element.get("pathSource", "")).name or "Anhang").split())
        if not ref:
            self.missing_media += 1
            return f"_[Anhang „{name}“ aus OneNote nicht übernommen]_"
        label, source = ref
        return f"[{_escape_link_label(label or name)}]({source})"


def _list_marker(list_element: ET.Element) -> str:
    for child in list_element:
        name = _local_name(child)
        if name == "Number":
            match = re.fullmatch(r"(\d{1,9})[.)]", child.get("text", "").strip())
            return f"{match.group(1)}." if match else "1."
        if name == "Bullet":
            return "-"
    return "-"


def _onenote_tag_key(name: str) -> str:
    return normalize_tag_id(name.translate(_UMLAUT_TRANSLATION))[:60].strip("-")


def _parse_onenote_datetime(value: Any) -> datetime | None:
    clean = _clean_optional_text(value)
    if not clean:
        return None
    try:
        parsed = datetime.fromisoformat(clean.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    try:
        return parsed.astimezone()
    except (OSError, OverflowError, ValueError):
        return parsed


def _onenote_timestamp(value: Any) -> str:
    parsed = _parse_onenote_datetime(value)
    return parsed.isoformat(timespec="seconds") if parsed else ""


_BLOCK_START_PATTERN = re.compile(r"^(#{1,6}\s|>|\d{1,9}[.)]\s|[-+*]\s)")


def _escape_block_start(text: str) -> str:
    """Keeps plain OneNote paragraphs from turning into headings, quotes or lists in Markdown."""
    return f"\\{text}" if _BLOCK_START_PATTERN.match(text) else text


def _join_blocks(blocks: list[_Block]) -> str:
    lines: list[str] = []
    previous = ""
    for block in blocks:
        if not block.text.strip():
            continue
        if block.kind == "code":
            if previous != "code":
                if lines:
                    lines.append("")
                lines.append("```")
            lines.extend(block.text.split("\n"))
            previous = "code"
            continue
        if previous == "code":
            lines.append("```")
        if lines and not (previous == block.kind and block.kind in {"list", "quote"}):
            lines.append("")
        lines.extend(block.text.split("\n"))
        previous = block.kind
    if previous == "code":
        lines.append("```")
    return "\n".join(lines).strip()


def _apply_style_traits(traits: set[str], style: str | None) -> set[str]:
    for declaration in _clean_optional_text(style).split(";"):
        if ":" not in declaration:
            continue
        key, value = declaration.split(":", 1)
        key = key.strip().lower()
        value = " ".join(value.strip().lower().split())
        if key == "font-weight":
            if value == "bold" or value == "bolder" or (value.isdigit() and int(value) >= 600):
                traits.add("bold")
            elif value == "normal" or (value.isdigit() and int(value) < 600):
                traits.discard("bold")
        elif key == "font-style":
            if "italic" in value or "oblique" in value:
                traits.add("italic")
            elif value == "normal":
                traits.discard("italic")
        elif key == "text-decoration" and "line-through" in value:
            traits.add("strike")
        elif key == "font-family" and any(font in value for font in ("consolas", "courier", "monospace", "lucida console")):
            traits.add("code")
    return traits


@dataclass
class _Run:
    text: str
    traits: frozenset[str]
    link: int | None


_VOID_TAGS = {"br", "img", "wbr", "hr", "meta", "link", "input", "col", "area", "base", "source"}


class _InlineMarkdown(HTMLParser):
    """Converts the HTML fragment inside <one:T> into inline Markdown."""

    def __init__(self, base_traits: set[str], resolver: _LinkResolver | None = None):
        super().__init__(convert_charrefs=True)
        self.base = frozenset(base_traits)
        self.resolver = resolver
        self.stack: list[tuple[str, frozenset[str], int | None]] = []
        self.runs: list[_Run] = []
        self.links: list[str] = []

    def convert(self, fragment: str, *, plain: bool = False) -> str:
        try:
            self.feed(fragment)
            self.close()
        except Exception:  # Malformed fragments fall back to their text instead of failing the page.
            return _clean_lines(unescape(re.sub(r"<[^>]+>", "", fragment)), keep_spaces=plain)
        if plain:
            return _clean_lines("".join(run.text for run in self.runs), keep_spaces=True)
        parts: list[str] = []
        for link, group in groupby(self.runs, key=lambda run: run.link):
            runs = list(group)
            if link is None:
                parts.append(_render_runs(runs, linkify=True))
            else:
                parts.append(self._render_link(self.links[link], _render_runs(runs, linkify=False)))
        return _clean_lines("".join(parts))

    def _current(self) -> tuple[frozenset[str], int | None]:
        if self.stack:
            _tag, traits, link = self.stack[-1]
            return traits, link
        return self.base, None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        traits, link = self._current()
        if tag == "br":
            self.runs.append(_Run("\n", traits, link))
            return
        if tag in _VOID_TAGS:
            return
        attributes = {key.lower(): value or "" for key, value in attrs}
        next_traits = _apply_style_traits(set(traits), attributes.get("style", ""))
        if tag in {"b", "strong"}:
            next_traits.add("bold")
        elif tag in {"i", "em"}:
            next_traits.add("italic")
        elif tag in {"s", "strike", "del"}:
            next_traits.add("strike")
        elif tag in {"code", "tt"}:
            next_traits.add("code")
        elif tag == "a":
            self.links.append(attributes.get("href", ""))
            link = len(self.links) - 1
        self.stack.append((tag, frozenset(next_traits), link))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br":
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        # Tolerates OneNote's occasionally unbalanced markup: close up to the matching tag, ignore strays.
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        traits, link = self._current()
        self.runs.append(_Run(data, traits, link))

    def _render_link(self, href: str, label: str) -> str:
        href = _clean_optional_text(href)
        label = " ".join(label.split())
        if href.lower().startswith("onenote:"):
            target = self.resolver.resolve(href) if self.resolver else None
            if target:
                return _wikilink(target, label)
            title = _onenote_wiki_target_from_href(href)
            # Links to sections or notebooks have no note to point at; keep their text.
            return _wikilink(title, label) if title else label
        scheme = urlparse(href).scheme.lower()
        if not href or not scheme or scheme in _BLOCKED_LINK_SCHEMES:
            return label
        return f"[{_escape_link_label(label or href)}]({_escape_markdown_link_target(href)})"


def _render_runs(runs: list[_Run], *, linkify: bool) -> str:
    merged: list[_Run] = []
    for run in runs:
        if merged and merged[-1].traits == run.traits:
            merged[-1] = _Run(merged[-1].text + run.text, run.traits, run.link)
        else:
            merged.append(run)
    rendered: list[str] = []
    for run in merged:
        segments = []
        for segment in run.text.replace("\xa0", " ").split("\n"):
            match = re.match(r"^(\s*)(.*?)(\s*)$", segment, flags=re.DOTALL)
            lead, core, trail = match.groups() if match else ("", segment, "")
            segments.append(f"{lead}{_wrap_markup(core, run.traits, linkify)}{trail}")
        rendered.append("\n".join(segments))
    return "".join(rendered)


def _wrap_markup(core: str, traits: frozenset[str], linkify: bool) -> str:
    if not core:
        return ""
    if "code" in traits:
        return f"`` {core} ``" if "`" in core else f"`{core}`"
    text = _linkify_plain_urls(core) if linkify else core
    # Markers wrap only visible text; "**Text **" would not render as bold.
    if "strike" in traits:
        text = f"~~{text}~~"
    if "italic" in traits:
        text = f"*{text}*"
    if "bold" in traits:
        text = f"**{text}**"
    return text


def _clean_lines(text: str, *, keep_spaces: bool = False) -> str:
    lines: list[str] = []
    for line in text.replace("\xa0", " ").replace("\r", "").split("\n"):
        clean = line.rstrip() if keep_spaces else " ".join(line.split())
        if clean.strip():
            lines.append(clean)
    return "\n".join(lines)


def _wikilink(target: str, label: str) -> str:
    clean_target = re.sub(r"[\[\]|\n]", " ", target).strip()
    clean_label = " ".join(re.sub(r"[\[\]\n]", " ", label.replace("|", "/").replace("**", "").replace("~~", "").replace("`", "")).split())
    normalized_label = _normalize_wiki_compare(clean_label)
    if (
        not clean_label
        or normalized_label == _normalize_wiki_compare(clean_target)
        or normalized_label == _normalize_wiki_compare(clean_target.rsplit("/", 1)[-1])
    ):
        return f"[[{clean_target}]]"
    return f"[[{clean_target}|{clean_label}]]"


def _linkify_plain_urls(markdown: str) -> str:
    def replace(match: re.Match[str]) -> str:
        url = match.group(0)
        trailing = ""
        while url and url[-1] in ".,;:!?)]}":
            trailing = url[-1] + trailing
            url = url[:-1]
        return f"[{url}]({_escape_markdown_link_target(url)}){trailing}"

    return re.sub(r"(?<![\[(<])https?://[^\s<>\]]+", replace, markdown)


def _escape_link_label(label: str) -> str:
    return label.replace("[", "\\[").replace("]", "\\]")


def _escape_markdown_link_target(target: str | None) -> str:
    return _clean_optional_text(target).replace(" ", "%20").replace("(", "%28").replace(")", "%29")


def _onenote_wiki_target_from_href(href: str | None) -> str:
    clean = _clean_optional_text(href)
    if not clean.lower().startswith("onenote:"):
        return ""
    fragment = clean.split("#", 1)[1] if "#" in clean else ""
    title = unquote(fragment.split("&", 1)[0]).strip()
    title = re.sub(r"\.(one|onepkg)$", "", title, flags=re.IGNORECASE).strip()
    # Section and notebook links start straight with their parameters ("#section-id={...}&end").
    if not title or "=" in title or title.lower() == "end":
        return ""
    return title[:160]


def _normalize_wiki_compare(value: str | None) -> str:
    clean = _clean_optional_text(value).replace("\\", "/")
    clean = clean[:-3] if clean.lower().endswith(".md") else clean
    return clean.lower()


def _rewrite_wikilinks_to_relative_paths(markdown: str, target_map: dict[str, str]) -> str:
    """Points wikilinks typed as page titles ("[[Seite]]") at the imported note path."""
    if not markdown:
        return markdown

    def replace(match: re.Match[str]) -> str:
        raw = match.group(1).strip()
        if not raw:
            return match.group(0)
        target, separator, alias = raw.partition("|")
        clean_target = _normalize_wiki_compare(target)
        relative_target = target_map.get(clean_target)
        clean_alias = _clean_optional_text(alias)
        if not relative_target:
            if separator and clean_alias and _normalize_wiki_compare(clean_alias) == clean_target:
                return f"[[{_clean_optional_text(target)}]]"
            return match.group(0)
        if separator and clean_alias:
            return _wikilink(relative_target, clean_alias)
        return _wikilink(relative_target, target)

    return re.sub(r"\[\[([^\[\]\n]+)\]\]", replace, markdown)


def _read_base64_file(path: Path) -> bytes:
    if path.stat().st_size > MAX_IMAGE_BASE64_BYTES:
        raise ValueError("Ein Medienobjekt ist zu groß.")
    raw = "".join(path.read_text(encoding="ascii", errors="ignore").split())
    if not raw:
        raise ValueError("Leere Bilddaten.")
    try:
        payload = base64.b64decode(raw, validate=True)
    except binascii.Error as exc:
        raise ValueError("Ungültige Base64-Bilddaten.") from exc
    if len(payload) > MAX_IMAGE_BYTES:
        raise ValueError("Ein Medienobjekt ist größer als 20 MB.")
    if not payload:
        raise ValueError("Leere Bilddaten.")
    return payload


def _image_suffix_from_bytes(payload: bytes) -> str:
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if payload.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if payload.startswith(b"GIF87a") or payload.startswith(b"GIF89a"):
        return ".gif"
    if payload.startswith(b"BM"):
        return ".bmp"
    if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
        return ".webp"
    if payload.startswith(b"II*\x00") or payload.startswith(b"MM\x00*"):
        return ".tif"
    if payload.startswith(b"\xd7\xcd\xc6\x9a") or payload.startswith(b"\x01\x00\x00\x00"):
        return ".emf" if payload[40:44] == b" EMF" else ".wmf"
    stripped = payload.lstrip()
    if stripped.startswith(b"<svg") or stripped.startswith(b"<?xml"):
        return ".svg"
    return ".png"


def _powershell_error_detail(output: str) -> str:
    """Keeps the first meaningful line of a PowerShell error instead of the whole CLIXML/stack noise."""
    for line in output.splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#< CLIXML") or clean.startswith("+") or clean.lower().startswith(("in zeile", "at line", "categoryinfo", "fullyqualifiederrorid")):
            continue
        clean = re.sub(r"^.*?\.ps1\s*:\s*", "", clean)
        return clean[:400]
    return ""


def _as_list(value: Any) -> list[Any]:
    # ConvertTo-Json in Windows PowerShell 5.1 turns one-element arrays into plain values.
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _clean_optional_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _decode_process_output(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        for encoding in ("utf-8-sig", "utf-16", "cp1252"):
            try:
                return value.decode(encoding).strip()
            except UnicodeError:
                continue
        return value.decode("utf-8", errors="replace").strip()
    return str(value).strip()
