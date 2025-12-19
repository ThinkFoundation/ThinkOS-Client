---
"think-extension": patch
---

Add resizable sidepanel that pushes page content aside

- Add draggable resize handle on left edge of panel (300px - 600px range)
- Push webpage content aside when panel opens instead of overlaying
- Persist panel width preference using chrome.storage
