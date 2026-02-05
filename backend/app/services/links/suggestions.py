"""AI-powered link suggestion service using semantic similarity."""

import logging
from sqlalchemy import select

from ...db.core import get_session_maker, run_sync
from ...db.search import search_similar_memories
from ...models import Memory
from ...db.crud.links import get_linked_memory_ids

logger = logging.getLogger(__name__)


def deserialize_embedding(embedding_bytes: bytes) -> list[float]:
    """Deserialize embedding bytes to list of floats."""
    import struct
    num_floats = len(embedding_bytes) // 4
    return list(struct.unpack(f"{num_floats}f", embedding_bytes))


async def get_link_suggestions(
    memory_id: int,
    similarity_threshold: float = 0.35,
    limit: int = 5,
) -> list[dict]:
    """
    Find related memories for linking based on semantic similarity.

    Algorithm:
    1. Get source memory's embedding
    2. Search for similar memories using vector search
    3. Exclude existing links (bidirectional check)
    4. Exclude self-links
    5. Filter by threshold and limit results
    6. Convert distance to relevance score (0-100%)

    Args:
        memory_id: Source memory ID to find suggestions for
        similarity_threshold: Maximum cosine distance to consider (0.35 = good match)
        limit: Maximum number of suggestions to return

    Returns:
        List of suggestion dictionaries with format:
        [
            {
                "memory_id": int,
                "title": str,
                "summary": str,
                "type": str,
                "relevance": float  # 0.0-1.0 (display as percentage)
            }
        ]
    """
    def _get_suggestions():
        with get_session_maker()() as session:
            # Get source memory and its embedding
            memory = session.get(Memory, memory_id)
            if not memory:
                logger.warning(f"Memory {memory_id} not found for suggestions")
                return []

            if not memory.embedding:
                logger.warning(f"Memory {memory_id} has no embedding, cannot suggest links")
                return []

            # Deserialize embedding
            try:
                embedding = deserialize_embedding(memory.embedding)
            except Exception as e:
                logger.error(f"Failed to deserialize embedding for memory {memory_id}: {e}")
                return []

            return embedding

    # Get embedding in sync context
    embedding = await run_sync(_get_suggestions)
    if not embedding:
        return []

    # Search for similar memories (over-fetch to account for filtering)
    try:
        similar = await search_similar_memories(
            query_embedding=embedding,
            limit=limit * 2,  # Over-fetch to account for filtering
            keyword_query=None
        )
    except Exception as e:
        logger.error(f"Failed to search similar memories: {e}")
        return []

    # Get existing linked memory IDs
    try:
        linked_ids = await get_linked_memory_ids(memory_id)
    except Exception as e:
        logger.error(f"Failed to get linked memory IDs: {e}")
        linked_ids = []

    # Filter and format results
    suggestions = []
    for result in similar:
        # Skip self-links
        if result["id"] == memory_id:
            continue

        # Skip existing links
        if result["id"] in linked_ids:
            continue

        # Check threshold (distance < threshold means good match)
        distance = result.get("distance", 1.0)
        if distance >= similarity_threshold:
            continue

        # Convert distance to relevance (0-1 score, where 1 = perfect match)
        relevance = 1.0 - distance

        suggestions.append({
            "memory_id": result["id"],
            "title": result["title"],
            "summary": result.get("summary"),
            "type": result["type"],
            "relevance": relevance,
        })

        # Stop when we have enough suggestions
        if len(suggestions) >= limit:
            break

    logger.info(f"Found {len(suggestions)} suggestions for memory {memory_id}")
    return suggestions
