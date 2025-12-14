import threading

from pydantic_settings import BaseSettings


# Settings synchronization primitives
_settings_lock = threading.RLock()
_settings_version = 0


def load_settings_from_db() -> dict:
    """Load settings from database if available.

    Returns empty dict if DB is not initialized or on error.
    This is called synchronously during settings reload.
    """
    try:
        from .db.core import is_db_initialized, get_session_maker
        from .models import Setting

        if not is_db_initialized():
            return {}

        # Use sync session since this is called during config init
        with get_session_maker()() as session:
            settings_dict = {}
            for setting in session.query(Setting).all():
                settings_dict[setting.key] = setting.value
            return settings_dict
    except Exception:
        return {}


class Settings(BaseSettings):
    # AI Provider: "ollama" or "openai"
    ai_provider: str = "ollama"

    # Ollama settings
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_model: str = "llama3.2"

    # OpenAI settings (if using cloud)
    openai_api_key: str = ""  # Deprecated: now stored in DB via secrets service
    openai_base_url: str = ""  # Custom endpoint for OpenAI-compatible services
    openai_model: str = "gpt-4o-mini"

    # Embedding settings
    embedding_provider: str = "ollama"  # "ollama" or "openai"
    ollama_embedding_model: str = "mxbai-embed-large"
    openai_embedding_model: str = "text-embedding-3-small"

    class Config:
        env_file = ".env"


def create_settings() -> Settings:
    """Create settings instance with DB values overlaid."""
    saved = load_settings_from_db()

    # Construct Settings with DB values, falling back to defaults
    # Note: We pass values directly to constructor because Pydantic models
    # may be frozen and not allow attribute assignment after creation
    return Settings(
        ai_provider=saved.get("ai_provider", "ollama"),
        openai_base_url=saved.get("openai_base_url", ""),
        ollama_model=saved.get("ollama_model", "llama3.2"),
        openai_model=saved.get("openai_model", "gpt-4o-mini"),
        embedding_provider=saved.get("embedding_provider", "ollama"),
        ollama_embedding_model=saved.get("ollama_embedding_model", "mxbai-embed-large"),
        openai_embedding_model=saved.get("openai_embedding_model", "text-embedding-3-small"),
    )


# Global settings instance
settings = create_settings()


def reload_settings() -> int:
    """Reload settings from database.

    Thread-safe reload that returns the new version number.
    The version number can be used by clients for cache invalidation.
    """
    global settings, _settings_version
    with _settings_lock:
        settings = create_settings()
        _settings_version += 1
        return _settings_version


def get_settings_version() -> int:
    """Get current settings version for cache invalidation."""
    return _settings_version


def get_settings_with_version() -> tuple["Settings", int]:
    """Get settings with version for atomic reads."""
    with _settings_lock:
        return settings, _settings_version
