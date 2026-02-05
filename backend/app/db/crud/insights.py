"""CRUD operations for insights service."""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any
from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

from ..core import get_session_maker, run_sync
from ...models import Memory, MemoryLink

logger = logging.getLogger(__name__)


async def get_embeddings_for_nodes(node_ids: List[int]) -> Dict[int, bytes]:
    """
    Bulk fetch embeddings for multiple nodes efficiently.

    Args:
        node_ids: List of memory IDs to fetch embeddings for

    Returns:
        Dict mapping node_id -> embedding_bytes
    """
    def _get():
        with get_session_maker()() as session:
            # Bulk fetch memories with embeddings
            query = (
                select(Memory.id, Memory.embedding)
                .where(
                    and_(
                        Memory.id.in_(node_ids),
                        Memory.embedding.isnot(None)
                    )
                )
            )
            results = session.execute(query).all()

            # Build map
            embeddings_map = {row[0]: row[1] for row in results}
            return embeddings_map

    return await run_sync(_get)


async def get_link_creation_timeline(days: int = 30) -> List[Dict[str, Any]]:
    """
    Get link creation counts over time for growth metrics.

    Args:
        days: Number of days to look back

    Returns:
        List of {"date": "YYYY-MM-DD", "count": int} sorted by date descending
    """
    def _get():
        with get_session_maker()() as session:
            # Calculate cutoff date
            cutoff = datetime.utcnow() - timedelta(days=days)

            # Query link creation counts grouped by date
            query = (
                select(
                    func.date(MemoryLink.created_at).label("date"),
                    func.count(MemoryLink.id).label("count")
                )
                .where(MemoryLink.created_at >= cutoff)
                .group_by(func.date(MemoryLink.created_at))
                .order_by(func.date(MemoryLink.created_at).desc())
            )

            results = session.execute(query).all()

            # Format results
            timeline = [
                {
                    "date": row[0].isoformat() if isinstance(row[0], datetime) else str(row[0]),
                    "count": row[1]
                }
                for row in results
            ]

            return timeline

    return await run_sync(_get)
