from pydantic_settings import BaseSettings

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


settings = Settings()
