"""CRUD operations for memory links (knowledge graph)."""

import logging
from datetime import datetime
from typing import List, Dict, Tuple, Any
from sqlalchemy import select, and_, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from fastapi import HTTPException

from ..core import get_session_maker, run_sync
from ...models import Memory, MemoryLink
from ...events import event_manager, MemoryEvent, EventType

logger = logging.getLogger(__name__)


async def create_link(
    source_id: int,
    target_id: int,
    link_type: str = "manual",
    relevance_score: float | None = None,
) -> dict:
    """Create a bidirectional link between two memories.

    Creates two rows: source→target and target→source for efficient querying.

    Args:
        source_id: Source memory ID
        target_id: Target memory ID
        link_type: "manual" or "auto"
        relevance_score: Optional AI confidence score (0.0-1.0)

    Returns:
        Link details dictionary

    Raises:
        HTTPException: 404 if memory not found, 400 if self-link, 409 if duplicate
    """
    def _create():
        with get_session_maker()() as session:
            # Validate: memories exist
            source = session.get(Memory, source_id)
            target = session.get(Memory, target_id)

            if not source or not target:
                raise HTTPException(status_code=404, detail="Memory not found")

            # Prevent self-links
            if source_id == target_id:
                raise HTTPException(status_code=400, detail="Cannot link memory to itself")

            # Check for existing link (either direction)
            existing = session.execute(
                select(MemoryLink).where(
                    or_(
                        and_(
                            MemoryLink.source_memory_id == source_id,
                            MemoryLink.target_memory_id == target_id
                        ),
                        and_(
                            MemoryLink.source_memory_id == target_id,
                            MemoryLink.target_memory_id == source_id
                        )
                    )
                )
            ).first()

            if existing:
                raise HTTPException(status_code=409, detail="Link already exists")

            # Validate relevance score if provided
            if relevance_score is not None and not (0.0 <= relevance_score <= 1.0):
                raise HTTPException(status_code=400, detail="Relevance score must be between 0.0 and 1.0")

            # Create bidirectional links
            link_forward = MemoryLink(
                source_memory_id=source_id,
                target_memory_id=target_id,
                link_type=link_type,
                relevance_score=relevance_score,
            )
            link_backward = MemoryLink(
                source_memory_id=target_id,
                target_memory_id=source_id,
                link_type=link_type,
                relevance_score=relevance_score,
            )

            session.add(link_forward)
            session.add(link_backward)
            session.commit()
            session.refresh(link_forward)

            return {
                "id": link_forward.id,
                "source_memory_id": source_id,
                "target_memory_id": target_id,
                "link_type": link_type,
                "relevance_score": relevance_score,
                "created_at": link_forward.created_at.isoformat(),
            }

    result = await run_sync(_create)

    # Emit SSE event after successful creation
    await event_manager.publish(MemoryEvent(
        type=EventType.MEMORY_UPDATED,
        memory_id=source_id,
        data={"action": "link_created", "target_id": target_id, "link_type": link_type}
    ))
    await event_manager.publish(MemoryEvent(
        type=EventType.MEMORY_UPDATED,
        memory_id=target_id,
        data={"action": "link_created", "target_id": source_id, "link_type": link_type}
    ))

    return result


async def delete_link(source_id: int, target_id: int) -> bool:
    """Delete a bidirectional link between two memories.

    Deletes both rows: source→target and target→source.

    Args:
        source_id: Source memory ID
        target_id: Target memory ID

    Returns:
        True if link was deleted

    Raises:
        HTTPException: 404 if link not found
    """
    def _delete():
        with get_session_maker()() as session:
            # Find and delete both directions
            links = session.execute(
                select(MemoryLink).where(
                    or_(
                        and_(
                            MemoryLink.source_memory_id == source_id,
                            MemoryLink.target_memory_id == target_id
                        ),
                        and_(
                            MemoryLink.source_memory_id == target_id,
                            MemoryLink.target_memory_id == source_id
                        )
                    )
                )
            ).scalars().all()

            if not links:
                raise HTTPException(status_code=404, detail="Link not found")

            for link in links:
                session.delete(link)

            session.commit()
            return True

    result = await run_sync(_delete)

    # Emit SSE event after successful deletion
    await event_manager.publish(MemoryEvent(
        type=EventType.MEMORY_UPDATED,
        memory_id=source_id,
        data={"action": "link_deleted", "target_id": target_id}
    ))
    await event_manager.publish(MemoryEvent(
        type=EventType.MEMORY_UPDATED,
        memory_id=target_id,
        data={"action": "link_deleted", "target_id": source_id}
    ))

    return result


async def get_memory_links(memory_id: int) -> list[dict]:
    """Get all links for a memory (unified bidirectional view).

    Returns links where memory is either source or target, showing the connected memory.

    Args:
        memory_id: Memory ID to get links for

    Returns:
        List of link dictionaries with connected memory details
    """
    def _get():
        with get_session_maker()() as session:
            # Get all links where this memory is the source
            # (bidirectional storage means we only need to query source_memory_id)
            links = session.execute(
                select(MemoryLink, Memory)
                .join(Memory, MemoryLink.target_memory_id == Memory.id)
                .where(MemoryLink.source_memory_id == memory_id)
                .order_by(MemoryLink.created_at.desc())
            ).all()

            result = []
            for link, target_memory in links:
                result.append({
                    "id": link.id,
                    "memory_id": target_memory.id,
                    "title": target_memory.title,
                    "type": target_memory.type,
                    "link_type": link.link_type,
                    "relevance_score": link.relevance_score,
                    "created_at": link.created_at.isoformat(),
                })

            return result

    return await run_sync(_get)


async def memory_exists(memory_id: int) -> bool:
    """Check if a memory exists.

    Args:
        memory_id: Memory ID to check

    Returns:
        True if memory exists
    """
    def _exists():
        with get_session_maker()() as session:
            return session.get(Memory, memory_id) is not None

    return await run_sync(_exists)


async def get_linked_memory_ids(memory_id: int) -> list[int]:
    """Get list of memory IDs that are linked to given memory.

    Used for filtering suggestions to exclude already-linked memories.

    Args:
        memory_id: Memory ID to get links for

    Returns:
        List of linked memory IDs
    """
    def _get():
        with get_session_maker()() as session:
            # Get all links where this memory is the source
            # (bidirectional storage means we only need to query source_memory_id)
            links = session.execute(
                select(MemoryLink.target_memory_id)
                .where(MemoryLink.source_memory_id == memory_id)
            ).scalars().all()

            return list(links)

    return await run_sync(_get)


async def batch_create_links(
    link_pairs: List[Tuple[int, int, float]]
) -> Dict[str, Any]:
    """
    Efficiently create multiple links in a single transaction.

    Creates bidirectional links (both source->target and target->source).

    Args:
        link_pairs: List of (source_id, target_id, confidence) tuples

    Returns:
        {
            "created": int,  # Number of successfully created link pairs
            "failed": int,   # Number of failed link pairs
            "errors": [str]  # List of error messages
        }
    """
    def _create():
        created = 0
        failed = 0
        errors = []

        with get_session_maker()() as session:
            for source_id, target_id, confidence in link_pairs:
                try:
                    # Check if link already exists (either direction)
                    existing_query = (
                        select(MemoryLink)
                        .where(
                            or_(
                                and_(
                                    MemoryLink.source_memory_id == source_id,
                                    MemoryLink.target_memory_id == target_id
                                ),
                                and_(
                                    MemoryLink.source_memory_id == target_id,
                                    MemoryLink.target_memory_id == source_id
                                )
                            )
                        )
                    )
                    existing = session.execute(existing_query).scalar_one_or_none()

                    if existing:
                        errors.append(f"Link between {source_id} and {target_id} already exists")
                        failed += 1
                        continue

                    # Verify both memories exist
                    source_exists = session.get(Memory, source_id) is not None
                    target_exists = session.get(Memory, target_id) is not None

                    if not source_exists:
                        errors.append(f"Source memory {source_id} does not exist")
                        failed += 1
                        continue

                    if not target_exists:
                        errors.append(f"Target memory {target_id} does not exist")
                        failed += 1
                        continue

                    # Create bidirectional links
                    # Link 1: source -> target
                    link1 = MemoryLink(
                        source_memory_id=source_id,
                        target_memory_id=target_id,
                        link_type="auto",
                        relevance_score=confidence
                    )
                    session.add(link1)

                    # Link 2: target -> source (bidirectional)
                    link2 = MemoryLink(
                        source_memory_id=target_id,
                        target_memory_id=source_id,
                        link_type="auto",
                        relevance_score=confidence
                    )
                    session.add(link2)

                    created += 1

                except IntegrityError as e:
                    logger.error(f"Link constraint violation {source_id}-{target_id}: {e}")
                    errors.append(f"Link already exists: {source_id}-{target_id}")
                    failed += 1
                except SQLAlchemyError as e:
                    logger.error(f"Database error creating link {source_id}-{target_id}: {e}")
                    errors.append(f"Database error: {str(e)}")
                    failed += 1

            # Commit all changes
            if created > 0:
                session.commit()

        return {
            "created": created,
            "failed": failed,
            "errors": errors
        }

    return await run_sync(_create)
