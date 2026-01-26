# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from pathlib import Path

# Find sqlite-vec extension (platform-specific)
import sqlite_vec
sqlite_vec_dir = Path(sqlite_vec.__file__).parent
if sys.platform == 'darwin':
    sqlite_vec_ext = sqlite_vec_dir / 'vec0.dylib'
elif sys.platform == 'win32':
    sqlite_vec_ext = sqlite_vec_dir / 'vec0.dll'
else:
    sqlite_vec_ext = sqlite_vec_dir / 'vec0.so'

# Find faster_whisper assets (VAD model for speech detection)
import faster_whisper
faster_whisper_dir = Path(faster_whisper.__file__).parent
faster_whisper_assets = faster_whisper_dir / 'assets'

# SQLCipher library - only needed on macOS/Linux
# Note: rotki-pysqlcipher3 bundles SQLCipher statically on Windows
sqlcipher_lib = None
if sys.platform == 'darwin':
    # macOS - Homebrew path
    sqlcipher_lib = '/opt/homebrew/lib/libsqlcipher.0.dylib'
    if not os.path.exists(sqlcipher_lib):
        sqlcipher_lib = '/usr/local/lib/libsqlcipher.0.dylib'
elif sys.platform == 'linux':
    # Linux
    sqlcipher_lib = '/usr/lib/libsqlcipher.so.0'
# Windows: rotki-pysqlcipher3 has SQLCipher statically linked, no external DLL needed

binaries = []
if sqlcipher_lib and os.path.exists(sqlcipher_lib):
    binaries.append((sqlcipher_lib, '.'))
if sqlite_vec_ext.exists():
    binaries.append((str(sqlite_vec_ext), 'sqlite_vec'))

datas = []
if faster_whisper_assets.exists():
    datas.append((str(faster_whisper_assets), 'faster_whisper/assets'))

# Poppler binaries for PDF thumbnail generation
# macOS: requires `brew install poppler`
# Windows: download from https://github.com/osborn/poppler-windows/releases
if sys.platform == 'darwin':
    # macOS - bundle Homebrew Poppler
    homebrew_prefix = '/opt/homebrew' if os.path.exists('/opt/homebrew') else '/usr/local'
    poppler_bin = Path(homebrew_prefix) / 'opt' / 'poppler' / 'bin'
    poppler_lib = Path(homebrew_prefix) / 'opt' / 'poppler' / 'lib'
    lcms2_lib = Path(homebrew_prefix) / 'opt' / 'little-cms2' / 'lib'

    # Bundle pdftoppm binary (used by pdf2image)
    pdftoppm = poppler_bin / 'pdftoppm'
    if pdftoppm.exists():
        binaries.append((str(pdftoppm), 'poppler'))

    # Bundle required dylibs
    for lib_dir in [poppler_lib, lcms2_lib]:
        if lib_dir.exists():
            for dylib in lib_dir.glob('*.dylib'):
                if dylib.is_file() and not dylib.is_symlink():
                    binaries.append((str(dylib), 'poppler'))

elif sys.platform == 'win32':
    poppler_path = Path(SPECPATH) / 'poppler-windows' / 'Library' / 'bin'
    if poppler_path.exists():
        # Include all Poppler DLLs and executables
        for file in poppler_path.glob('*'):
            if file.is_file():
                datas.append((str(file), 'poppler'))

a = Analysis(
    ['run.py'],
    pathex=[SPECPATH],
    binaries=binaries,
    datas=datas,
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

# Note: Native messaging stub is now compiled as pure C via 'pnpm build:stub'
# This eliminates the Python.framework dependency that caused Gatekeeper issues on macOS
# See: backend/native_host/stub.c
