from __future__ import annotations

import json
import base64
import binascii
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree as ET

from .markdown_io import dump_markdown
from .parser import make_note_id, slugify
from .config import (
    ONENOTE_IMPORT_EXPORT_TIMEOUT_SECONDS,
    ONENOTE_IMPORT_MAX_RESULT_BYTES,
    ONENOTE_IMPORT_MAX_SOURCE_FILE_BYTES,
    ONENOTE_IMPORT_MAX_SOURCE_FILES,
    ONENOTE_IMPORT_MAX_SOURCE_PATH_LENGTH,
)
from .vault import VaultManager


ONEPKG_EXTENSIONS = {".onepkg"}


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

_ONEPKG_EXPORT_POWERSHELL = r"""
param(
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [Parameter(Mandatory=$true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'

function ConvertTo-SafeFileName([string]$Value) {
  $name = if ([string]::IsNullOrWhiteSpace($Value)) { 'Page' } else { $Value.Trim() }
  foreach ($char in [System.IO.Path]::GetInvalidFileNameChars()) {
    $name = $name.Replace($char, '_')
  }
  $name = ($name -replace '\s+', '_').Trim('_')
  if ([string]::IsNullOrWhiteSpace($name)) { $name = 'Page' }
  if ($name.Length -gt 90) { $name = $name.Substring(0, 90) }
  return $name
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

$sectionFiles = @(Get-ChildItem -LiteralPath $extractDir -Recurse -File | Where-Object { $_.Extension -ieq '.one' } | Sort-Object FullName)
if ($sectionFiles.Count -eq 0) {
  throw "Im OneNote-Paket wurden keine .one-Abschnittsdateien gefunden."
}

$oneNote = $null
try {
  $oneNote = New-Object -ComObject OneNote.Application
} catch {
  throw "OneNote Desktop ist nicht als COM-Anwendung verfuegbar. Bitte OneNote Desktop installieren und einmal starten."
}

$resultPages = @()
$warnings = @()
$index = 0
$notebookName = [System.IO.Path]::GetFileNameWithoutExtension($PackagePath)

$notebookId = ''
try {
  $oneNote.OpenHierarchy($extractDir, '', [ref]$notebookId, 0)
  Start-Sleep -Seconds 8
} catch {
  $warnings += "Der entpackte Notebook-Ordner konnte nicht vorinitialisiert werden: $($_.Exception.Message)"
}

foreach ($sectionFile in $sectionFiles) {
  $sectionId = ''
  try {
    $oneNote.OpenHierarchy($sectionFile.FullName, '', [ref]$sectionId, 0)
  } catch {
    $warnings += "Abschnitt '$($sectionFile.Name)' konnte nicht geoeffnet werden: $($_.Exception.Message)"
    continue
  }

  if ([string]::IsNullOrWhiteSpace($sectionId)) {
    $warnings += "Abschnitt '$($sectionFile.Name)' lieferte keine OneNote-ID."
    continue
  }

  $hierarchyXml = ''
  $doc = $null
  $ns = $null
  $pages = $null
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
      $hierarchyXml = ''
      $oneNote.GetHierarchy($sectionId, 4, [ref]$hierarchyXml)
      [xml]$doc = $hierarchyXml
      $namespaceUri = $doc.DocumentElement.NamespaceURI
      $ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
      $ns.AddNamespace('one', $namespaceUri)
      $pages = $doc.SelectNodes('//one:Page', $ns)
      $allPagesAvailable = $doc.DocumentElement.areAllPagesAvailable
      if ($pages -and $pages.Count -gt 0) {
        break
      }
      if ($allPagesAvailable -and [string]$allPagesAvailable -ne 'false') {
        break
      }
    } catch {
      if ($attempt -ge 30) {
        $warnings += "Abschnitt '$($sectionFile.Name)' konnte nicht gelesen werden: $($_.Exception.Message)"
      }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $pages -or $pages.Count -eq 0) {
    $warnings += "Abschnitt '$($sectionFile.Name)' enthaelt keine exportierbaren Seiten oder OneNote hat sie nicht geladen."
    continue
  }

  foreach ($page in $pages) {
    $index += 1
    $title = if ($page.name) { [string]$page.name } else { "Page_$index" }
    $safeTitle = ConvertTo-SafeFileName $title
    $target = Join-Path $OutDir ("{0:D4}_{1}.xml" -f $index, $safeTitle)
    while (Test-Path -LiteralPath $target) {
      $target = Join-Path $OutDir ("{0:D4}_{1}_{2}.xml" -f $index, $safeTitle, [System.Guid]::NewGuid().ToString('N').Substring(0, 6))
    }

    try {
      $pageContent = ''
      $oneNote.GetPageContent($page.ID, [ref]$pageContent, 0)
      $pageContent | Set-Content -LiteralPath $target -Encoding UTF8
    } catch {
      $warnings += "Seite '$title' konnte nicht gelesen werden: $($_.Exception.Message)"
      continue
    }

    $binaryObjects = @()
    try {
      [xml]$pageDoc = $pageContent
      $pageNamespaceUri = $pageDoc.DocumentElement.NamespaceURI
      $pageNs = New-Object System.Xml.XmlNamespaceManager($pageDoc.NameTable)
      $pageNs.AddNamespace('one', $pageNamespaceUri)
      $callbacks = @($pageDoc.SelectNodes('//one:Image/one:CallbackID', $pageNs))
      $binaryDir = Join-Path $OutDir ("{0:D4}_{1}_media" -f $index, $safeTitle)
      $binaryIndex = 0
      foreach ($callback in $callbacks) {
        $callbackId = [string]$callback.callbackID
        if ([string]::IsNullOrWhiteSpace($callbackId)) {
          continue
        }
        $binaryIndex += 1
        try {
          $binaryB64 = ''
          $oneNote.GetBinaryPageContent($page.ID, $callbackId, [ref]$binaryB64)
          if ([string]::IsNullOrWhiteSpace($binaryB64)) {
            continue
          }
          New-Item -ItemType Directory -Force -Path $binaryDir | Out-Null
          $binaryTarget = Join-Path $binaryDir ("image_{0:D3}.b64" -f $binaryIndex)
          $binaryB64 | Set-Content -LiteralPath $binaryTarget -Encoding ASCII
          $binaryObjects += [pscustomobject]@{
            callbackId = $callbackId
            path = $binaryTarget
          }
        } catch {
          $warnings += "Bild $binaryIndex auf Seite '$title' konnte nicht gelesen werden: $($_.Exception.Message)"
        }
      }
    } catch {
      $warnings += "Bildinformationen auf Seite '$title' konnten nicht gelesen werden: $($_.Exception.Message)"
    }

    $sectionParts = @()
    $parent = $page.ParentNode
    while ($parent -and $parent.LocalName -ne 'Notebook' -and $parent.NodeType -ne [System.Xml.XmlNodeType]::Document) {
      if (($parent.LocalName -eq 'Section' -or $parent.LocalName -eq 'SectionGroup') -and $parent.name) {
        $sectionParts = @([string]$parent.name) + $sectionParts
      }
      $parent = $parent.ParentNode
    }
    if ($sectionParts.Count -eq 0) {
      $sectionName = if ($doc.DocumentElement.name) { [string]$doc.DocumentElement.name } else { [System.IO.Path]::GetFileNameWithoutExtension($sectionFile.Name) }
      $sectionParts = @($sectionName)
    }

    $resultPages += [pscustomobject]@{
      path = $target
      title = $title
      notebook = $notebookName
      sections = $sectionParts
      binaryObjects = $binaryObjects
    }
  }
}

$jsonResult = [pscustomobject]@{
  pages = $resultPages
  warnings = $warnings
} | ConvertTo-Json -Depth 8 -Compress
$jsonResult | Set-Content -LiteralPath $ResultPath -Encoding UTF8
Write-Output $jsonResult
"""


@dataclass
class ImportPage:
    source_path: Path
    notebook: str
    section_parts: list[str]
    title: str
    extension: str
    binary_objects: dict[str, Path] = field(default_factory=dict)


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
    def __init__(self, vault: VaultManager, progress_callback: Any | None = None):
        self.vault = vault
        self.progress_callback = progress_callback

    def preview(self, source_paths: list[str]) -> dict[str, Any]:
        clean_sources = self._resolve_source_paths(source_paths)
        preview = ImportPreview(
            sources=[str(path) for path in clean_sources],
            notebooks=len(clean_sources),
            sections=0,
            pages=0,
            media_candidates=0,
            unsupported_files=0,
            warnings=[
                "Die Seitenzahl von .onepkg-Dateien wird erst beim Import ermittelt. Beim Import muss OneNote Desktop installiert sein und darf kurz gestartet werden."
            ],
            pages_preview=[],
        )
        return preview.as_dict()

    def import_sources(self, source_paths: list[str], target_folder: str = "") -> dict[str, Any]:
        clean_sources = self._resolve_source_paths(source_paths)
        self._progress(f"{len(clean_sources)} OneNote-Paketdatei(en) werden gelesen ...", 0, len(clean_sources), None)
        pages: list[ImportPage] = []
        target_base = self._resolve_target_base(target_folder)
        result = ImportResult()

        with tempfile.TemporaryDirectory(prefix="nicknotes_onepkg_") as temp_dir:
            for source_index, package_source in enumerate(clean_sources, start=1):
                try:
                    self._progress(
                        f"{package_source.name} wird ueber OneNote Desktop vorbereitet ({source_index}/{len(clean_sources)}) ...",
                        source_index - 1,
                        len(clean_sources),
                        str(package_source),
                    )
                    exported_pages, export_warnings = self._export_onepkg_with_onenote(package_source, Path(temp_dir))
                except OneNoteImportError as exc:
                    result.skipped_pages += 1
                    result.warnings.append(f"{exc.code}: {exc.message}")
                    continue
                pages.extend(exported_pages)
                result.warnings.extend(export_warnings)
                self._progress(
                    f"{package_source.name} wurde vorbereitet ({source_index}/{len(clean_sources)}) ...",
                    source_index,
                    len(clean_sources),
                    str(package_source),
                )

            if not pages and result.skipped_pages:
                raise OneNoteImportValidationError(
                    "onenote.import.no_pages",
                    "Es wurden keine importierbaren Seiten fuer den OneNote-Import gefunden.",
                    details={"skippedPackages": result.skipped_pages, "warnings": len(result.warnings)},
                )

            planned_note_paths = self._planned_note_paths(pages, target_base)
            wiki_target_map = self._build_import_wiki_target_map(pages, planned_note_paths)
            total_pages = len(pages)
            for page in pages:
                try:
                    self._progress("OneNote-Seiten werden importiert ...", result.imported_pages, total_pages, page.title)
                    note_path, media_count = self._import_page(page, planned_note_paths[page.source_path], wiki_target_map)
                except OSError as exc:
                    result.skipped_pages += 1
                    result.warnings.append(f"{page.source_path}: konnte nicht importiert werden ({exc}).")
                    continue
                result.imported_pages += 1
                result.media_files += media_count
                result.created_notes.append(note_path.relative_to(self.vault.vault_path).as_posix())
                self._progress("OneNote-Seiten werden importiert ...", result.imported_pages, total_pages, page.title)

        self._progress("Importbericht wird geschrieben ...", result.imported_pages, max(result.imported_pages, len(pages)), None)
        result.report_path = self._write_report(clean_sources, target_folder, result)
        return result.as_dict()

    def _resolve_source_paths(self, source_paths: list[str]) -> list[Path]:
        paths: list[Path] = []
        seen: set[str] = set()

        if len(source_paths) > ONENOTE_IMPORT_MAX_SOURCE_FILES:
            raise OneNoteImportValidationError(
                "onenote.import.too_many_sources",
                f"Zu viele Quellpakete ausgewaehlt: max. {ONENOTE_IMPORT_MAX_SOURCE_FILES} erlaubt.",
                details={"maxSources": ONENOTE_IMPORT_MAX_SOURCE_FILES, "provided": len(source_paths)},
            )

        source_index = 0
        for raw_path in source_paths:
            source_index += 1
            clean = str(raw_path or "").strip().strip('"')
            if not clean:
                raise OneNoteImportValidationError(
                    "onenote.import.empty_source",
                    "Leerer Dateipfad wurde uebergeben.",
                    details={"index": source_index},
                )
            path = Path(clean).expanduser().resolve()
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
            if path.is_symlink():
                raise OneNoteImportValidationError(
                    "onenote.import.source_not_supported",
                    f"Symbolische Links sind nicht erlaubt: {path}",
                    details={"path": str(path)},
                )
            if path.is_dir():
                raise OneNoteImportValidationError(
                    "onenote.import.source_is_directory",
                    f"Bitte einzelne .onepkg-Dateien auswaehlen, keine ganzen Ordner: {path}.",
                    details={"path": str(path)},
                )
            if path.suffix.lower() not in ONEPKG_EXTENSIONS:
                raise OneNoteImportValidationError(
                    "onenote.import.invalid_extension",
                    f"Bitte nur OneNote-Paketdateien (.onepkg) auswaehlen: {path}",
                    details={"path": str(path), "extension": path.suffix.lower()},
                )
            try:
                size = path.stat().st_size
            except OSError as exc:
                raise OneNoteImportValidationError(
                    "onenote.import.source_not_accessible",
                    f"Quelle konnte nicht gelesen werden: {path}",
                    details={"path": str(path), "reason": str(exc)},
                )
            if size <= 0:
                raise OneNoteImportValidationError(
                    "onenote.import.source_empty_file",
                    f"Quellpaket ist leer: {path}",
                    details={"path": str(path)},
                )
            if size > ONENOTE_IMPORT_MAX_SOURCE_FILE_BYTES:
                raise OneNoteImportValidationError(
                    "onenote.import.source_too_large",
                    f"Quellpaket ist zu gross: {path}",
                    details={"path": str(path), "sizeBytes": size, "maxBytes": ONENOTE_IMPORT_MAX_SOURCE_FILE_BYTES},
                )
            paths.append(path)

        if not paths:
            raise OneNoteImportValidationError("onenote.import.no_sources", "Bitte mindestens eine .onepkg-Datei auswaehlen.")
        return paths

    def _export_onepkg_with_onenote(self, package_path: Path, temp_root: Path) -> tuple[list[ImportPage], list[str]]:
        package_output_dir = temp_root / self._safe_path_token(package_path.stem)
        package_output_dir.mkdir(parents=True, exist_ok=True)
        script_path = package_output_dir / "export_onepkg.ps1"
        result_path = package_output_dir / "export_result.json"
        script_path.write_text(_ONEPKG_EXPORT_POWERSHELL, encoding="utf-8")

        if len(str(package_path)) > ONENOTE_IMPORT_MAX_SOURCE_PATH_LENGTH:
            raise OneNoteImportValidationError(
                "onenote.import.path_too_long",
                "Der Quellpfad ist zu lang fuer die Verarbeitung.",
                details={"path": str(package_path), "maxLength": ONENOTE_IMPORT_MAX_SOURCE_PATH_LENGTH},
            )

        completed = subprocess.run(
            self._build_export_command(script_path=script_path, package_path=package_path, output_dir=package_output_dir, result_path=result_path),
            cwd=str(self.vault.vault_path),
            capture_output=True,
            timeout=ONENOTE_IMPORT_EXPORT_TIMEOUT_SECONDS,
            check=False,
        )
        if completed.returncode != 0:
            detail = _decode_process_output(completed.stderr or completed.stdout)
            if not detail:
                detail = "OneNote Desktop konnte die Paketdatei nicht exportieren."
            raise OneNoteImportExecutionError(
                "onenote.import.powershell_failed",
                f"{package_path.name}: Import fehlgeschlagen. OneNote Desktop muss installiert sein und das Paket oeffnen koennen.",
                details={
                    "returnCode": completed.returncode,
                    "detail": detail,
                    "packagePath": str(package_path),
                },
            )
        result_payload_size = len(completed.stdout) + len(completed.stderr)
        if result_payload_size > ONENOTE_IMPORT_MAX_RESULT_BYTES:
            raise OneNoteImportExecutionError(
                "onenote.import.result_too_large",
                "OneNote-Export hat zu grosse direkte Ausgabe erzeugt.",
                details={"sizeBytes": result_payload_size, "maxBytes": ONENOTE_IMPORT_MAX_RESULT_BYTES},
            )

        raw_output = ""
        if result_path.exists():
            try:
                raw_output = _clean_optional_text(result_path.read_text(encoding="utf-8-sig"))
            except OSError:
                raw_output = ""
        if not raw_output:
            raw_output = _decode_process_output(completed.stdout)
        if not raw_output:
            detail = _decode_process_output(completed.stderr)
            if detail:
                detail = f" Details: {detail}"
            raise OneNoteImportExecutionError(
                "onenote.import.empty_result",
                f"{package_path.name}: OneNote-Export lieferte keine Ausgabe.",
                details={"packagePath": str(package_path), "detail": detail.strip() or None},
            )
        try:
            payload = json.loads(raw_output)
        except json.JSONDecodeError as exc:
            raise OneNoteImportExecutionError(
                "onenote.import.invalid_result_json",
                f"{package_path.name}: OneNote-Export lieferte keine lesbare Antwort.",
                details={"jsonError": str(exc)},
            ) from exc
        if len(raw_output) > ONENOTE_IMPORT_MAX_RESULT_BYTES:
            raise OneNoteImportExecutionError(
                "onenote.import.result_too_large",
                f"{package_path.name}: OneNote-Export-Resultat war unerwartet gross.",
                details={"sizeBytes": len(raw_output), "maxBytes": ONENOTE_IMPORT_MAX_RESULT_BYTES},
            )

        raw_pages = payload.get("pages", []) if isinstance(payload, dict) else []
        raw_warnings = payload.get("warnings", []) if isinstance(payload, dict) else []
        warning_detail = ""
        if isinstance(raw_warnings, list) and raw_warnings:
            warning_detail = " Details: " + " | ".join(str(warning) for warning in raw_warnings if str(warning).strip())
        if not isinstance(raw_pages, list) or not raw_pages:
            raise OneNoteImportValidationError(
                "onenote.import.no_pages_exported",
                f"{package_path.name}: OneNote Desktop hat keine Seiten aus dem Paket exportiert.{warning_detail}",
                details={"packagePath": str(package_path)},
            )

        pages: list[ImportPage] = []
        package_notebook = self._safe_display_name(package_path.stem)
        package_output_root = package_output_dir.resolve()
        for raw_page in raw_pages:
            if not isinstance(raw_page, dict):
                continue
            raw_exported_path = _clean_optional_text(raw_page.get("path"))
            if not raw_exported_path:
                continue
            try:
                exported_path = Path(raw_exported_path).resolve()
            except OSError:
                continue
            if not self._is_within(package_output_root, exported_path):
                raise OneNoteImportExecutionError(
                    "onenote.import.path_escape",
                    f"{package_path.name}: Exportpfad war unerwartet ausserhalb des Quellordners.",
                    details={"exportPath": raw_exported_path},
                )
            if not exported_path.exists() or exported_path.suffix.lower() != ".xml":
                continue
            notebook = self._safe_display_name(str(raw_page.get("notebook", "")) or package_notebook)
            title = self._safe_display_name(str(raw_page.get("title", "")) or exported_path.stem)
            raw_sections = raw_page.get("sections", [])
            sections = [self._safe_display_name(str(section)) for section in raw_sections if str(section).strip()] if isinstance(raw_sections, list) else []
            binary_objects: dict[str, Path] = {}
            raw_binary_objects = raw_page.get("binaryObjects", [])
            if isinstance(raw_binary_objects, list):
                for raw_binary in raw_binary_objects:
                    if not isinstance(raw_binary, dict):
                        continue
                    callback_id = _clean_optional_text(raw_binary.get("callbackId"))
                    raw_binary_path = _clean_optional_text(raw_binary.get("path"))
                    if not raw_binary_path:
                        continue
                    try:
                        binary_path = Path(raw_binary_path).resolve()
                    except OSError:
                        continue
                    if not self._is_within(package_output_root, binary_path):
                        raise OneNoteImportExecutionError(
                            "onenote.import.path_escape",
                            f"{package_path.name}: Exportpfad fuer Medien war unerwartet ausserhalb des Quellordners.",
                            details={"mediaPath": raw_binary_path},
                        )
                    if callback_id and binary_path.exists():
                        binary_objects[callback_id] = binary_path
            pages.append(
                ImportPage(
                    source_path=exported_path,
                    notebook=notebook,
                    section_parts=sections,
                    title=title,
                    extension=exported_path.suffix.lower(),
                    binary_objects=binary_objects,
                )
            )

        if not pages:
            raise OneNoteImportValidationError(
                "onenote.import.no_pages_importable",
                f"{package_path.name}: OneNote Desktop hat keine importierbaren Seiten erzeugt.",
                details={"packagePath": str(package_path)},
            )

        warnings = [
            f"{package_path.name}: {len(pages)} Seiten ueber OneNote Desktop exportiert. OneNote kann waehrenddessen sichtbar geoeffnet werden."
        ]
        if isinstance(raw_warnings, list):
            warnings.extend(str(warning) for warning in raw_warnings if str(warning).strip())
        return pages, warnings

    @staticmethod
    def _build_export_command(
        *,
        script_path: Path,
        package_path: Path,
        output_dir: Path,
        result_path: Path,
    ) -> list[str]:
        return [
            "powershell.exe",
            "-NoProfile",
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
        clean = target_folder.replace("\\", "/").strip().strip("/")
        if not clean:
            return self.vault.vault_path
        if clean.startswith(".") or clean.startswith("/"):
            raise OneNoteImportValidationError(
                "onenote.import.invalid_target_folder",
                "Der Zielordner muss ein relativer Ordner innerhalb der NoteBase sein.",
                details={"targetFolder": target_folder},
            )
        parts = [self._safe_path_token(part) for part in clean.split("/") if part.strip()]
        if not parts:
            return self.vault.vault_path
        target = self.vault.vault_path.joinpath(*parts).resolve()
        target.relative_to(self.vault.vault_path.resolve())
        if target.name in {self.vault.system_root_name, self.vault.media_root_name}:
            raise OneNoteImportValidationError(
                "onenote.import.reserved_target_folder",
                "System- und Medienordner koennen nicht als Importziel verwendet werden.",
                details={"targetFolder": str(target)},
            )
        target.mkdir(parents=True, exist_ok=True)
        return target

    def _planned_note_paths(self, pages: list[ImportPage], target_base: Path) -> dict[Path, Path]:
        planned: dict[Path, Path] = {}
        reserved: set[str] = set()
        for page in pages:
            note_dir = target_base / self._safe_path_token(page.notebook)
            for section in page.section_parts:
                note_dir = note_dir / self._safe_path_token(section)
            note_stem = self._safe_path_token(page.title) or "OneNote_Seite"
            note_path = self._next_available_path(note_dir, note_stem, ".md", reserved)
            planned[page.source_path] = note_path
            reserved.add(str(note_path.resolve()).lower())
        return planned

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
            relative_target = note_path.relative_to(self.vault.vault_path).as_posix()
            relative_target = relative_target[:-3] if relative_target.lower().endswith(".md") else relative_target
            add(page.title, relative_target)
            add(self._safe_path_token(page.title), relative_target)
        return target_map

    def _import_page(self, page: ImportPage, note_path: Path, wiki_target_map: dict[str, str]) -> tuple[Path, int]:
        media_dir = self.vault.note_media_directory(note_path)
        media_dir.mkdir(parents=True, exist_ok=True)

        note_dir = note_path.parent
        note_dir.mkdir(parents=True, exist_ok=True)

        media_refs, media_count = self._import_page_images(page, media_dir)
        body = _rewrite_wikilinks_to_relative_paths(_onenote_xml_to_markdown(page.source_path, media_refs), wiki_target_map)

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

    def _import_page_images(self, page: ImportPage, media_dir: Path) -> tuple[dict[str, str], int]:
        media_refs: dict[str, str] = {}
        imported = 0
        for index, (callback_id, b64_path) in enumerate(page.binary_objects.items(), start=1):
            try:
                payload = _read_base64_file(b64_path)
            except (OSError, ValueError):
                continue
            suffix = _image_suffix_from_bytes(payload)
            target_path = media_dir / f"image_{index:03d}{suffix}"
            counter = 2
            while target_path.exists():
                target_path = media_dir / f"image_{index:03d}_{counter}{suffix}"
                counter += 1
            target_path.write_bytes(payload)
            media_refs[callback_id] = f"/{target_path.relative_to(self.vault.vault_path).as_posix()}"
            imported += 1
        return media_refs, imported

    def _next_available_path(self, directory: Path, stem: str, suffix: str, reserved: set[str] | None = None) -> Path:
        clean_stem = stem or "item"
        clean_suffix = suffix if suffix.startswith(".") else f".{suffix}"
        candidate = directory / f"{clean_stem}{clean_suffix}"
        counter = 2
        reserved = reserved or set()
        while candidate.exists() or str(candidate.resolve()).lower() in reserved:
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

    def _progress(self, phase: str, processed: int, total: int, current_path: str | None) -> None:
        if self.progress_callback:
            self.progress_callback(phase, processed, total, current_path)


def _local_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1] if "}" in element.tag else element.tag


def _element_text(element: ET.Element) -> str:
    parts: list[str] = []
    for text_node in element.iter():
        if _local_name(text_node) != "T":
            continue
        text = "".join(text_node.itertext())
        text = re.sub(r"<[^>]+>", "", text)
        clean = " ".join(text.split())
        if clean:
            parts.append(clean)
    return " ".join(parts).strip()


def _element_markdown_text(element: ET.Element) -> str:
    parts: list[str] = []
    for text_node in element.iter():
        if _local_name(text_node) != "T":
            continue
        clean = " ".join(_format_onenote_text(text_node).split())
        if clean:
            parts.append(clean)
    return " ".join(parts).strip()


def _table_to_markdown(table: ET.Element) -> str:
    rows: list[list[str]] = []
    for row in table:
        if _local_name(row) != "Row":
            continue
        cells: list[str] = []
        for cell in row:
            if _local_name(cell) != "Cell":
                continue
            cells.append(_element_markdown_text(cell).replace("|", "\\|"))
        if cells:
            rows.append(cells)
    if not rows:
        return ""

    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    header = normalized[0]
    separator = ["---"] * width
    body_rows = normalized[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(separator) + " |",
    ]
    for row in body_rows:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _onenote_xml_to_markdown(path: Path, media_refs: dict[str, str] | None = None) -> str:
    root = ET.fromstring(path.read_text(encoding="utf-8-sig"))
    media_refs = media_refs or {}
    title_text = ""
    blocks: list[str] = []

    for child in root:
        name = _local_name(child)
        if name == "Title":
            title_text = _element_text(child)
            continue
        if name == "Image":
            image_markdown = _image_to_markdown(child, media_refs)
            if image_markdown:
                blocks.append(image_markdown)
            continue
        if name != "Outline":
            continue
        blocks.extend(_outline_to_markdown_blocks(child, media_refs))

    body = _join_onenote_markdown_blocks(blocks)
    if not body:
        body = _element_text(root)
        if title_text and body.startswith(title_text):
            body = body[len(title_text) :].strip()
    return _linkify_plain_urls(body.strip())


def _join_onenote_markdown_blocks(blocks: list[str]) -> str:
    clean_blocks = [block.rstrip() for block in blocks if block.strip()]
    if not clean_blocks:
        return ""

    lines: list[str] = []
    previous_was_list = False
    for block in clean_blocks:
        current_is_list = _is_markdown_list_line(block)
        current_is_table = block.startswith("|")
        previous_is_table = bool(lines and lines[-1].startswith("|"))
        if lines and not (previous_was_list and current_is_list) and not previous_is_table and not current_is_table:
            lines.append("")
        elif lines and (previous_is_table or current_is_table):
            lines.append("")
        lines.extend(block.splitlines())
        previous_was_list = current_is_list
    return "\n".join(lines).strip()


def _is_markdown_list_line(text: str) -> bool:
    return bool(re.match(r"^\s*[-*+]\s+\S", text))


def _linkify_plain_urls(markdown: str) -> str:
    def replace(match: re.Match[str]) -> str:
        url = match.group(0)
        trailing = ""
        while url and url[-1] in ".,;:!?)]}":
            trailing = url[-1] + trailing
            url = url[:-1]
        return f"[{url}]({url}){trailing}"

    return re.sub(r"(?<!\[)(?<!\]\()(?<!\()https?://[^\s<>\]]+", replace, markdown)


def _outline_to_markdown_blocks(outline: ET.Element, media_refs: dict[str, str]) -> list[str]:
    blocks: list[str] = []
    for child in outline:
        if _local_name(child) == "OEChildren":
            blocks.extend(_oe_container_to_markdown_blocks(child, media_refs))
    return blocks


def _oe_container_to_markdown_blocks(container: ET.Element, media_refs: dict[str, str]) -> list[str]:
    blocks: list[str] = []
    for child in container:
        name = _local_name(child)
        if name == "Table":
            markdown_table = _table_to_markdown(child)
            if markdown_table:
                blocks.append(markdown_table)
            continue
        if name != "OE":
            if name == "OEChildren":
                blocks.extend(_oe_container_to_markdown_blocks(child, media_refs))
            elif name == "Image":
                image_markdown = _image_to_markdown(child, media_refs)
                if image_markdown:
                    blocks.append(image_markdown)
            continue
        blocks.extend(_oe_to_markdown_blocks(child, 0, media_refs))
    return blocks


def _oe_to_markdown_blocks(oe: ET.Element, list_depth: int, media_refs: dict[str, str]) -> list[str]:
    blocks: list[str] = []
    direct_texts: list[str] = []
    child_containers: list[ET.Element] = []
    direct_tables: list[ET.Element] = []
    direct_images: list[ET.Element] = []
    is_list_item = False

    for child in oe:
        name = _local_name(child)
        if name == "List":
            is_list_item = True
        elif name == "T":
            text = _format_onenote_text(child, oe.attrib.get("style", ""))
            clean = " ".join(text.split())
            if clean:
                direct_texts.append(clean)
        elif name == "Table":
            direct_tables.append(child)
        elif name == "Image":
            direct_images.append(child)
        elif name == "OEChildren":
            child_containers.append(child)

    text = " ".join(direct_texts).strip()
    if text:
        if is_list_item:
            blocks.append(f"{'  ' * list_depth}- {text}")
        else:
            blocks.append(text)

    for table in direct_tables:
        markdown_table = _table_to_markdown(table)
        if markdown_table:
            blocks.append(markdown_table)

    for image in direct_images:
        image_markdown = _image_to_markdown(image, media_refs)
        if image_markdown:
            blocks.append(image_markdown)

    child_depth = list_depth + 1 if is_list_item else list_depth
    for container in child_containers:
        for child in container:
            name = _local_name(child)
            if name == "Table":
                markdown_table = _table_to_markdown(child)
                if markdown_table:
                    blocks.append(markdown_table)
            elif name == "OEChildren":
                blocks.extend(_oe_container_to_markdown_blocks(child, media_refs))
            elif name == "Image":
                image_markdown = _image_to_markdown(child, media_refs)
                if image_markdown:
                    blocks.append(image_markdown)
            elif name == "OE":
                blocks.extend(_oe_to_markdown_blocks(child, child_depth, media_refs))
    return blocks


def _image_to_markdown(image: ET.Element, media_refs: dict[str, str]) -> str:
    callback_id = ""
    for child in image:
        if _local_name(child) == "CallbackID":
            callback_id = _clean_optional_text(child.attrib.get("callbackID"))
            break
    source = media_refs.get(callback_id)
    if not source:
        return ""
    return f"![OneNote Bild]({source})"


def _format_onenote_text(text_element: ET.Element, inherited_style: str = "") -> str:
    raw_text = "".join(text_element.itertext())
    if not raw_text:
        return ""
    formatted = _OneNoteInlineMarkdown().convert(raw_text)
    style = ";".join(part for part in [inherited_style, text_element.attrib.get("style", "")] if part)
    return _apply_onenote_text_style(formatted, style)


def _apply_onenote_text_style(text: str, style: str | None) -> str:
    clean = _clean_optional_text(text)
    if not clean:
        return ""
    traits = _parse_onenote_style(style)
    if traits.get("bold"):
        clean = f"**{clean}**"
    if traits.get("italic"):
        clean = f"*{clean}*"
    if traits.get("underline"):
        clean = f"<u>{clean}</u>"
    return clean


def _parse_onenote_style(style: str | None) -> dict[str, str | bool]:
    traits: dict[str, str | bool] = {}
    for declaration in _clean_optional_text(style).split(";"):
        if ":" not in declaration:
            continue
        key, value = declaration.split(":", 1)
        key = key.strip().lower()
        value = " ".join(value.strip().split())
        lower_value = value.lower()
        if key == "font-weight" and (lower_value == "bold" or lower_value.isdigit() and int(lower_value) >= 600):
            traits["bold"] = True
        elif key == "font-style" and "italic" in lower_value:
            traits["italic"] = True
        elif key == "text-decoration" and "underline" in lower_value:
            traits["underline"] = True
    return traits


class _OneNoteInlineMarkdown(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.style_stack: list[dict[str, str | bool]] = []
        self.link_stack: list[dict[str, Any]] = []

    def convert(self, fragment: str) -> str:
        self.parts = []
        self.style_stack = []
        self.link_stack = []
        try:
            self.feed(fragment)
            self.close()
        except Exception:
            return re.sub(r"<[^>]+>", "", fragment)
        return "".join(self.parts).strip()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key.lower(): value or "" for key, value in attrs}
        traits = _parse_onenote_style(attr.get("style", ""))
        if tag == "a":
            href = _clean_optional_text(attr.get("href", ""))
            wiki_target = _onenote_wiki_target_from_href(href)
            self.link_stack.append({"href": href, "wiki_target": wiki_target, "start": len(self.parts)})
            if not wiki_target:
                self.parts.append("[")
        if tag in {"strong", "b"}:
            traits["bold"] = True
        elif tag in {"em", "i"}:
            traits["italic"] = True
        elif tag == "u":
            traits["underline"] = True
        self.style_stack.append(traits)
        self.parts.append(self._open_markup(traits))

    def handle_endtag(self, tag: str) -> None:
        traits = self.style_stack.pop() if self.style_stack else {}
        self.parts.append(self._close_markup(traits))
        if tag == "a":
            link = self.link_stack.pop() if self.link_stack else {"href": "", "wiki_target": "", "start": len(self.parts)}
            self._close_link(link)

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def _open_markup(self, traits: dict[str, str | bool]) -> str:
        markers: list[str] = []
        if traits.get("underline"):
            markers.append("<u>")
        if traits.get("italic"):
            markers.append("*")
        if traits.get("bold"):
            markers.append("**")
        return "".join(markers)

    def _close_markup(self, traits: dict[str, str | bool]) -> str:
        markers: list[str] = []
        if traits.get("bold"):
            markers.append("**")
        if traits.get("italic"):
            markers.append("*")
        if traits.get("underline"):
            markers.append("</u>")
        return "".join(markers)

    def _close_link(self, link: dict[str, Any]) -> None:
        href = str(link.get("href", ""))
        wiki_target = str(link.get("wiki_target", ""))
        if wiki_target:
            start = int(link.get("start", len(self.parts)))
            label = "".join(self.parts[start:]).strip()
            del self.parts[start:]
            if label and _normalize_wiki_compare(label) != _normalize_wiki_compare(wiki_target):
                self.parts.append(f"[[{wiki_target}|{label}]]")
            else:
                self.parts.append(f"[[{wiki_target}]]")
            return
        if not href:
            self.parts.append("]")
            return
        self.parts.append(f"]({_escape_markdown_link_target(href)})")


def _escape_markdown_link_target(target: str | None) -> str:
    return _clean_optional_text(target).replace(" ", "%20").replace(")", "%29")


def _onenote_wiki_target_from_href(href: str | None) -> str:
    clean = _clean_optional_text(href)
    if not clean.lower().startswith("onenote:"):
        return ""
    parsed = urlparse(clean)
    fragment = unquote(parsed.fragment or "")
    if not fragment and "#" in clean:
        fragment = unquote(clean.split("#", 1)[1])
    title = fragment.split("&", 1)[0].strip()
    title = title.replace("+", " ")
    title = re.sub(r"\.(one|onepkg)$", "", title, flags=re.IGNORECASE).strip()
    if not title or title.lower() in {"section-id", "page-id"}:
        return ""
    return title[:160]


def _normalize_wiki_compare(value: str | None) -> str:
    clean = _clean_optional_text(value).replace("\\", "/")
    clean = clean[:-3] if clean.lower().endswith(".md") else clean
    return clean.lower()


def _rewrite_wikilinks_to_relative_paths(markdown: str, target_map: dict[str, str]) -> str:
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
        relative_name = relative_target.rsplit("/", 1)[-1]
        if (
            separator
            and clean_alias
            and _normalize_wiki_compare(clean_alias) != _normalize_wiki_compare(relative_target)
            and _normalize_wiki_compare(clean_alias) != _normalize_wiki_compare(relative_name)
        ):
            return f"[[{relative_target}|{clean_alias}]]"
        return f"[[{relative_target}]]"

    return re.sub(r"\[\[([^\[\]\n]+)\]\]", replace, markdown)


def _read_base64_file(path: Path) -> bytes:
    raw = "".join(path.read_text(encoding="ascii", errors="ignore").split())
    if not raw:
        raise ValueError("Leere Bilddaten.")
    try:
        payload = base64.b64decode(raw, validate=True)
    except binascii.Error as exc:
        raise ValueError("Ungueltige Base64-Bilddaten.") from exc
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
    stripped = payload.lstrip()
    if stripped.startswith(b"<svg") or stripped.startswith(b"<?xml"):
        return ".svg"
    return ".png"


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
