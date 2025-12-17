# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Windows native messaging stub.
Builds stub_win.py into a standalone executable for browser extension communication.
"""

a = Analysis(
    ['stub_win.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'win32file',
        'win32pipe',
        'pywintypes',
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
    a.binaries,
    a.datas,
    [],
    name='think-native-stub',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Hide console window for native messaging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    onefile=True,  # Single EXE for easier bundling
)
