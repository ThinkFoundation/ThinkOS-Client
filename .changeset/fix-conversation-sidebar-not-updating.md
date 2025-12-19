---
"think-app": patch
---

Fix conversation not appearing in sidebar when starting from home

- Use refs for event callbacks to prevent SSE reconnection
- Ensures conversation_created events are properly received
