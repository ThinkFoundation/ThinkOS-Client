---
"think-app": patch
---

feat: add multi-provider support for OpenRouter and Venice

- Replace generic "Cloud API" with specific provider selection (Ollama, OpenRouter, Venice)
- Add per-provider model selection with searchable combobox for cloud providers
- Store separate API keys and model preferences per provider
- Add migration to convert legacy openai settings to new provider-specific settings
- Support provider-specific headers and configurations
- Fix model switching for Venice and OpenRouter providers
