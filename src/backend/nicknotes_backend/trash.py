"""Recoverable folder removal through the Windows Recycle Bin. Never deletes permanently itself."""
from __future__ import annotations

import sys
from pathlib import Path

_FO_DELETE = 0x0003
_FOF_SILENT = 0x0004
_FOF_NOCONFIRMATION = 0x0010
_FOF_ALLOWUNDO = 0x0040
_FOF_NOERRORUI = 0x0400
# Windows itself asks before destroying something the Recycle Bin cannot hold.
_FOF_WANTNUKEWARNING = 0x4000


def move_to_trash(path: Path) -> None:
    """Move one existing folder to the Recycle Bin or raise OSError and leave it in place."""
    target = Path(path).resolve()
    if sys.platform != "win32":
        raise OSError("Der Papierkorb wird nur unter Windows unterstützt.")
    import ctypes
    from ctypes import wintypes

    class _RecycleBinInfo(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("i64Size", ctypes.c_int64), ("i64NumItems", ctypes.c_int64)]

    class _FileOperation(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.WORD),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", wintypes.LPVOID),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    shell32 = ctypes.WinDLL("shell32")
    # Network shares and some removable drives have no Recycle Bin; a delete there would be final.
    info = _RecycleBinInfo(cbSize=ctypes.sizeof(_RecycleBinInfo))
    shell32.SHQueryRecycleBinW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(_RecycleBinInfo)]
    shell32.SHQueryRecycleBinW.restype = ctypes.c_long
    if not target.drive or shell32.SHQueryRecycleBinW(target.anchor, ctypes.byref(info)) != 0:
        raise OSError("Dieser Speicherort hat keinen Papierkorb.")

    operation = _FileOperation(
        wFunc=_FO_DELETE,
        pFrom=str(target) + "\0",  # The API expects a double-null-terminated list.
        fFlags=_FOF_ALLOWUNDO | _FOF_NOCONFIRMATION | _FOF_SILENT | _FOF_NOERRORUI | _FOF_WANTNUKEWARNING,
    )
    shell32.SHFileOperationW.argtypes = [ctypes.POINTER(_FileOperation)]
    shell32.SHFileOperationW.restype = ctypes.c_int
    code = shell32.SHFileOperationW(ctypes.byref(operation))
    if code != 0 or operation.fAnyOperationsAborted or target.exists():
        raise OSError(f"Der Ordner konnte nicht in den Papierkorb verschoben werden (Code {code}).")
