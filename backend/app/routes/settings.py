import logging

import httpx
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import config
from ..config import reload_settings
from ..db.crud import get_setting, set_setting
from ..models_info import get_context_window, CLOUD_PROVIDERS, get_provider_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["settings"])


# Valid provider names
ProviderType = Literal["ollama", "openrouter", "venice"]


class SettingsUpdate(BaseModel):
    ai_provider: ProviderType | None = None
    api_key: str | None = None  # API key for the current/selected provider


class ModelInfo(BaseModel):
    name: str
    size: str | None = None
    is_downloaded: bool = True
    context_window: int


class ModelsResponse(BaseModel):
    models: list[ModelInfo]
    current_model: str
    provider: str


class ModelSelectRequest(BaseModel):
    model: str
    provider: str | None = None  # Optional: use to save to correct provider setting


class OllamaStatus(BaseModel):
    installed: bool
    running: bool


class UserProfile(BaseModel):
    name: str | None = None


class UserProfileUpdate(BaseModel):
    name: str | None = None


class ProviderStatus(BaseModel):
    provider: str
    model: str
    status: str
    status_label: str


async def fetch_models_from_provider(
    provider: str, api_key: str, model_type: str = "chat"
) -> list[dict]:
    """Fetch models from provider with type filtering.

    Args:
        provider: The provider name (openrouter, venice)
        api_key: API key for authentication
        model_type: "chat" or "embedding" - used for provider-specific filtering
    """
    provider_config = get_provider_config(provider)
    if not provider_config:
        return []

    base_url = provider_config["base_url"]
    headers = {}

    # Only add Authorization header if API key is provided
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Add provider-specific headers
    extra_headers = provider_config.get("extra_headers", {})
    if extra_headers:
        headers.update(extra_headers)

    # Build URL with provider-specific paths/params
    url = f"{base_url}/models"
    if provider == "openrouter" and model_type == "embedding":
        # OpenRouter has a separate endpoint for embedding models
        url = f"{base_url}/embeddings/models"
    elif provider == "venice":
        # Venice uses ?type= query param to filter models
        type_param = "embedding" if model_type == "embedding" else "text"
        url = f"{url}?type={type_param}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                logger.warning(f"Error fetching models from {provider}: {response.status_code}")
                return []
            data = response.json()
            return data.get("data", [])
    except Exception as e:
        logger.warning(f"Error fetching models from {provider}: {e}")
        return []


def get_provider_model(provider: str) -> str:
    """Get the current model setting for a provider."""
    if provider == "ollama":
        return config.settings.ollama_model
    elif provider == "openrouter":
        return config.settings.openrouter_model
    elif provider == "venice":
        return config.settings.venice_model
    return ""


def get_provider_embedding_model(provider: str) -> str:
    """Get the current embedding model setting for a provider."""
    if provider == "ollama":
        return config.settings.ollama_embedding_model
    elif provider == "openrouter":
        return config.settings.openrouter_embedding_model
    elif provider == "venice":
        return config.settings.venice_embedding_model
    return ""


@router.get("/settings")
async def get_settings():
    """Get current AI settings."""
    from ..services.secrets import get_api_key

    provider = config.settings.ai_provider
    api_key = await get_api_key(provider) if provider != "ollama" else None

    return {
        "ai_provider": provider,
        "has_api_key": bool(api_key),
        # Provider-specific models
        "ollama_model": config.settings.ollama_model,
        "openrouter_model": config.settings.openrouter_model,
        "venice_model": config.settings.venice_model,
        # Embedding models
        "ollama_embedding_model": config.settings.ollama_embedding_model,
        "openrouter_embedding_model": config.settings.openrouter_embedding_model,
        "venice_embedding_model": config.settings.venice_embedding_model,
    }


@router.get("/settings/has-api-key/{provider}")
async def check_api_key(provider: str):
    """Check if an API key exists for a specific provider."""
    from ..services.secrets import get_api_key

    if provider == "ollama":
        return {"has_api_key": True}  # Ollama doesn't need API key

    api_key = await get_api_key(provider)
    return {"has_api_key": bool(api_key)}


@router.post("/settings")
async def update_settings(update: SettingsUpdate):
    """Update AI settings."""
    from ..services.secrets import set_api_key

    # Store settings in encrypted database
    if update.ai_provider is not None:
        old_provider = config.settings.ai_provider
        new_provider = update.ai_provider

        await set_setting("ai_provider", new_provider)
        # Sync embedding_provider to match ai_provider
        await set_setting("embedding_provider", new_provider)

        # When provider changes, reset embedding model to new provider's default
        if old_provider != new_provider:
            provider_config = get_provider_config(new_provider)
            if new_provider == "ollama":
                await set_setting("ollama_embedding_model", "mxbai-embed-large")
            elif provider_config and provider_config.get("default_embedding_model"):
                default_embedding = provider_config["default_embedding_model"]
                await set_setting(f"{new_provider}_embedding_model", default_embedding)

    # Store API key for the current provider
    if update.api_key is not None:
        provider = update.ai_provider or config.settings.ai_provider
        if provider != "ollama":
            await set_api_key(provider, update.api_key)

    version = reload_settings()
    return {"success": True, "settings_version": version}


@router.get("/settings/ollama-status")
async def get_ollama_status() -> OllamaStatus:
    """Check if Ollama is running."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get("http://localhost:11434/api/tags")
            if response.status_code == 200:
                return OllamaStatus(installed=True, running=True)
    except Exception:
        pass

    return OllamaStatus(installed=False, running=False)


@router.get("/settings/provider-status")
async def get_provider_status() -> ProviderStatus:
    """Get current provider status for sidebar indicator."""
    from ..services.secrets import get_api_key

    provider = config.settings.ai_provider
    model = get_provider_model(provider)

    if provider == "ollama":
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                response = await client.get("http://localhost:11434/api/tags")
                if response.status_code == 200:
                    return ProviderStatus(
                        provider="ollama",
                        model=model,
                        status="running",
                        status_label="Running",
                    )
        except Exception:
            pass
        return ProviderStatus(
            provider="ollama",
            model=model,
            status="offline",
            status_label="Offline",
        )
    else:
        # Cloud provider (openrouter, venice)
        api_key = await get_api_key(provider)
        has_key = bool(api_key)

        provider_config = get_provider_config(provider)
        provider_name = provider_config["name"] if provider_config else provider.capitalize()

        return ProviderStatus(
            provider=provider,
            model=model,
            status="ready" if has_key else "no-key",
            status_label="Ready" if has_key else "No API Key",
        )


@router.get("/settings/profile")
async def get_user_profile() -> UserProfile:
    """Get user profile settings."""
    name = await get_setting("user_name")
    return UserProfile(name=name)


@router.post("/settings/profile")
async def update_user_profile(update: UserProfileUpdate):
    """Update user profile settings."""
    from ..db.crud import delete_setting

    if update.name is not None:
        if update.name.strip():
            await set_setting("user_name", update.name.strip())
        else:
            await delete_setting("user_name")

    return {"success": True}


def _format_size(size_bytes: int | None) -> str | None:
    """Format bytes to human-readable size."""
    if size_bytes is None:
        return None
    size = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


# Known Ollama embedding models
OLLAMA_EMBEDDING_MODELS = [
    "mxbai-embed-large",
    "snowflake-arctic-embed",
    "all-minilm",
]

# Models that should never be shown (known to be broken or impractical)
# nomic-embed-text crashes with EOF on content >5000 chars
# all-minilm has 256 token context - too small for real documents
BLOCKED_EMBEDDING_MODELS = ["nomic-embed-text", "all-minilm"]

# Popular Ollama chat models to suggest for download
OLLAMA_CHAT_MODELS = [
    "llama3.2",
    "llama3.1",
    "mistral",
    "phi3",
    "gemma2",
    "qwen2.5",
    "deepseek-coder",
]


def get_model_context_window(model: dict, provider: str) -> int:
    """Extract context window from model metadata based on provider."""
    # Venice uses availableContextTokens
    if provider == "venice":
        return model.get("availableContextTokens", 8192)
    # OpenRouter uses context_length
    if provider == "openrouter":
        return model.get("context_length", 8192)
    # Fallback to default
    return 8192


def is_embedding_model(model: dict) -> bool:
    """Check if a model is an embedding model based on its metadata."""
    model_id = model.get("id", "")

    # Check common embedding model patterns in ID
    if "embed" in model_id.lower():
        return True
    # Check for OpenAI-style embedding models
    if model_id.startswith("text-embedding"):
        return True

    # Venice: check type field directly
    if model.get("type") == "embedding":
        return True

    # OpenRouter: check architecture.output_modalities
    architecture = model.get("architecture", {})
    output_modalities = architecture.get("output_modalities", [])
    if isinstance(output_modalities, list) and "embedding" in output_modalities:
        return True

    # Check modelType field (case-insensitive)
    model_type_field = model.get("modelType", "")
    if model_type_field.upper() == "EMBEDDING":
        return True

    # Check capabilities if available (fallback)
    capabilities = model.get("capabilities", {})
    if capabilities.get("embedding") and not capabilities.get("chat"):
        return True

    return False


@router.get("/settings/models")
async def get_available_models(provider: str | None = None) -> ModelsResponse:
    """Get available models for the specified or current provider."""
    from ..services.secrets import get_api_key

    # Use query param if provided, otherwise fall back to saved setting
    effective_provider = provider or config.settings.ai_provider

    if effective_provider == "ollama":
        models = []
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get("http://localhost:11434/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    for m in data.get("models", []):
                        name = m["name"]
                        base_name = name.split(":")[0]
                        # Skip embedding models - they shouldn't be used for chat
                        if base_name in OLLAMA_EMBEDDING_MODELS or "embed" in name.lower():
                            continue
                        models.append(ModelInfo(
                            name=name,
                            size=_format_size(m.get("size")),
                            is_downloaded=True,
                            context_window=get_context_window(name),
                        ))
        except Exception as e:
            logger.warning(f"Error fetching Ollama models: {e}")

        # Add suggested chat models that aren't downloaded yet
        downloaded_base_names = {m.name.split(":")[0] for m in models}
        for model_name in OLLAMA_CHAT_MODELS:
            if model_name not in downloaded_base_names:
                models.append(ModelInfo(
                    name=model_name,
                    size=None,
                    is_downloaded=False,
                    context_window=get_context_window(model_name),
                ))

        return ModelsResponse(
            models=models,
            current_model=config.settings.ollama_model,
            provider="ollama",
        )
    else:
        # Cloud provider - fetch models dynamically
        # Note: Venice has a public /models endpoint, so fetch even without API key
        api_key = await get_api_key(effective_provider) or ""
        models = []

        raw_models = await fetch_models_from_provider(
            effective_provider, api_key, model_type="chat"
        )
        for m in raw_models:
            # Only include chat models (skip embedding, TTS, STT, etc.)
            if not is_chat_model(m):
                continue
            model_id = m.get("id", "")
            if model_id:
                # Use provider's context window from API, fallback to our lookup table
                ctx = get_model_context_window(m, effective_provider)
                if ctx == 8192:  # Default fallback, try our lookup table
                    ctx = get_context_window(model_id)
                models.append(ModelInfo(
                    name=model_id,
                    is_downloaded=True,
                    context_window=ctx,
                ))

        # Sort models alphabetically for consistency
        models.sort(key=lambda m: m.name)

        return ModelsResponse(
            models=models,
            current_model=get_provider_model(effective_provider),
            provider=effective_provider,
        )


@router.post("/settings/model")
async def select_model(request: ModelSelectRequest):
    """Update the selected model for the current provider."""
    # Basic validation
    if not request.model or not request.model.strip():
        raise HTTPException(status_code=400, detail="Model name cannot be empty")

    # Use provided provider if given, otherwise fall back to saved setting
    provider = request.provider or config.settings.ai_provider

    # Save to the correct provider-specific setting
    if provider == "ollama":
        await set_setting("ollama_model", request.model)
    elif provider == "openrouter":
        await set_setting("openrouter_model", request.model)
    elif provider == "venice":
        await set_setting("venice_model", request.model)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    version = reload_settings()
    return {"success": True, "model": request.model, "settings_version": version}


def is_chat_model(model: dict) -> bool:
    """Check if a model is a chat model (not an embedding model)."""
    # Check modelType field explicitly (case-insensitive) - "LLM" = chat model
    model_type_field = model.get("modelType", "")
    if model_type_field:
        return model_type_field.upper() == "LLM"

    # Venice: check type field directly
    if model.get("type") == "text":
        return True

    # OpenRouter: check architecture.output_modalities
    architecture = model.get("architecture", {})
    output_modalities = architecture.get("output_modalities", [])
    if isinstance(output_modalities, list) and output_modalities:
        # Chat models output text, not embeddings
        return "text" in output_modalities and "embedding" not in output_modalities

    # Fallback: not an embedding model = chat model
    return not is_embedding_model(model)


@router.get("/settings/embedding-models")
async def get_embedding_models(provider: str | None = None) -> ModelsResponse:
    """Get available embedding models for the specified or current provider."""
    from ..services.secrets import get_api_key

    # Use query param if provided, otherwise fall back to saved setting
    effective_provider = provider or config.settings.embedding_provider

    if effective_provider == "ollama":
        models = []
        downloaded_models = set()

        # Fetch currently downloaded models from Ollama
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get("http://localhost:11434/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    for m in data.get("models", []):
                        name = m["name"]
                        # Check if it's an embedding model (either in our list or name contains 'embed')
                        # but exclude blocked models that are known to be broken
                        base_name = name.split(":")[0]
                        if (base_name in OLLAMA_EMBEDDING_MODELS or "embed" in name.lower()) and base_name not in BLOCKED_EMBEDDING_MODELS:
                            downloaded_models.add(base_name)
                            models.append(ModelInfo(
                                name=name,
                                size=_format_size(m.get("size")),
                                is_downloaded=True,
                                context_window=8192,  # Most embedding models have 8k context
                            ))
        except Exception as e:
            logger.warning(f"Error fetching Ollama models: {e}")

        # Add known embedding models that aren't downloaded
        for model_name in OLLAMA_EMBEDDING_MODELS:
            if model_name not in downloaded_models:
                models.append(ModelInfo(
                    name=model_name,
                    size=None,
                    is_downloaded=False,
                    context_window=8192,
                ))

        return ModelsResponse(
            models=models,
            current_model=config.settings.ollama_embedding_model,
            provider="ollama",
        )
    else:
        # Cloud provider - fetch embedding models dynamically
        # Note: Venice has a public /models endpoint, so fetch even without API key
        api_key = await get_api_key(effective_provider) or ""
        models = []

        raw_models = await fetch_models_from_provider(
            effective_provider, api_key, model_type="embedding"
        )
        for m in raw_models:
            model_id = m.get("id", "")
            if not model_id:
                continue
            # OpenRouter /embeddings/models and Venice ?type=embedding already return only embedding models
            if effective_provider in ("openrouter", "venice") or is_embedding_model(m):
                # Use provider's context window from API
                ctx = get_model_context_window(m, effective_provider)
                models.append(ModelInfo(
                    name=model_id,
                    is_downloaded=True,
                    context_window=ctx,
                ))

        # Sort models alphabetically
        models.sort(key=lambda m: m.name)

        return ModelsResponse(
            models=models,
            current_model=get_provider_embedding_model(effective_provider),
            provider=effective_provider,
        )


@router.post("/settings/embedding-model")
async def select_embedding_model(request: ModelSelectRequest):
    """Update the selected embedding model for the current provider."""
    # Basic validation
    if not request.model or not request.model.strip():
        raise HTTPException(status_code=400, detail="Embedding model name cannot be empty")

    provider = config.settings.embedding_provider

    # Save to the correct provider-specific setting
    if provider == "ollama":
        await set_setting("ollama_embedding_model", request.model)
    elif provider == "openrouter":
        await set_setting("openrouter_embedding_model", request.model)
    elif provider == "venice":
        await set_setting("venice_embedding_model", request.model)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    version = reload_settings()
    return {"success": True, "model": request.model, "settings_version": version}


class EmbeddingModelImpact(BaseModel):
    affected_count: int
    current_model: str


@router.get("/settings/embedding-model-impact")
async def get_embedding_model_impact() -> EmbeddingModelImpact:
    """Get the count of memories that would need re-embedding if model changes."""
    from ..db.crud import count_memories_with_embeddings
    from ..services.embeddings import get_current_embedding_model

    current_model = get_current_embedding_model()
    affected_count = await count_memories_with_embeddings()

    return EmbeddingModelImpact(
        affected_count=affected_count,
        current_model=current_model,
    )
