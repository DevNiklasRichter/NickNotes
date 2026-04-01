# NickNotes MVP (Sprint 1)

Windows-first MVP for a local-first second-brain app with fast capture, automatic tagging suggestions, task extraction, and markdown-based storage.

## Goals of this sprint

- Quick capture for unstructured thoughts
- Markdown files as source of truth (portable vault)
- Local SQLite index for fast search, task views, and tag relations
- Tag groups for:
  - `person`
  - `project`
  - `customer`
  - `machine_no`
  - `machine_type`
- Explicit task creation via `todo:`
- Daily and weekly review board
- Multi-vault support (local folders including OneDrive)

## Architecture

- UI: Python `tkinter` desktop app (runs on Windows now)
- Storage:
  - Vault markdown files for notes/entities/tasks
  - Vault-local SQLite index (`99_system/index.db`)
- Modes:
  - Core mode: local parser and deterministic rules only
  - Smart mode: optional OpenAI-based enrichment (API key required)

The vault format is client-agnostic, so a future Flutter client can read/write the same data model.

## Vault structure

```text
<Vault>/
  00_inbox/
  01_daily/
  02_entities/
    person/
    project/
    customer/
    machine_no/
    machine_type/
  03_tasks/
    open/
    done/
  99_system/
    index.db
    config.json
```

## Quick capture syntax

- Explicit tags in text:
  - `person:max_mustermann`
  - `project:retrofit_line3`
  - `customer:acme`
  - `machine_no:anl_4711`
  - `machine_type:laser_cutter`
- Explicit tasks:

```text
todo: Angebot pruefen | due:2026-04-03 | prio:H | project:retrofit_line3
```

Supported metadata keys: `due`, `prio`/`priority`, `status`, plus tag categories.

## Run

No external dependencies are required for core mode.

```powershell
python main.py
```

Optional smart mode:

1. Set environment variable `OPENAI_API_KEY`
2. Enable smart mode in `<Vault>/99_system/config.json`:

```json
{
  "mode": "smart",
  "openai": {
    "enabled": true,
    "model": "gpt-4.1-mini",
    "api_key_env": "OPENAI_API_KEY"
  }
}
```

## Notes

- This MVP intentionally keeps parsing deterministic and lightweight.
- Reindex is available from the UI when opening copied vaults or after manual edits.
