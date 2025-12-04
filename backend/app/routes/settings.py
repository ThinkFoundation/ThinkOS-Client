import json
import httpx
from pathlib import Path
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel

from ..config import settings, get_config_path, save_settings, reload_settings


router = APIRouter(prefix="/api", tags=["settings"])


class SettingsUpdate(BaseModel):
    ai_provider: Literal["ollama", "openai"] | None = None
    openai_api_key: str | None = None


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
    return {
        "ai_provider": settings.ai_provider,
        "openai_api_key": "***" if settings.openai_api_key else "",
        "ollama_model": settings.ollama_model,
        "openai_model": settings.openai_model,
    }


@router.post("/settings")
async def update_settings(update: SettingsUpdate):
    """Update AI settings."""
    changes = {}

    if update.ai_provider is not None:
        changes["ai_provider"] = update.ai_provider

    if update.openai_api_key is not None:
        changes["openai_api_key"] = update.openai_api_key

    if changes:
        save_settings(changes)
        reload_settings()

    return {"success": True}


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
    provider = settings.ai_provider

    if provider == "ollama":
        model = settings.ollama_model
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
        model = settings.openai_model
        has_key = bool(settings.openai_api_key)
        return ProviderStatus(
            provider="openai",
            model=model,
            status="ready" if has_key else "no-key",
            status_label="Ready" if has_key else "No API Key",
        )


@router.get("/settings/profile")
async def get_user_profile() -> UserProfile:
    """Get user profile settings."""
    from ..db.crud import get_setting

    name = await get_setting("user_name")
    return UserProfile(name=name)


@router.post("/settings/profile")
async def update_user_profile(update: UserProfileUpdate):
    """Update user profile settings."""
    from ..db.crud import set_setting, delete_setting

    if update.name is not None:
        if update.name.strip():
            await set_setting("user_name", update.name.strip())
        else:
            await delete_setting("user_name")

    return {"success": True}
