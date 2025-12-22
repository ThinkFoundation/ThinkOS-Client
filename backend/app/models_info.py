"""Model metadata including context window sizes and provider configurations."""

from typing import TypedDict


class ProviderConfig(TypedDict, total=False):
    """Configuration for a cloud AI provider."""

    base_url: str
    name: str
    description: str
    default_chat_model: str | None
    default_embedding_model: str | None
    extra_headers: dict[str, str]


# Cloud provider configurations
CLOUD_PROVIDERS: dict[str, ProviderConfig] = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "name": "OpenRouter",
        "description": "Access 500+ AI models",
        "default_chat_model": "anthropic/claude-sonnet-4",
        "default_embedding_model": "openai/text-embedding-3-small",
        "extra_headers": {
            "HTTP-Referer": "https://thinkos.app",
            "X-Title": "ThinkOS",
        },
    },
    "venice": {
        "base_url": "https://api.venice.ai/api/v1",
        "name": "Venice",
        "description": "Private, uncensored AI",
        "default_chat_model": "qwen3-235b",
        "default_embedding_model": None,
    },
}


def get_provider_config(provider: str) -> ProviderConfig | None:
    """Get configuration for a cloud provider."""
    return CLOUD_PROVIDERS.get(provider)


def get_provider_base_url(provider: str) -> str | None:
    """Get base URL for a provider."""
    config = CLOUD_PROVIDERS.get(provider)
    return config["base_url"] if config else None


# Context window sizes for common models (in tokens)
MODEL_CONTEXT_WINDOWS = {
    # Ollama / Llama models
    "llama3.2": 128000,
    "llama3.2:1b": 128000,
    "llama3.2:3b": 128000,
    "llama3.1": 128000,
    "llama3": 8192,
    "llama2": 4096,
    # Mistral models
    "mistral": 32768,
    "mixtral": 32768,
    "mistral-nemo": 128000,
    # Other Ollama models
    "codellama": 16384,
    "phi3": 128000,
    "phi3:mini": 128000,
    "gemma2": 8192,
    "gemma": 8192,
    "qwen2": 32768,
    "qwen2.5": 32768,
    "deepseek-coder": 16384,
    # OpenAI models
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4-turbo-preview": 128000,
    "gpt-4": 8192,
    "gpt-4-32k": 32768,
    "gpt-3.5-turbo": 16385,
    "gpt-3.5-turbo-16k": 16385,
    # Claude models (for OpenAI-compatible APIs)
    "claude-3-opus": 200000,
    "claude-3-sonnet": 200000,
    "claude-3-haiku": 200000,
    "claude-3.5-sonnet": 200000,
}

DEFAULT_CONTEXT_WINDOW = 4096


def get_context_window(model_name: str) -> int:
    """Get context window size for a model, falling back to default."""
    if not model_name:
        return DEFAULT_CONTEXT_WINDOW

    # Handle provider prefix (e.g., "openai/gpt-4o" -> "gpt-4o")
    if "/" in model_name:
        model_name = model_name.split("/")[-1]

    # Try exact match first
    if model_name in MODEL_CONTEXT_WINDOWS:
        return MODEL_CONTEXT_WINDOWS[model_name]

    # Handle model variants (e.g., "llama3.2:latest" -> "llama3.2")
    base_name = model_name.split(":")[0]
    if base_name in MODEL_CONTEXT_WINDOWS:
        return MODEL_CONTEXT_WINDOWS[base_name]

    # Try removing version suffixes (e.g., "gpt-4-0125-preview" -> "gpt-4")
    parts = base_name.split("-")
    for i in range(len(parts), 0, -1):
        partial = "-".join(parts[:i])
        if partial in MODEL_CONTEXT_WINDOWS:
            return MODEL_CONTEXT_WINDOWS[partial]

    return DEFAULT_CONTEXT_WINDOW
