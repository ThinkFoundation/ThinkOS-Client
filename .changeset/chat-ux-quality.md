---
"think-app": minor
"think-backend": minor
---

Chat UX improvements and code quality fixes

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
