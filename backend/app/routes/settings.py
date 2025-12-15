import httpx
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import config
from ..config import reload_settings
from ..db.crud import get_setting, set_setting
from ..models_info import get_context_window


router = APIRouter(prefix="/api", tags=["settings"])


class SettingsUpdate(BaseModel):
    ai_provider: Literal["ollama", "openai"] | None = None
    openai_api_key: str | None = None
    openai_base_url: str | None = None


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


@router.get("/settings")
async def get_settings():
    """Get current AI settings."""
    from ..services.secrets import get_api_key

    api_key = await get_api_key("openai")
    return {
        "ai_provider": config.settings.ai_provider,
        "openai_api_key": "***" if api_key else "",
        "openai_base_url": config.settings.openai_base_url,
        "ollama_model": config.settings.ollama_model,
        "openai_model": config.settings.openai_model,
    }


@router.post("/settings")
async def update_settings(update: SettingsUpdate):
    """Update AI settings."""
    from ..services.secrets import set_api_key

    # Store settings in encrypted database
    if update.ai_provider is not None:
        old_provider = config.settings.ai_provider
        await set_setting("ai_provider", update.ai_provider)
        # Also sync embedding_provider to match ai_provider
        await set_setting("embedding_provider", update.ai_provider)

        # FIX: When provider changes, reset embedding model to new provider's default
        # This prevents invalid combinations like "openai:nomic-embed-text"
        if old_provider != update.ai_provider:
            if update.ai_provider == "openai":
                await set_setting("openai_embedding_model", "text-embedding-3-small")
            else:
                await set_setting("ollama_embedding_model", "mxbai-embed-large")

    if update.openai_base_url is not None:
        await set_setting("openai_base_url", update.openai_base_url)

    # Store API key in database (secure storage via secrets service)
    if update.openai_api_key is not None:
        await set_api_key("openai", update.openai_api_key)

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

    if provider == "ollama":
        model = config.settings.ollama_model
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
        model = config.settings.openai_model
        api_key = await get_api_key("openai")
        has_key = bool(api_key)
        return ProviderStatus(
            provider="openai",
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


# Common OpenAI models to suggest when API doesn't return a list
OPENAI_MODELS = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
]

# OpenAI embedding models
OPENAI_EMBEDDING_MODELS = [
    {"name": "text-embedding-3-small", "dimensions": 1536},
    {"name": "text-embedding-3-large", "dimensions": 3072},
    {"name": "text-embedding-ada-002", "dimensions": 1536},
]

# Known Ollama embedding models
OLLAMA_EMBEDDING_MODELS = [
    "mxbai-embed-large",
    "snowflake-arctic-embed",
]

# Models that should never be shown (known to be broken or impractical)
# nomic-embed-text crashes with EOF on content >5000 chars
# all-minilm has 256 token context - too small for real documents
BLOCKED_EMBEDDING_MODELS = ["nomic-embed-text", "all-minilm"]


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
            print(f"Error fetching Ollama models: {e}")

        return ModelsResponse(
            models=models,
            current_model=config.settings.ollama_model,
            provider="ollama",
        )
    else:
        # OpenAI - try to fetch from API, fall back to common models
        api_key = await get_api_key("openai")
        models = []

        if api_key:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    headers = {"Authorization": f"Bearer {api_key}"}
                    base_url = config.settings.openai_base_url or "https://api.openai.com/v1"
                    response = await client.get(f"{base_url}/models", headers=headers)
                    if response.status_code == 200:
                        data = response.json()
                        for m in data.get("data", []):
                            model_id = m["id"]
                            # Filter to chat models
                            if any(prefix in model_id for prefix in ["gpt-4", "gpt-3.5"]):
                                models.append(ModelInfo(
                                    name=model_id,
                                    is_downloaded=True,
                                    context_window=get_context_window(model_id),
                                ))
            except Exception as e:
                print(f"Error fetching OpenAI models: {e}")

        # Fallback to common models if API call failed or returned empty
        if not models:
            models = [
                ModelInfo(
                    name=m,
                    is_downloaded=True,
                    context_window=get_context_window(m),
                )
                for m in OPENAI_MODELS
            ]

        return ModelsResponse(
            models=models,
            current_model=config.settings.openai_model,
            provider="openai",
        )


@router.post("/settings/model")
async def select_model(request: ModelSelectRequest):
    """Update the selected model for the current provider."""
    # Use provided provider if given, otherwise fall back to saved setting
    provider = request.provider or config.settings.ai_provider

    if provider == "ollama":
        # Reject OpenAI models when using Ollama provider
        if request.model in OPENAI_MODELS:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot use {request.model} with Ollama provider",
            )
        await set_setting("ollama_model", request.model)
    else:
        await set_setting("openai_model", request.model)

    version = reload_settings()
    return {"success": True, "model": request.model, "settings_version": version}


@router.get("/settings/embedding-models")
async def get_embedding_models(provider: str | None = None) -> ModelsResponse:
    """Get available embedding models for the specified or current provider."""
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
            print(f"Error fetching Ollama models: {e}")

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
        # OpenAI embedding models
        models = [
            ModelInfo(
                name=m["name"],
                is_downloaded=True,
                context_window=8191,  # OpenAI embedding context limit
            )
            for m in OPENAI_EMBEDDING_MODELS
        ]

        return ModelsResponse(
            models=models,
            current_model=config.settings.openai_embedding_model,
            provider="openai",
        )


@router.post("/settings/embedding-model")
async def select_embedding_model(request: ModelSelectRequest):
    """Update the selected embedding model for the current provider."""
    provider = config.settings.embedding_provider
    openai_model_names = [m["name"] for m in OPENAI_EMBEDDING_MODELS]

    if provider == "ollama":
        # Reject OpenAI models when provider is Ollama
        if request.model in openai_model_names:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot use {request.model} with Ollama provider",
            )
        await set_setting("ollama_embedding_model", request.model)
    else:
        # Reject non-OpenAI models when provider is OpenAI
        if request.model not in openai_model_names:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot use {request.model} with OpenAI provider",
            )
        await set_setting("openai_embedding_model", request.model)

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
