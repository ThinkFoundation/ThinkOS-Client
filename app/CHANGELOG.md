# think-app

## 0.1.1

### Patch Changes

- 2f04809: fix(build): preserve CODESIGN_IDENTITY from CI environment

  The build:backend script was overwriting the CODESIGN_IDENTITY environment variable by reading from .env.local (which doesn't exist in CI). This caused dylib signing to be skipped, resulting in "Python.framework is damaged" Gatekeeper errors when opening the app downloaded from GitHub releases.

  Changed from `export CODESIGN_IDENTITY="$(grep ...)"` to `CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-$(grep ...)}"` to preserve the CI-provided environment variable.
