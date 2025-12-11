# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from pathlib import Path

# Find sqlite-vec dylib
import sqlite_vec
sqlite_vec_dir = Path(sqlite_vec.__file__).parent
sqlite_vec_dylib = sqlite_vec_dir / 'vec0.dylib'

# Detect platform for SQLCipher library
if sys.platform == 'darwin':
    # macOS - Homebrew path
    sqlcipher_lib = '/opt/homebrew/lib/libsqlcipher.0.dylib'
    if not os.path.exists(sqlcipher_lib):
        sqlcipher_lib = '/usr/local/lib/libsqlcipher.0.dylib'
elif sys.platform == 'win32':
    # Windows - adjust path as needed
    sqlcipher_lib = 'C:/sqlcipher/sqlcipher.dll'
else:
    # Linux
    sqlcipher_lib = '/usr/lib/libsqlcipher.so.0'

binaries = []
if os.path.exists(sqlcipher_lib):
    binaries.append((sqlcipher_lib, '.'))
if sqlite_vec_dylib.exists():
    binaries.append((str(sqlite_vec_dylib), 'sqlite_vec'))

a = Analysis(
    ['run.py'],
    pathex=[SPECPATH],
    binaries=binaries,
    datas=[],
    hiddenimports=[
        'app',
        'app.main',
        'app.db',
        'app.ai',
        'app.secrets',
        'app.config',
        'app.models',
        'pysqlcipher3',
        'pysqlcipher3.dbapi2',
        'sqlite_vec',
        'uvicorn.logging',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],  # binaries/datas moved to COLLECT for onedir mode
    exclude_binaries=True,  # Required for COLLECT to work
    name='think-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False if sys.platform == 'darwin' else True,  # UPX breaks code signing on macOS
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Set to False for production
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=os.environ.get('CODESIGN_IDENTITY'),
    entitlements_file='entitlements.plist' if sys.platform == 'darwin' else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False if sys.platform == 'darwin' else True,  # UPX breaks code signing on macOS
    upx_exclude=[],
    name='think-backend',
)

# Native messaging stub for browser extension communication
stub_script = 'native_host/stub_win.py' if sys.platform == 'win32' else 'native_host/stub.py'

stub_a = Analysis(
    [stub_script],
    pathex=[SPECPATH],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

stub_pyz = PYZ(stub_a.pure)

stub_exe = EXE(
    stub_pyz,
    stub_a.scripts,
    stub_a.binaries,
    stub_a.datas,
    [],
    name='think-native-stub',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False if sys.platform == 'darwin' else True,  # UPX breaks code signing on macOS
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # No console window for native host
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=os.environ.get('CODESIGN_IDENTITY'),
    entitlements_file='entitlements.plist' if sys.platform == 'darwin' else None,
)
