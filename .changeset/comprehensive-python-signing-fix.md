---
"think-app": patch
---

Fix "Python.framework is damaged" error on macOS:
- Rewrite native messaging stub in pure C (no Python dependency)
- Disable UPX compression (breaks code signing on macOS/Apple Silicon)
- Add allow-jit entitlement required by Python runtime

Root cause: Any Python on macOS (Homebrew, system, etc.) loads Python.framework
which triggers Gatekeeper errors when invoked from Chrome native messaging.
Solution: Eliminate Python entirely from the native stub.
