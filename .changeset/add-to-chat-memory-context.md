---
"think-app": patch
---

Improve "Add to Chat" to attach memory as context instead of prepopulating message

- Add AttachedMemoryChips component showing selected memory as removable chip
- Navigate to /chat instead of / when clicking "Add to Chat"
- Send attached_memory_ids to backend for explicit context inclusion
- Label attached memory as "User's Selected Memory" so AI knows which memory user is referring to
- Preserve attached sources when special handlers run
