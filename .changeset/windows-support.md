---
"think-app": minor
---

Add Windows support

- Windows NSIS installer with desktop/start menu shortcuts
- Native messaging host registration via `reg.exe` (removed `winreg` dependency)
- Cross-platform Ollama download using native `https` module
- Graceful FTS5 fallback when module unavailable
- Binary mode for salt file to fix Windows password unlock
- Cross-platform build scripts for backend and native stub
