# think-extension

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

## 0.3.2

## 0.3.1

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

- f9f86d0: Add sidebar chat feature to browser extension

  - Add chat sidebar that can be opened from extension popup to chat with AI about current page
  - Integrate with saved memories for context-aware responses
  - Add background service worker for native messaging from content scripts
  - Support saving conversations and generating AI summaries as memories
  - Add CORS preflight handling for extension requests

## 0.1.8

## 0.1.7

## 0.1.6

## 0.1.5

## 0.1.4

## 0.1.3

## 0.1.2

## 0.1.1
