"""Backend entry point.

`--service` runs the per-user NickNotes service: it announces port, token and version in
`service.json` (user profile) so the app and the login autostart share one process.
`--owner-pid` ties the service to the app when it should not outlive it.
Without `--service` the server runs in the foreground for development and scripts.
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import sys
import threading
from pathlib import Path

import uvicorn

from .service_control import control


def _option(name: str) -> str | None:
    if name in sys.argv:
        index = sys.argv.index(name)
        return sys.argv[index + 1] if index + 1 < len(sys.argv) else None
    return None


def _version() -> str:
    # The frozen build carries its release version next to the executable.
    marker = Path(sys.executable).with_name('version.txt')
    if getattr(sys, 'frozen', False) and marker.is_file():
        return marker.read_text(encoding='utf-8').strip()
    return 'dev'


def _redirect_output(log_path: Path) -> None:
    # A windowless build has no console; keep a small log instead of losing errors.
    if sys.stdout is not None and sys.stderr is not None:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if log_path.exists() and log_path.stat().st_size > 1024 * 1024:
        log_path.replace(log_path.with_suffix('.old.log'))
    stream = open(log_path, 'a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stdout or stream
    sys.stderr = sys.stderr or stream


def main() -> None:
    from .nicknotes_backend.local_data import user_data_path
    from .nicknotes_backend.file_io import atomic_write_text
    service = '--service' in sys.argv
    port = int(os.environ.get("NICKNOTES_PORT", "8765"))
    info_path = user_data_path() / 'service.json'
    if service:
        _redirect_output(user_data_path() / 'service.log')
        os.environ["NICKNOTES_API_TOKEN"] = secrets.token_urlsafe(32)
        owner = _option('--owner-pid')
        control.owner_pid = int(owner) if owner and owner.isdigit() else None
        control.version = _version()
        threading.Thread(target=control.watch, name="nicknotes-owner-watchdog", daemon=True).start()
    from .api import app
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, access_log=False))
    control.server = server

    async def run():
        task = asyncio.create_task(server.serve())
        while not server.started and not task.done():
            await asyncio.sleep(0.03)
        if server.started and service:
            atomic_write_text(info_path, json.dumps({'port': port, 'pid': os.getpid(), 'token': os.environ["NICKNOTES_API_TOKEN"], 'version': control.version}))
        await task

    try:
        asyncio.run(run())
    finally:
        if service:
            try:
                if json.loads(info_path.read_text(encoding='utf-8')).get('pid') == os.getpid():
                    info_path.unlink()
            except (OSError, ValueError):
                pass


if __name__ == "__main__":
    main()
