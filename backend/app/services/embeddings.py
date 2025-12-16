import asyncio
import logging

import httpx
import numpy as np
from openai import AsyncOpenAI

from .. import config
from .secrets import get_api_key

logger = logging.getLogger(__name__)


def get_current_embedding_model() -> str:
    """Get the current embedding model identifier (provider:model)."""
    if config.settings.embedding_provider == "openai":
        return f"openai:{config.settings.openai_embedding_model}"
    return f"ollama:{config.settings.ollama_embedding_model}"


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
    if config.settings.embedding_provider == "openai":
        model = config.settings.openai_embedding_model
    else:
        model = config.settings.ollama_embedding_model

    base_name = model.split(":")[0]
    context_tokens = EMBEDDING_MODEL_CONTEXT.get(base_name, DEFAULT_EMBEDDING_CONTEXT)

    # Truncate if needed (safety net - embedding_summary should fit)
    text = truncate_text(text, context_tokens)

    # Get embedding
    if config.settings.embedding_provider == "openai":
        return await _get_openai_embedding(text)
    else:
        return await _get_ollama_embedding(text)


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


async def _get_openai_embedding(text: str, retries: int = 3) -> list[float]:
    """Get embedding from OpenAI with retry logic matching Ollama."""
    api_key = await get_api_key("openai") or config.settings.openai_api_key
    if not api_key:
        raise ValueError("OpenAI API key not configured")

    last_error = None
    for attempt in range(retries):
        try:
            if config.settings.openai_base_url:
                client = AsyncOpenAI(
                    base_url=config.settings.openai_base_url,
                    api_key=api_key,
                )
            else:
                client = AsyncOpenAI(api_key=api_key)
            response = await client.embeddings.create(
                model=config.settings.openai_embedding_model,
                input=text,
            )
            return response.data[0].embedding
        except Exception as e:
            last_error = e
            if attempt < retries - 1:
                await asyncio.sleep(1 * (attempt + 1))  # Exponential backoff
    raise last_error  # type: ignore


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_np = np.array(a)
    b_np = np.array(b)
    return float(np.dot(a_np, b_np) / (np.linalg.norm(a_np) * np.linalg.norm(b_np)))
