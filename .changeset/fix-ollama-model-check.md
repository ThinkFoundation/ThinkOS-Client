---
"think-app": patch
---

fix(app): show setup wizard when configured Ollama model is missing

Fixes #44

Previously, if Ollama was installed and running but the configured chat model (e.g., llama3.2) wasn't downloaded, the app would skip the setup wizard and fail when trying to chat.

Now the app checks if the configured model is actually available before skipping the setup wizard. Also improved the model download progress to show user-friendly status messages instead of raw layer hashes.
