"""Bounded output and disk usage for the Windows OneNote export helper."""
import os
from pathlib import Path
import subprocess
import tempfile
import time


def bounded_export(command, output_dir: Path, cwd: Path, timeout: int, max_output: int, max_disk=1024*1024*1024, max_files=10000):
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        child = subprocess.Popen(command, cwd=str(cwd), stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        started = time.monotonic()
        try:
            while True:
                complete = child.poll() is not None
                if time.monotonic()-started > timeout:
                    raise ValueError('OneNote export exceeded its time limit.')
                if os.fstat(stdout.fileno()).st_size+os.fstat(stderr.fileno()).st_size > max_output:
                    raise ValueError('OneNote export exceeded its output limit.')
                total = count = 0
                for path in output_dir.rglob('*'):
                    if path.is_symlink() or not path.resolve().is_relative_to(output_dir.resolve()):
                        raise ValueError('OneNote export contains an external path.')
                    if path.is_file():
                        total += path.stat().st_size
                        count += 1
                        if total > max_disk or count > max_files:
                            raise ValueError('OneNote export exceeded its extraction limit.')
                if complete:
                    break
                time.sleep(0.2)
            stdout.seek(0); stderr.seek(0)
            return subprocess.CompletedProcess(command, child.returncode, stdout.read(max_output), stderr.read(max_output))
        finally:
            if child.poll() is None:
                if os.name=='nt':
                    # Only the helper process tree created above is terminated.
                    subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW,timeout=10,check=False)
                else:
                    child.kill()
                child.wait(timeout=10)
