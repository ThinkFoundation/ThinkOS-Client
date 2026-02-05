"""Graph data retrieval for visualization."""

from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func, and_, union_all
from sqlalchemy.orm import Session

from ..core import get_session_maker, run_sync
from ...models import Memory, MemoryLink


async def get_graph_data(
    memory_type: str | None = None,
    date_range: str | None = None,
    include_isolated: bool = True,
    limit: int | None = None,
) -> dict:
    """
    Get graph data optimized for visualization.

    Args:
        memory_type: Filter by memory type (e.g., "web", "note")
        date_range: Filter by date range ("today", "week", "month")
        include_isolated: Whether to include nodes with no connections
        limit: Maximum number of nodes to return

    Returns:
        {
            "nodes": [...],
            "links": [...],
            "total_nodes": int,
            "total_links": int
        }
    """
    def _get():
        with get_session_maker()() as session:
            # Build base query for memories
            query = select(Memory)

            # Apply type filter
            if memory_type and memory_type != "all":
                query = query.where(Memory.type == memory_type)

            # Apply date filter
            if date_range and date_range != "all":
                cutoff = _get_date_cutoff(date_range)
                if cutoff:
                    query = query.where(Memory.created_at >= cutoff)

            # Apply limit
            if limit:
                query = query.limit(limit)

            # Order by created_at descending
            query = query.order_by(Memory.created_at.desc())

            # Execute query
            memories = session.execute(query).scalars().all()
            memory_ids = {m.id for m in memories}

            # Get connection counts for each memory (both directions)
            connection_counts = {}
            if memory_ids:
                outgoing = (
                    select(
                        MemoryLink.source_memory_id.label("memory_id"),
                        func.count().label("cnt"),
                    )
                    .where(MemoryLink.source_memory_id.in_(memory_ids))
                    .group_by(MemoryLink.source_memory_id)
                )
                incoming = (
                    select(
                        MemoryLink.target_memory_id.label("memory_id"),
                        func.count().label("cnt"),
                    )
                    .where(MemoryLink.target_memory_id.in_(memory_ids))
                    .group_by(MemoryLink.target_memory_id)
                )
                combined = union_all(outgoing, incoming).subquery()
                count_query = (
                    select(
                        combined.c.memory_id,
                        func.sum(combined.c.cnt).label("total"),
                    )
                    .group_by(combined.c.memory_id)
                )
                counts = session.execute(count_query).all()
                connection_counts = {row[0]: row[1] for row in counts}

            # Filter isolated nodes if needed
            if not include_isolated:
                memories = [m for m in memories if connection_counts.get(m.id, 0) > 0]
                memory_ids = {m.id for m in memories}

            # Build nodes array
            nodes = [
                {
                    "id": m.id,
                    "title": m.title or "Untitled",
                    "type": m.type,
                    "summary": m.summary,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                    "connection_count": connection_counts.get(m.id, 0),
                }
                for m in memories
            ]

            # Get all links between these memories
            links = []
            if memory_ids:
                link_query = (
                    select(MemoryLink)
                    .where(
                        and_(
                            MemoryLink.source_memory_id.in_(memory_ids),
                            MemoryLink.target_memory_id.in_(memory_ids)
                        )
                    )
                )
                link_results = session.execute(link_query).scalars().all()

                # Deduplicate bidirectional links (only keep one direction per pair)
                seen_pairs = set()
                for link in link_results:
                    pair = tuple(sorted([link.source_memory_id, link.target_memory_id]))
                    if pair not in seen_pairs:
                        seen_pairs.add(pair)
                        links.append({
                            "source": link.source_memory_id,
                            "target": link.target_memory_id,
                            "link_type": link.link_type,
                            "relevance_score": link.relevance_score,
                            "created_at": link.created_at.isoformat() if link.created_at else None,
                        })

            return {
                "nodes": nodes,
                "links": links,
                "total_nodes": len(nodes),
                "total_links": len(links),
            }

    return await run_sync(_get)


def _get_date_cutoff(date_range: str) -> datetime | None:
    """Get datetime cutoff for date range filter."""
    now = datetime.now(timezone.utc)
    if date_range == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif date_range == "week":
        return now - timedelta(days=7)
    elif date_range == "month":
        return now - timedelta(days=30)
    return None
