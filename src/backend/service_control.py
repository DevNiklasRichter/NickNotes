"""Lifetime of the per-user service: owner watchdog and graceful shutdown."""
from __future__ import annotations

import os
import sys
import time


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


class ServiceControl:
    """Owner watchdog and graceful shutdown, reachable from the authenticated API."""

    def __init__(self) -> None:
        self.server = None  # uvicorn.Server
        self.owner_pid: int | None = None
        self.version = 'dev'

    def shutdown(self) -> None:
        if self.server:
            self.server.should_exit = True

    def watch(self) -> None:
        while True:
            time.sleep(2)
            owner = self.owner_pid
            if owner and not _process_exists(owner):
                self.shutdown()
                time.sleep(10)
                os._exit(0)  # graceful shutdown hung


control = ServiceControl()


