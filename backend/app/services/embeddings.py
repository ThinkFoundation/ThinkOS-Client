import asyncio

import httpx
import numpy as np
from openai import AsyncOpenAI

from ..config import settings
from .secrets import get_api_key


async def get_embedding(text: str) -> list[float]:
    """Generate embedding for text using configured provider."""
    if settings.embedding_provider == "openai":
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
                        "model": settings.ollama_embedding_model,
                        "prompt": text,
                    },
                    timeout=60.0,
                )
                response.raise_for_status()
                return response.json()["embedding"]
        except httpx.HTTPStatusError as e:
            last_error = e
            if attempt < retries - 1:
                await asyncio.sleep(1 * (attempt + 1))
    raise last_error  # type: ignore


async def _get_openai_embedding(text: str) -> list[float]:
    """Get embedding from OpenAI."""
    api_key = await get_api_key("openai") or settings.openai_api_key
    if not api_key:
        raise ValueError("OpenAI API key not configured")

    client = AsyncOpenAI(api_key=api_key)
    response = await client.embeddings.create(
        model=settings.openai_embedding_model,
        input=text,
    )
    return response.data[0].embedding


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_np = np.array(a)
    b_np = np.array(b)
    return float(np.dot(a_np, b_np) / (np.linalg.norm(a_np) * np.linalg.norm(b_np)))
