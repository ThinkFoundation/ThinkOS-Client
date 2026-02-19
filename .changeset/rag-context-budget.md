---
"think-app": minor
---

Maximize RAG context utilization with dynamic budget system and improve chat UX

- Add dynamic context budget that scales with model context window size
- Widen distance thresholds proportionally when budget allows more content
- Include AI-generated summaries as context overview/fallback for each memory
- Subtract page content from budget in browser extension chat to prevent overflow
- Rewrite system prompt for better grounding and natural source attribution
- Fix missing bullet point markers in chat message markdown rendering
- Remove hover blur effect from assistant chat message bubbles
