---
"think-app": patch
---

feat(app): add toggle to enable/disable memory context in chat

- Add "Memory on/off" toggle inside chat input container
- Skip automatic RAG retrieval when toggle is off
- Attached memories still work when toggle is off
- Toggle defaults to on (current behavior preserved)
