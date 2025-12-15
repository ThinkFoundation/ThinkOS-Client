import logging
from sqlalchemy import text

from .core import get_session_maker, run_sync, serialize_embedding

logger = logging.getLogger(__name__)


def _check_fts_table_exists(session) -> bool:
    """Check if the FTS5 table exists."""
    result = session.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
    )).fetchone()
    return result is not None


async def search_similar_memories(
    query_embedding: list[float],
    limit: int = 10,
    keyword_query: str | None = None,
) -> list[dict]:
    """
    Search for memories using hybrid vector + keyword search.

    Uses Reciprocal Rank Fusion (RRF) to combine vector similarity and
    FTS5 keyword matching for better retrieval quality.

    Args:
        query_embedding: The embedding vector for similarity search
        limit: Maximum number of results to return
        keyword_query: Optional FTS5 query string for keyword matching
    """
    def _search():
        with get_session_maker()() as session:
            query_bytes = serialize_embedding(query_embedding)

            # Check if FTS is available and keyword query provided
            use_hybrid = keyword_query and _check_fts_table_exists(session)
            logger.info(f"Search starting: use_hybrid={use_hybrid}, keyword_query='{keyword_query}'")

            if use_hybrid:
                # Hybrid search using RRF (Reciprocal Rank Fusion)
                # RRF formula: score = sum(1 / (k + rank)) where k=60 is standard
                try:
                    result = session.execute(
                        text("""
                            WITH vector_results AS (
                                SELECT id, title, content, url, summary, type, created_at, embedding,
                                       vec_distance_cosine(embedding, :query) as distance,
                                       ROW_NUMBER() OVER (ORDER BY vec_distance_cosine(embedding, :query) ASC) as vec_rank
                                FROM memories
                                WHERE embedding IS NOT NULL
                                ORDER BY distance ASC
                                LIMIT :search_limit
                            ),
                            fts_results AS (
                                SELECT m.id, m.title, m.content, m.url, m.summary, m.type, m.created_at, m.embedding,
                                       ROW_NUMBER() OVER (ORDER BY bm25(memories_fts)) as fts_rank
                                FROM memories_fts
                                JOIN memories m ON memories_fts.rowid = m.id
                                WHERE memories_fts MATCH :fts_query
                                LIMIT :search_limit
                            ),
                            combined AS (
                                -- Vector-only results
                                SELECT v.id, v.title, v.content, v.url, v.summary, v.type, v.created_at,
                                       v.distance,
                                       (1.0 / (60.0 + v.vec_rank)) as rrf_score,
                                       'vector' as match_type
                                FROM vector_results v
                                WHERE v.id NOT IN (SELECT id FROM fts_results)

                                UNION ALL

                                -- FTS-only results (calculate distance for these too)
                                SELECT f.id, f.title, f.content, f.url, f.summary, f.type, f.created_at,
                                       CASE WHEN f.embedding IS NOT NULL
                                            THEN vec_distance_cosine(f.embedding, :query)
                                            ELSE 1.0 END as distance,
                                       (1.0 / (60.0 + f.fts_rank)) as rrf_score,
                                       'keyword' as match_type
                                FROM fts_results f
                                WHERE f.id NOT IN (SELECT id FROM vector_results)

                                UNION ALL

                                -- Results in both (combined RRF score)
                                SELECT v.id, v.title, v.content, v.url, v.summary, v.type, v.created_at,
                                       v.distance,
                                       (1.0 / (60.0 + v.vec_rank)) + (1.0 / (60.0 + f.fts_rank)) as rrf_score,
                                       'hybrid' as match_type
                                FROM vector_results v
                                JOIN fts_results f ON v.id = f.id
                            )
                            SELECT id, title, content, url, summary, type, created_at, distance, rrf_score, match_type
                            FROM combined
                            ORDER BY rrf_score DESC
                            LIMIT :limit
                        """),
                        {"query": query_bytes, "fts_query": keyword_query, "limit": limit, "search_limit": limit * 3}
                    ).fetchall()
                    logger.info(f"Hybrid search returned {len(result)} raw results")
                except Exception as e:
                    logger.error(f"Hybrid search failed: {e}, falling back to vector-only")
                    use_hybrid = False  # Fall back to vector search

            if not use_hybrid:
                # Vector-only search (fallback)
                result = session.execute(
                    text("""
                        SELECT id, title, content, url, summary, type, created_at,
                               vec_distance_cosine(embedding, :query) as distance,
                               (1.0 / (60.0 + ROW_NUMBER() OVER (ORDER BY vec_distance_cosine(embedding, :query) ASC))) as rrf_score,
                               'vector' as match_type
                        FROM memories
                        WHERE embedding IS NOT NULL
                        ORDER BY distance ASC
                        LIMIT :limit
                    """),
                    {"query": query_bytes, "limit": limit}
                ).fetchall()

            results = [
                {
                    "id": row.id,
                    "title": row.title,
                    "content": row.content,
                    "url": row.url,
                    "summary": row.summary,
                    "type": row.type,
                    "created_at": row.created_at if isinstance(row.created_at, str) else (row.created_at.isoformat() if row.created_at else None),
                    "distance": row.distance,
                    "rrf_score": row.rrf_score,
                    "match_type": row.match_type,
                }
                for row in result
            ]

            # Log search results for debugging
            if results:
                logger.info(f"RAG search found {len(results)} results (hybrid={use_hybrid})")
                for r in results[:5]:
                    dist = r.get('distance')
                    rrf = r.get('rrf_score')
                    title = r.get('title', '')[:40]
                    dist_str = f"{dist:.3f}" if dist is not None else "N/A"
                    rrf_str = f"{rrf:.4f}" if rrf is not None else "N/A"
                    logger.info(f"  - [{r.get('match_type', '?')}] {title}... dist={dist_str} rrf={rrf_str}")
            else:
                logger.info(f"RAG search found no results (hybrid={use_hybrid}, keyword_query={keyword_query})")

            return results

    return await run_sync(_search)
