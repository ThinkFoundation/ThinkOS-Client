# think-app

## 0.6.1

### Patch Changes

- 7e96c33: Fix code quality issues for release readiness

  - Extract Poppler version to workflow variable to prevent future breakage
  - Create shared useDocumentUpload hook to reduce code duplication
  - Add error logging to Electron temp file cleanup
  - Add empty PDF validation to reject image-only/scanned PDFs
  - Simplify Vite PDF.js worker configuration

## 0.6.0

### Minor Changes

- 16103f3: feat(app): add media memory support for voice memos, audio, and video

  - Add voice memo recording from system tray and main app
  - Add audio file upload with drag-and-drop support
  - Add video file upload with FFmpeg audio extraction and thumbnail generation
  - Add local AI transcription using faster-whisper with timestamp segments
  - Add new memory card components for voice memos, audio, and video
  - Add transcription settings for Whisper model selection
  - Add file size limits and input validation for security

### Patch Changes

- c40f37b: feat(app): add toggle to enable/disable memory context in chat

  - Add "Memory on/off" toggle inside chat input container
  - Skip automatic RAG retrieval when toggle is off
  - Attached memories still work when toggle is off
  - Toggle defaults to on (current behavior preserved)

- bb5ac91: Remove scale transform on memory card hover that caused text to appear blurry

## 0.5.5

### Patch Changes

- cbc0983: Fix Notes editor formatting and title wrapping issues

  - Fix bullet list, numbered list, and blockquote buttons not working (CSS was being purged by Tailwind)
  - Fix H2/H3 heading differentiation (H3 now visually distinct with smaller size and lighter weight)
  - Fix title horizontal scrolling (changed to auto-resizing textarea)
  - Fix Enter key in title to move focus to editor content

## 0.5.4

### Patch Changes

- aacc3bd: Add "View all" and "New Conversation" quick actions to dashboard

  - Added "View all" button to Recent Chats card linking to /chat
  - Renamed "Quick Add" to "Quick Actions" with centered button layout
  - Added "New Conversation" quick action that starts a fresh chat
  - Fixed navigation to ensure new conversations don't auto-load previous chat

- 9f7746e: fix: replace fullscreen icon with panel icon in memory overview

  Replace the misleading Maximize2 (fullscreen) icon with a PanelRight icon on memory cards. The button opens a detail sidebar panel, and the new icon accurately represents this behavior.

- d4dfcc3: fix: require confirmation for memory deletion

  Remove delete button from memory card hover menu. Users must now open the
  detail sidebar panel to delete a memory, which has a confirmation dialog.

- 764021a: feat: add multi-provider support for OpenRouter and Venice

  - Replace generic "Cloud API" with specific provider selection (Ollama, OpenRouter, Venice)
  - Add per-provider model selection with searchable combobox for cloud providers
  - Store separate API keys and model preferences per provider
  - Add migration to convert legacy openai settings to new provider-specific settings
  - Support provider-specific headers and configurations
  - Fix model switching for Venice and OpenRouter providers

- de0c614: feat: add edit button for notes in memory card

  Add a pencil icon button on note memory cards that opens the editor
  directly, without having to go through the detail panel first.

## 0.5.3

### Patch Changes

- bbecd98: Fix Ollama chat models display in settings

  - Add all-minilm to embedding models list to filter it from chat dropdown
  - Add suggested Ollama chat models (llama3.2, mistral, phi3, etc.) as downloadable options

## 0.5.2

### Patch Changes

- 201e269: Add auto-updater for GitHub releases

  - Integrate electron-updater with GitHub releases provider
  - Add app menu with "Check for Updates..." option
  - Show in-app toast notification when update is ready
  - Add "Restart" action to apply downloaded updates

- 27d602f: Fix conversation not appearing in sidebar when starting from home

  - Use refs for event callbacks to prevent SSE reconnection
  - Ensures conversation_created events are properly received

## 0.5.1

### Patch Changes

- 159b7c3: Add lock app functionality to settings page
- 5dec15b: Improve "Add to Chat" to attach memory as context instead of prepopulating message

  - Add AttachedMemoryChips component showing selected memory as removable chip
  - Navigate to /chat instead of / when clicking "Add to Chat"
  - Send attached_memory_ids to backend for explicit context inclusion
  - Label attached memory as "User's Selected Memory" so AI knows which memory user is referring to
  - Preserve attached sources when special handlers run

- bb80b08: Add auto-expanding chat input that grows as users type
- 90f0ec7: Add max width constraint to chat bubbles for consistent column layout
- d0a0da6: Fix HTTP 307 redirect handling in Ollama download for Windows users
- 99257a9: Replace add memory dialog with full-screen TipTap editor

  - Add new TipTap-based NoteEditor component with formatting toolbar
  - Remove AddMemoryDialog in favor of full-screen editing experience
  - Update MemoryDetailPanel to open editor for notes

- 148eb6e: Replace WorkSans font with Inter for better readability
- 98c0214: Add title bar with conversation actions (pin, delete) and improve sidebar icon UX

## 0.5.0

### Minor Changes

- c187deb: Add Windows support

  - Windows NSIS installer with desktop/start menu shortcuts
  - Native messaging host registration via `reg.exe` (removed `winreg` dependency)
  - Cross-platform Ollama download using native `https` module
  - Graceful FTS5 fallback when module unavailable
  - Binary mode for salt file to fix Windows password unlock
  - Cross-platform build scripts for backend and native stub

### Patch Changes

- b0072ec: fix(app): show setup wizard when configured Ollama model is missing

  Fixes #44

  Previously, if Ollama was installed and running but the configured chat model (e.g., llama3.2) wasn't downloaded, the app would skip the setup wizard and fail when trying to chat.

  Now the app checks if the configured model is actually available before skipping the setup wizard. Also improved the model download progress to show user-friendly status messages instead of raw layer hashes.

- e0559e6: Replace unmaintained pysqlcipher3 with rotki-pysqlcipher3

  - `pysqlcipher3` is no longer maintained (last updated 2021)
  - `rotki-pysqlcipher3` is actively maintained with cross-platform wheels
  - Drop-in replacement using the same `pysqlcipher3` import namespace
  - Python version locked to 3.12.x (rotki-pysqlcipher3 wheels only support 3.11-3.12)

## 0.4.0

### Minor Changes

- d0fe719: Chat UX improvements and code quality fixes

  **Chat Experience:**

  - Query rewriting for follow-up messages - better context handling in conversations
  - Special handlers for generic prompts ("summarize recent") using date-based retrieval
  - Dynamic quick prompts based on recent memories and popular tags
  - LLM-generated follow-up suggestions after responses

  **Backend Improvements:**

  - Background job system for re-embedding memories
  - N+1 query optimizations for conversations and memories listing
  - Thread-safe caching for suggestions
  - URL scheme validation for memory creation
  - Timing-attack resistant token comparison

  **Frontend Polish:**

  - Improved SSE streaming with proper buffering
  - Resource cleanup for stream readers
  - Optimized scroll behavior during streaming

- aef4cb5: Improve lock screen setup UX with time-based greeting and clearer instructions

## 0.3.2

### Patch Changes

- dcda806: # RAG Pipeline Improvements & Token Estimation

  ## Frontend Changes

  ### Token Usage Estimation

  - Replaced API-provided token counts with client-side estimation (~4 chars/token)
  - Context usage indicator now shows approximate values with `~` prefix
  - More stable UI without flickering from API response timing

  ### Model Selector Optimization

  - Added provider tracking to prevent unnecessary re-fetches during polling
  - Reduces API calls and eliminates visual flickering

  ## Backend Changes

  ### Improved Memory Filtering

  - Dynamic threshold-based filtering adapts to match quality
  - Tiered filtering: excellent matches allow more results, marginal matches are stricter
  - Skip RAG for very short messages (< 10 chars)

  ### Enhanced Search Pipeline

  - Added match type tracking (vector/keyword/hybrid) and RRF scores
  - Graceful fallback to vector-only search if hybrid fails
  - Comprehensive logging throughout the search pipeline

  ### Embedding Safety

  - Model-specific context windows (Ollama models have smaller limits than documented)
  - Intelligent text chunking with paragraph/sentence awareness
  - Parallel chunk processing with embedding averaging

  ### Other Improvements

  - Blocked `all-minilm` embedding model (context too small)
  - Removed conversation history limit for fuller context
  - Added logging for query transformations

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
