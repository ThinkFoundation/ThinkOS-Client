---
"think-app": patch
---

fix(app): use mxbai-embed-large instead of nomic-embed-text in SetupWizard

The SetupWizard was still hardcoded to download nomic-embed-text, which is now
blocked due to crashes on content >5000 chars. Updated to use mxbai-embed-large
to match the backend's default embedding model.
