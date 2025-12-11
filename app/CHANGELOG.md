# think-app

## 0.1.7

### Patch Changes

- 4646200: Fix "Python.framework is damaged" error on macOS:

  - Rewrite native messaging stub in pure C (no Python dependency)
  - Disable UPX compression (breaks code signing on macOS/Apple Silicon)
  - Add allow-jit entitlement required by Python runtime

  Root cause: Any Python on macOS (Homebrew, system, etc.) loads Python.framework
  which triggers Gatekeeper errors when invoked from Chrome native messaging.
  Solution: Eliminate Python entirely from the native stub.

## 0.1.6

### Patch Changes

- e47fcaa: Fix "Python.framework is damaged" error on macOS:

  - Rewrite native messaging stub in pure C (no Python dependency)
  - Disable UPX compression (breaks code signing on macOS/Apple Silicon)
  - Add allow-jit entitlement required by Python runtime

  Root cause: Any Python on macOS (Homebrew, system, etc.) loads Python.framework
  which triggers Gatekeeper errors when invoked from Chrome native messaging.
  Solution: Eliminate Python entirely from the native stub.

## 0.1.5

### Patch Changes

- dd084da: Fix "Python.framework is damaged" error on macOS:

  - Rewrite native messaging stub in pure C (no Python dependency)
  - Disable UPX compression (breaks code signing on macOS/Apple Silicon)
  - Add allow-jit entitlement required by Python runtime

  Root cause: Any Python on macOS (Homebrew, system, etc.) loads Python.framework
  which triggers Gatekeeper errors when invoked from Chrome native messaging.
  Solution: Eliminate Python entirely from the native stub.

## 0.1.4

### Patch Changes

- 452a836: Fix "Python.framework is damaged" error on macOS:

  - Use PyInstaller-bundled native stub instead of C stub that calls system Python
  - Disable UPX compression (breaks code signing on macOS/Apple Silicon)
  - Add allow-jit entitlement required by Python runtime

  Root cause: The C stub was calling Homebrew's Python which has an unsigned Python.framework.

## 0.1.3

### Patch Changes

- 5cd2a20: Fix Python.framework code signing to resolve "damaged" error on macOS

## 0.1.2

### Patch Changes

- 96a56b5: Fix Python.framework signing in CI builds by preserving CODESIGN_IDENTITY environment variable

## 0.1.1

### Patch Changes

- 2f04809: fix(build): preserve CODESIGN_IDENTITY from CI environment

  The build:backend script was overwriting the CODESIGN_IDENTITY environment variable by reading from .env.local (which doesn't exist in CI). This caused dylib signing to be skipped, resulting in "Python.framework is damaged" Gatekeeper errors when opening the app downloaded from GitHub releases.

  Changed from `export CODESIGN_IDENTITY="$(grep ...)"` to `CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-$(grep ...)}"` to preserve the CI-provided environment variable.
