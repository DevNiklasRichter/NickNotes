from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time

import uvicorn


def _process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes
        except ImportError:
            return True

        process_query_limited_information = 0x1000
        still_active = 259
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return False
        exit_code = ctypes.c_ulong()
        try:
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return False
            return int(exit_code.value) == still_active
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _start_parent_watchdog() -> None:
    raw_parent_pid = os.environ.get("NICKNOTES_PARENT_PID", "").strip()
    if not raw_parent_pid:
        return
    try:
        parent_pid = int(raw_parent_pid)
    except ValueError:
        return
    if parent_pid <= 0:
        return

    def watch_parent() -> None:
        while True:
            time.sleep(2)
            if not _process_exists(parent_pid):
                os._exit(0)

    thread = threading.Thread(target=watch_parent, name="nicknotes-parent-watchdog", daemon=True)
    thread.start()


def main() -> None:
    desktop = os.environ.get("NICKNOTES_DESKTOP_BOOT") == "1"
    if desktop:
        boot = json.loads(sys.stdin.readline())
        os.environ["NICKNOTES_API_TOKEN"] = boot["token"]
        os.environ["NICKNOTES_PARENT_PID"] = str(boot["parent_pid"])
        os.environ["NICKNOTES_USER_DATA"] = boot["user_data"]
        port = int(boot["port"])
    else:
        port = int(os.environ.get("NICKNOTES_PORT", "8765"))
    _start_parent_watchdog()
    from .api import app
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, access_log=False))
    if desktop:
        def control():
            for line in sys.stdin:
                try:
                    if json.loads(line).get("command") == "shutdown":
                        server.should_exit = True
                        return
                except (ValueError, AttributeError):
                    continue
            server.should_exit = True
        threading.Thread(target=control, name="nicknotes-control", daemon=True).start()
    async def run():
        task = asyncio.create_task(server.serve())
        while not server.started and not task.done():
            await asyncio.sleep(0.03)
        if server.started:
            print(json.dumps({"event": "ready", "port": port}), flush=True)
        await task
    asyncio.run(run())


if __name__ == "__main__":
    main()
