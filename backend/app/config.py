import json
from pathlib import Path
from pydantic_settings import BaseSettings


def get_config_path() -> Path:
    """Get path to the settings JSON file."""
    # Use ~/.think for config storage
    config_dir = Path.home() / ".think"
    config_dir.mkdir(exist_ok=True)
    return config_dir / "settings.json"


def load_saved_settings() -> dict:
    """Load settings from JSON file if exists."""
    config_path = get_config_path()
    if config_path.exists():
        try:
            return json.loads(config_path.read_text())
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_settings(updates: dict) -> None:
    """Save settings updates to JSON file."""
    config_path = get_config_path()

    # Load existing settings
    current = load_saved_settings()

    # Merge updates
    current.update(updates)

    # Write back
    config_path.write_text(json.dumps(current, indent=2))


class Settings(BaseSettings):
    # AI Provider: "ollama" or "openai"
    ai_provider: str = "ollama"

    # Ollama settings
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_model: str = "llama3.2"

    # OpenAI settings (if using cloud)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Embedding settings
    embedding_provider: str = "ollama"  # "ollama" or "openai"
    ollama_embedding_model: str = "nomic-embed-text"
    openai_embedding_model: str = "text-embedding-3-small"

    class Config:
        env_file = ".env"


def create_settings() -> Settings:
    """Create settings instance with saved values overlaid."""
    saved = load_saved_settings()

    # Create base settings (from env/.env file)
    base = Settings()

    # Override with saved settings
    if "ai_provider" in saved:
        base.ai_provider = saved["ai_provider"]
    if "openai_api_key" in saved:
        base.openai_api_key = saved["openai_api_key"]

    return base


# Global settings instance
settings = create_settings()


def reload_settings() -> None:
    """Reload settings from file."""
    global settings
    settings = create_settings()
