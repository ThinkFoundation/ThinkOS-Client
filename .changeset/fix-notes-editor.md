---
"think-app": patch
---

Fix Notes editor formatting and title wrapping issues

- Fix bullet list, numbered list, and blockquote buttons not working (CSS was being purged by Tailwind)
- Fix H2/H3 heading differentiation (H3 now visually distinct with smaller size and lighter weight)
- Fix title horizontal scrolling (changed to auto-resizing textarea)
- Fix Enter key in title to move focus to editor content
