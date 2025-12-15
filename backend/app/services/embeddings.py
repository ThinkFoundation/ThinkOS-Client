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
# NOTE: Ollama v0.13+ has drastically smaller limits than documented
EMBEDDING_MODEL_CONTEXT = {
    "mxbai-embed-large": 256,        # Documented 8192, actual ~256
    "snowflake-arctic-embed": 256,   # Very conservative
    # OpenAI (these actually work as documented)
    "text-embedding-3-small": 8191,
    "text-embedding-3-large": 8191,
    "text-embedding-ada-002": 8191,
}
DEFAULT_EMBEDDING_CONTEXT = 256  # Very conservative for unknown models
CHARS_PER_TOKEN = 4


def chunk_text(text: str, max_tokens: int) -> list[str]:
    """Split text into chunks that fit within token limit."""
    max_chars = (max_tokens - 50) * CHARS_PER_TOKEN  # Safety margin
    if len(text) <= max_chars:
        return [text]

    chunks = []
    paragraphs = text.split("\n\n")
    current_chunk = ""

    for para in paragraphs:
        if len(current_chunk) + len(para) + 2 <= max_chars:
            current_chunk += ("\n\n" if current_chunk else "") + para
        else:
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = ""
            if len(para) > max_chars:
                # Split long paragraphs by sentences
                sentences = para.replace(". ", ".\n").split("\n")
                for sent in sentences:
                    if len(current_chunk) + len(sent) + 1 <= max_chars:
                        current_chunk += (" " if current_chunk else "") + sent
                    else:
                        if current_chunk:
                            chunks.append(current_chunk)
                            current_chunk = ""
                        # Handle very long sentences by hard-splitting
                        while len(sent) > max_chars:
                            chunks.append(sent[:max_chars])
                            sent = sent[max_chars:]
                        if sent:
                            current_chunk = sent
            else:
                current_chunk = para

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def average_embeddings(embeddings: list[list[float]]) -> list[float]:
    """Average multiple embedding vectors."""
    arr = np.array(embeddings)
    return arr.mean(axis=0).tolist()


async def get_embedding(text: str) -> list[float]:
    """Generate embedding for text using configured provider."""
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

    # Chunk text if needed
    chunks = chunk_text(text, context_tokens)

    # Get embeddings for all chunks in parallel
    if config.settings.embedding_provider == "openai":
        tasks = [_get_openai_embedding(chunk) for chunk in chunks]
    else:
        tasks = [_get_ollama_embedding(chunk) for chunk in chunks]

    embeddings = await asyncio.gather(*tasks)

    # Average embeddings if multiple chunks
    if len(embeddings) == 1:
        return embeddings[0]

    return average_embeddings(list(embeddings))


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
