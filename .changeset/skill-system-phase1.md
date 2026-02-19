---
"think-app": minor
---

Add skill system with built-in skills, editor, triggers, and chat integration

- Add skills, skill_executions, and skill_triggers database tables
- Add 3 built-in skills: Extract Action Items, Generate Insights, Export to Markdown
- Add skill registry with validation and built-in skill seeding
- Add skill executor with content extraction, template rendering, and LLM streaming
- Add full CRUD API for user-created skills (create, update, delete, toggle)
- Add skill editor with two-column layout, emoji picker, logo upload
- Add skill import/export via .think-skill JSON format with validation
- Add skill test runner with live SSE streaming preview
- Add execution history with filtering by skill, status, and search
- Add skill detail panel with recent executions and clickable memory links
- Add trigger engine for automatic skill execution on memory save
- Add trigger condition builder with field/operator/value rules and AND/OR logic
- Add trigger preview with match ratio bar and memory type indicators
- Add chat-based skill suggestions via pattern matching on message context
- Add ChatSkillChips and ChatSkillResult components for in-chat skill execution
- Add SSE streaming for chat skill results with real-time token updates
- Respect output_format field during execution (plain, json, html, markdown)
- Hide incompatible skills from selection list
- Integrate skill results section into MemoryDetailPanel
