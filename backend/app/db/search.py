from sqlalchemy import text

from .core import get_session_maker, run_sync, serialize_embedding


async def search_similar_memories(query_embedding: list[float], limit: int = 5) -> list[dict]:
    """Search for memories similar to the query embedding using sqlite-vec."""
    def _search():
        with get_session_maker()() as session:
            query_bytes = serialize_embedding(query_embedding)
            result = session.execute(
                text("""
                    SELECT id, title, content, url,
                           vec_distance_cosine(embedding, :query) as distance
                    FROM memories
                    WHERE embedding IS NOT NULL
                    ORDER BY distance ASC
                    LIMIT :limit
                """),
                {"query": query_bytes, "limit": limit}
            ).fetchall()
            return [
                {
                    "id": row.id,
                    "title": row.title,
                    "content": row.content,
                    "url": row.url,
                    "distance": row.distance,
                }
                for row in result
            ]

    return await run_sync(_search)
