---
"think-app": patch
---

Fix "Python.framework is damaged" error on macOS:
- Use PyInstaller-bundled native stub instead of C stub that calls system Python
- Disable UPX compression (breaks code signing on macOS/Apple Silicon)
- Add allow-jit entitlement required by Python runtime

Root cause: The C stub was calling Homebrew's Python which has an unsigned Python.framework.
