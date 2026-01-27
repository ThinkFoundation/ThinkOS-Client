import asyncio
import logging

import httpx
import numpy as np
from openai import AsyncOpenAI

from ... import config
from ...models_info import get_provider_config
from ..secrets import get_api_key

logger = logging.getLogger(__name__)


def get_current_embedding_model() -> str:
    """Get the current embedding model identifier (provider:model)."""
    provider = config.settings.embedding_provider
    if provider == "ollama":
        return f"ollama:{config.settings.ollama_embedding_model}"
    elif provider == "openrouter":
        return f"openrouter:{config.settings.openrouter_embedding_model}"
    elif provider == "venice":
        return f"venice:{config.settings.venice_embedding_model}"
    return f"{provider}:"


def get_embedding_model_name() -> str:
    """Get just the model name (without provider prefix) for the current provider."""
    provider = config.settings.embedding_provider
    if provider == "ollama":
        return config.settings.ollama_embedding_model
    elif provider == "openrouter":
        return config.settings.openrouter_embedding_model
    elif provider == "venice":
        return config.settings.venice_embedding_model
    return ""


# Context windows for embedding models (in tokens)
# NOTE: Ollama models have smaller practical limits than documented
EMBEDDING_MODEL_CONTEXT = {
    "mxbai-embed-large": 512,
    "snowflake-arctic-embed": 512,
    # OpenAI (these actually work as documented)
    "text-embedding-3-small": 8191,
    "text-embedding-3-large": 8191,
    "text-embedding-ada-002": 8191,
}
DEFAULT_EMBEDDING_CONTEXT = 512
CHARS_PER_TOKEN = 4


def truncate_text(text: str, max_tokens: int) -> str:
    """Truncate text to fit within token limit. Simple and preserves semantic meaning."""
    max_chars = (max_tokens - 50) * CHARS_PER_TOKEN  # Safety margin
    if len(text) <= max_chars:
        return text
    logger.info(f"Truncating text from {len(text)} to {max_chars} chars")
    return text[:max_chars]


async def get_embedding(text: str) -> list[float]:
    """Generate embedding for text using configured provider.

    Uses truncation as a safety net - embedding_summary should always be
    concise enough to not need truncation.
    """
    # Handle empty content
    if not text or not text.strip():
        raise ValueError("Cannot generate embedding for empty text")

    # Get context limit for current model
    model = get_embedding_model_name()
    base_name = model.split(":")[0] if ":" in model else model
    # Also handle provider/model format (e.g., "openai/text-embedding-3-small")
    if "/" in base_name:
        base_name = base_name.split("/")[-1]
    context_tokens = EMBEDDING_MODEL_CONTEXT.get(base_name, DEFAULT_EMBEDDING_CONTEXT)

    # Truncate if needed (safety net - embedding_summary should fit)
    text = truncate_text(text, context_tokens)

    # Get embedding based on provider
    provider = config.settings.embedding_provider
    if provider == "ollama":
        return await _get_ollama_embedding(text)
    else:
        # Cloud provider (openrouter, venice)
        return await _get_cloud_embedding(text, provider)


async def _get_ollama_embedding(text: str, retries: int = 3) -> list[float]:
    """Get embedding from Ollama with retry logic."""
    last_error = None
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "http://localhost:11434/api/embeddings",
                    json={
                        "model": config.settings.ollama_embedding_model,
                        "prompt": text,
                    },
                    timeout=60.0,
                )
                response.raise_for_status()
                return response.json()["embedding"]
        except httpx.HTTPStatusError as e:
            # Capture Ollama's error message from response body
            error_body = ""
            try:
                error_body = e.response.text
            except Exception:
                pass
            logger.warning(
                f"Ollama embedding error (attempt {attempt+1}/{retries}): "
                f"status={e.response.status_code}, body={error_body[:500]}, "
                f"text_len={len(text)}"
            )
            last_error = e
            if attempt < retries - 1:
                # Longer backoff for 500s (model might need time to load)
                delay = 2 * (attempt + 1) if e.response.status_code == 500 else 1 * (attempt + 1)
                await asyncio.sleep(delay)
    raise last_error  # type: ignore


async def _get_cloud_embedding(text: str, provider: str, retries: int = 3) -> list[float]:
    """Get embedding from a cloud provider with retry logic."""
    api_key = await get_api_key(provider)
    if not api_key:
        raise ValueError(f"{provider} API key not configured")

    provider_config = get_provider_config(provider)
    if not provider_config:
        raise ValueError(f"Unknown provider: {provider}")

    model = get_embedding_model_name()
    if not model:
        raise ValueError(f"No embedding model configured for {provider}")

    last_error = None
    for attempt in range(retries):
        try:
            extra_headers = provider_config.get("extra_headers", {})
            client = AsyncOpenAI(
                base_url=provider_config["base_url"],
                api_key=api_key,
                default_headers=extra_headers if extra_headers else None,
            )
            response = await client.embeddings.create(
                model=model,
                input=text,
            )
            return response.data[0].embedding
        except Exception as e:
            last_error = e
            # Log detailed error info
            error_detail = str(e)
            if hasattr(e, 'response'):
                try:
                    error_body = e.response.text if hasattr(e.response, 'text') else str(e.response.content)
                    error_detail = f"status={e.response.status_code}, body={error_body[:500]}"
                except Exception:
                    pass
            logger.error(
                f"Cloud embedding error ({provider}, attempt {attempt+1}/{retries}): {error_detail}"
            )
            if attempt < retries - 1:
                await asyncio.sleep(1 * (attempt + 1))  # Exponential backoff
    raise last_error  # type: ignore


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_np = np.array(a)
    b_np = np.array(b)
    return float(np.dot(a_np, b_np) / (np.linalg.norm(a_np) * np.linalg.norm(b_np)))
