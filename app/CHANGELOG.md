# think-app

## 0.3.1

### Patch Changes

- 586e850: fix(app): show reembed dialog when embedding model changes regardless of affected count
- af401ff: fix(app): use mxbai-embed-large instead of nomic-embed-text in SetupWizard

  The SetupWizard was still hardcoded to download nomic-embed-text, which is now
  blocked due to crashes on content >5000 chars. Updated to use mxbai-embed-large
  to match the backend's default embedding model.

- 97ff418: fix(backend): correct API route order for stale-embeddings-count endpoint

## 0.3.0

### Minor Changes

- 037f628: Add chat UX improvements and conversation pinning

  - Conversation pinning with backend support and SSE events
  - Conversation grouping by time (Today, Yesterday, Previous 7 days, etc.)
  - Conversation search in sidebar
  - Glassmorphism design tokens for consistent styling
  - Copy message action on hover for assistant messages
  - Collapsible sources panel
  - Toast notifications with sonner
  - Quick prompts for empty chat and suggested follow-ups
  - Markdown rendering in extension sidebar
  - Updated fonts in extension to match app styling

## 0.2.0

### Minor Changes

- cfcdd6e: Add Work Sans body font and Goudy Bookletter 1911 heading font
- ed97c37: feat: add provider switching and context usage tracking

  ## Provider Switching

  - Switch between Ollama (local) and OpenAI (cloud) providers
  - Separate selection for chat and embedding models
  - Provider status indicator in sidebar showing connection state
  - Auto-sync embedding provider when AI provider changes
  - Validate provider/model combinations to prevent invalid configs

  ## Context Usage Tracking

  - Real-time token usage indicator with circular progress ring
  - Color-coded usage levels (green → yellow → orange → red)
  - Hover popover showing current context and session totals
  - Track prompt, completion, and total tokens per message

  ## Model Management

  - Model selector component with download support for Ollama
  - Display model context window sizes
  - Block known broken models (nomic-embed-text)
  - Reset to default model when switching providers

  ## Re-embedding System

  - Background job system for re-embedding memories when model changes
  - Progress tracking with cancellation support
  - Smart detection of stale embeddings by model mismatch
  - Warning dialog showing affected memory count before changes

  ## Backend Changes

  - Database-backed settings with thread-safe reloading
  - Token usage columns on messages table
  - Embedding model tracking on memories table
  - Jobs table for background task management
  - Model context window metadata registry

- f9f86d0: Add sidebar chat feature to browser extension

  - Add chat sidebar that can be opened from extension popup to chat with AI about current page
  - Integrate with saved memories for context-aware responses
  - Add background service worker for native messaging from content scripts
  - Support saving conversations and generating AI summaries as memories
  - Add CORS preflight handling for extension requests

- a752be6: Add dedicated chat page accessible from sidebar with conversation history

### Patch Changes

- f8054bc: Fix "New Chat" button immediately reloading previous conversation
- 2183767: Update application icon
- b7865b3: fix(app): apply macOS squircle mask to app icon for proper rounded corners

## 0.1.8

### Patch Changes

- 88ef236: Fix "Python.framework is damaged" error on macOS:

  - Rewrite native messaging stub in pure C (no Python dependency)
  - Fix electron-builder extraResources to bundle C stub in app
  - Remove outdated PyInstaller stub configuration
  - Disable UPX compression (breaks code signing on macOS/Apple Silicon)
  - Add allow-jit entitlement required by Python runtime

  Root cause: Any Python on macOS (Homebrew, system, etc.) loads Python.framework
  which triggers Gatekeeper errors when invoked from Chrome native messaging.
  Solution: Eliminate Python entirely from the native stub.

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
