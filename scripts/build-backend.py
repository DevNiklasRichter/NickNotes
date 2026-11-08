from pathlib import Path
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
build_root=root/'.tmp'/'build-venv'
python=build_root/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
if not python.exists():
    subprocess.run([sys.executable,'-m','venv',str(build_root)],check=True)
subprocess.run([str(python),'-m','pip','install','--disable-pip-version-check','-r',str(root/'requirements-build.txt')],cwd=root,check=True)
subprocess.run([
    str(python), '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console', '--noupx',
    '--name', 'nicknotes-backend', '--paths', str(root),
    '--distpath', str(root / 'dist/backend'), '--workpath', str(root / '.tmp/pyinstaller'),
    '--specpath', str(root / '.tmp/pyinstaller'), str(root / 'src/backend/bootstrap.py'),
], cwd=root, check=True)
subprocess.run([str(python),str(root/'scripts'/'python-notices.py')],cwd=root,check=True)
