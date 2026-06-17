from __future__ import annotations

import re
import unittest
from pathlib import Path

from src.backend import contracts


REPO_ROOT = Path(__file__).resolve().parents[3]
TS_CONTRACT_PATH = REPO_ROOT / "src" / "frontend" / "src" / "contracts" / "apiContracts.ts"


def _extract_ts_version(source: str) -> str:
    match = re.search(r"API_CONTRACT_VERSION\s*=\s*['\"]([^'\"]+)['\"]", source)
    return match.group(1) if match else ""


def _extract_ts_sync_types(source: str) -> list[str]:
    match = re.search(r"CONTRACT_SYNC_TYPES\s*=\s*\[(?P<body>.*?)\]\s+as const", source, flags=re.S)
    if not match:
        return []
    return re.findall(r"['\"]([A-Za-z][A-Za-z0-9_]*)['\"]", match.group("body"))


def _extract_ts_aliases(source: str) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for match in re.finditer(r"export\s+type\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\n|$)", source):
        aliases[match.group(1)] = match.group(2)
    return aliases


def _extract_ts_type_body(source: str, type_name: str) -> str | None:
    marker = f"export type {type_name} = "
    start = source.find(marker)
    if start < 0:
        return None
    brace_start = source.find("{", start + len(marker))
    if brace_start < 0:
        return None

    depth = 0
    for index in range(brace_start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
            continue
        if char == "}":
            depth -= 1
            if depth == 0:
                return source[brace_start + 1 : index]
    return None


def _extract_ts_fields(source: str, type_name: str, aliases: dict[str, str]) -> list[str]:
    visited: set[str] = set()
    current_name = type_name
    while current_name in aliases:
        if current_name in visited:
            return []
        visited.add(current_name)
        current_name = aliases[current_name]

    body = _extract_ts_type_body(source, current_name)
    if body is None:
        return []

    fields: list[str] = []
    depth = 0
    for line in body.splitlines():
        stripped = line.strip()
        if depth == 0:
            match = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:", stripped)
            if match:
                fields.append(match.group(1))
        depth += stripped.count("{") - stripped.count("}")
        depth = max(0, depth)
    return fields


def _backend_contract_fields(model_name: str) -> list[str]:
    model = getattr(contracts, model_name)
    fields: list[str] = []
    for name, field in model.model_fields.items():
        fields.append(str(field.alias or name))
    return fields


class ContractSyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ts_source = TS_CONTRACT_PATH.read_text(encoding="utf-8")
        cls.ts_aliases = _extract_ts_aliases(cls.ts_source)

    def test_contract_version_is_shared_between_python_and_typescript(self) -> None:
        self.assertEqual(_extract_ts_version(self.ts_source), contracts.API_CONTRACT_VERSION)

    def test_contract_sync_manifest_is_explicit_on_both_sides(self) -> None:
        backend_types = set(contracts.CONTRACT_SYNC_MODEL_MAP.values())
        frontend_types = set(_extract_ts_sync_types(self.ts_source))
        self.assertEqual(frontend_types, backend_types)

    def test_critical_response_contract_fields_match_typescript_shapes(self) -> None:
        for backend_model_name, frontend_type_name in contracts.CONTRACT_SYNC_MODEL_MAP.items():
            with self.subTest(backend=backend_model_name, frontend=frontend_type_name):
                self.assertEqual(
                    _extract_ts_fields(self.ts_source, frontend_type_name, self.ts_aliases),
                    _backend_contract_fields(backend_model_name),
                )

    def test_forward_compatible_extra_fields_are_documented(self) -> None:
        self.assertEqual(contracts.CONTRACT_EXTRA_POLICY, "allow_forward_compatible_extra_fields")
        self.assertEqual(contracts._ContractModel.model_config.get("extra"), "allow")


if __name__ == "__main__":
    unittest.main()
