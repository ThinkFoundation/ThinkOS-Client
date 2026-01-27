from datetime import datetime, timedelta
from sqlalchemy import select, func

from ..core import get_session_maker, run_sync, serialize_embedding
from ...models import Memory, Tag, MemoryTag


async def create_memory(
    title: str,
    content: str,
    memory_type: str = "web",
    url: str | None = None,
    summary: str | None = None,
    embedding: list[float] | None = None,
    embedding_model: str | None = None,
    original_title: str | None = None,
) -> dict:
    def _create():
        with get_session_maker()() as session:
            memory = Memory(
                type=memory_type,
                url=url,
                title=title,
                original_title=original_title,
                content=content,
                summary=summary,
                embedding=serialize_embedding(embedding) if embedding else None,
                embedding_model=embedding_model if embedding else None,
            )
            session.add(memory)
            session.commit()
            session.refresh(memory)
            return {
                "id": memory.id,
                "type": memory.type,
                "url": memory.url,
                "title": memory.title,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_create)


async def get_memories(
    limit: int = 20,
    offset: int = 0,
    type_filter: str | None = None,
    date_filter: str | None = None,
    tag_filter: str | None = None,
) -> tuple[list[dict], int]:
    """Get memories with pagination and filtering. Returns (memories, total_count)."""
    def _get():
        with get_session_maker()() as session:
            # Build base query
            query = select(Memory)

            # Apply type filter
            if type_filter:
                query = query.where(Memory.type == type_filter)

            # Apply date filter
            if date_filter:
                now = datetime.utcnow()
                if date_filter == "today":
                    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
                elif date_filter == "week":
                    start = now - timedelta(days=7)
                elif date_filter == "month":
                    start = now - timedelta(days=30)
                else:
                    start = None
                if start:
                    query = query.where(Memory.created_at >= start)

            # Apply tag filter
            if tag_filter:
                normalized_tag = tag_filter.strip().lower()
                query = query.join(MemoryTag, Memory.id == MemoryTag.memory_id)
                query = query.join(Tag, MemoryTag.tag_id == Tag.id)
                query = query.where(Tag.name == normalized_tag)

            # Get total count
            count_query = select(func.count()).select_from(query.subquery())
            total = session.execute(count_query).scalar() or 0

            # Apply ordering and pagination
            query = query.order_by(Memory.created_at.desc()).offset(offset).limit(limit)
            memories = session.execute(query).scalars().all()

            if not memories:
                return [], total

            # Batch fetch tags for all memories in a single query
            memory_ids = [m.id for m in memories]
            all_memory_tags = session.execute(
                select(MemoryTag, Tag)
                .join(Tag, MemoryTag.tag_id == Tag.id)
                .where(MemoryTag.memory_id.in_(memory_ids))
            ).all()

            # Build lookup dict: memory_id -> list of tag dicts
            tags_by_memory: dict[int, list[dict]] = {mid: [] for mid in memory_ids}
            for mt, tag in all_memory_tags:
                tags_by_memory[mt.memory_id].append({
                    "id": tag.id, "name": tag.name, "source": mt.source
                })

            result = []
            for m in memories:
                memory_dict = {
                    "id": m.id,
                    "type": m.type,
                    "url": m.url,
                    "title": m.title,
                    "summary": m.summary,
                    "tags": tags_by_memory.get(m.id, []),
                    "created_at": m.created_at.isoformat(),
                }
                # Add media-specific fields for voice memos and audio
                if m.type in ("voice_memo", "audio"):
                    memory_dict.update({
                        "audio_duration": m.audio_duration,
                        "transcription_status": m.transcription_status,
                        "media_source": m.media_source,
                    })
                # Add video-specific fields
                elif m.type == "video":
                    memory_dict.update({
                        "video_duration": m.video_duration,
                        "video_width": m.video_width,
                        "video_height": m.video_height,
                        "thumbnail_path": m.thumbnail_path,
                        "video_processing_status": m.video_processing_status,
                        "transcription_status": m.transcription_status,
                        "media_source": m.media_source,
                    })
                # Add document-specific fields
                elif m.type == "document":
                    memory_dict.update({
                        "document_format": m.document_format,
                        "document_page_count": m.document_page_count,
                        "thumbnail_path": m.thumbnail_path,
                    })
                result.append(memory_dict)

            return result, total

    return await run_sync(_get)


async def get_memory(memory_id: int) -> dict | None:
    def _get():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return None

            # Get tags
            memory_tags = session.execute(
                select(MemoryTag, Tag)
                .join(Tag, MemoryTag.tag_id == Tag.id)
                .where(MemoryTag.memory_id == memory_id)
            ).all()
            tags = [
                {"id": tag.id, "name": tag.name, "source": mt.source}
                for mt, tag in memory_tags
            ]

            result = {
                "id": memory.id,
                "type": memory.type,
                "url": memory.url,
                "title": memory.title,
                "original_title": memory.original_title,
                "content": memory.content,
                "summary": memory.summary,
                "tags": tags,
                "created_at": memory.created_at.isoformat(),
            }

            # Add media-specific fields for voice memos and audio
            if memory.type in ("voice_memo", "audio"):
                import json
                result.update({
                    "audio_path": memory.audio_path,
                    "audio_format": memory.audio_format,
                    "audio_duration": memory.audio_duration,
                    "transcript": memory.transcript,
                    "transcription_status": memory.transcription_status,
                    "media_source": memory.media_source,
                    "transcript_segments": (
                        json.loads(memory.transcript_segments)
                        if memory.transcript_segments
                        else None
                    ),
                })
            # Add video-specific fields
            elif memory.type == "video":
                import json
                result.update({
                    "video_path": memory.video_path,
                    "video_format": memory.video_format,
                    "video_duration": memory.video_duration,
                    "video_width": memory.video_width,
                    "video_height": memory.video_height,
                    "thumbnail_path": memory.thumbnail_path,
                    "video_processing_status": memory.video_processing_status,
                    "audio_path": memory.audio_path,
                    "audio_format": memory.audio_format,
                    "transcript": memory.transcript,
                    "transcription_status": memory.transcription_status,
                    "media_source": memory.media_source,
                    "transcript_segments": (
                        json.loads(memory.transcript_segments)
                        if memory.transcript_segments
                        else None
                    ),
                })
            # Add document-specific fields
            elif memory.type == "document":
                result.update({
                    "document_path": memory.document_path,
                    "document_format": memory.document_format,
                    "document_page_count": memory.document_page_count,
                    "thumbnail_path": memory.thumbnail_path,
                })

            return result

    return await run_sync(_get)


async def get_memory_by_url(url: str) -> dict | None:
    def _get():
        with get_session_maker()() as session:
            memory = session.execute(
                select(Memory).where(Memory.url == url).order_by(Memory.created_at.desc())
            ).scalars().first()
            if not memory:
                return None
            return {
                "id": memory.id,
                "title": memory.title,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_get)


async def delete_memory(memory_id: int) -> bool:
    def _delete():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            session.delete(memory)
            session.commit()
            return True

    return await run_sync(_delete)


async def update_memory(
    memory_id: int,
    title: str,
    content: str,
    embedding: list[float] | None = None,
    embedding_model: str | None = None,
) -> dict | None:
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return None
            memory.title = title
            memory.content = content
            if embedding:
                memory.embedding = serialize_embedding(embedding)
                memory.embedding_model = embedding_model
            session.commit()
            session.refresh(memory)
            return {
                "id": memory.id,
                "type": memory.type,
                "url": memory.url,
                "title": memory.title,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_update)


async def update_memory_embedding(
    memory_id: int,
    embedding: list[float],
    embedding_model: str | None = None,
) -> bool:
    """Update embedding for a specific memory."""
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.embedding = serialize_embedding(embedding)
            if embedding_model:
                memory.embedding_model = embedding_model
            session.commit()
            return True

    return await run_sync(_update)


async def update_memory_summary(memory_id: int, summary: str) -> bool:
    """Update summary for a specific memory."""
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.summary = summary
            session.commit()
            return True

    return await run_sync(_update)


async def update_memory_embedding_summary(memory_id: int, embedding_summary: str) -> bool:
    """Update embedding summary for a specific memory."""
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.embedding_summary = embedding_summary
            session.commit()
            return True

    return await run_sync(_update)


async def update_memory_title(memory_id: int, title: str) -> bool:
    """Update title for a specific memory."""
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.title = title
            session.commit()
            return True

    return await run_sync(_update)


async def get_memories_without_embeddings() -> list[dict]:
    """Get all memories that don't have embeddings yet."""
    def _get():
        with get_session_maker()() as session:
            memories = session.execute(
                select(Memory).where(Memory.embedding.is_(None))
            ).scalars().all()
            return [
                {
                    "id": m.id,
                    "title": m.title,
                    "content": m.content,
                }
                for m in memories
            ]

    return await run_sync(_get)


async def count_memories_without_embedding_summary() -> int:
    """Count memories that don't have embedding_summary yet."""
    def _count():
        with get_session_maker()() as session:
            count = session.execute(
                select(func.count()).select_from(Memory).where(
                    Memory.embedding_summary.is_(None)
                )
            ).scalar()
            return count or 0

    return await run_sync(_count)


async def get_memories_without_embedding_summary(limit: int = 10) -> list[dict]:
    """Get memories that don't have embedding_summary yet and haven't failed too many times."""
    def _get():
        with get_session_maker()() as session:
            # Skip memories that have failed 3+ times to prevent infinite retry loops
            memories = session.execute(
                select(Memory).where(
                    Memory.embedding_summary.is_(None) &
                    ((Memory.processing_attempts < 3) | (Memory.processing_attempts.is_(None)))
                ).limit(limit)
            ).scalars().all()
            return [
                {
                    "id": m.id,
                    "title": m.title,
                    "content": m.content,
                }
                for m in memories
            ]

    return await run_sync(_get)


async def increment_processing_attempts(memory_id: int) -> bool:
    """Increment the processing_attempts counter for a memory."""
    def _increment():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.processing_attempts = (memory.processing_attempts or 0) + 1
            session.commit()
            return True

    return await run_sync(_increment)


async def count_memories_with_embeddings() -> int:
    """Count memories that have embeddings."""
    def _count():
        with get_session_maker()() as session:
            count = session.execute(
                select(func.count()).select_from(Memory).where(Memory.embedding.is_not(None))
            ).scalar()
            return count or 0

    return await run_sync(_count)


async def count_memories_needing_reembedding(current_model: str) -> int:
    """Count memories that need embedding and have embedding_summary ready."""
    def _count():
        with get_session_maker()() as session:
            # Count memories that:
            # 1. Have embedding_summary (required for quality embeddings)
            # 2. AND either no embedding or stale embedding
            count = session.execute(
                select(func.count()).select_from(Memory).where(
                    Memory.embedding_summary.is_not(None) &
                    (
                        (Memory.embedding.is_(None)) |
                        ((Memory.embedding.is_not(None)) &
                         ((Memory.embedding_model != current_model) | (Memory.embedding_model.is_(None))))
                    )
                )
            ).scalar()
            return count or 0

    return await run_sync(_count)


async def count_memories_needing_processing(current_model: str) -> dict:
    """Count memories needing summary generation and/or embedding.

    Returns dict with:
    - need_summary: Memories without embedding_summary (will need both summary + embedding)
    - need_embedding: Memories with embedding_summary but needing (re)embedding
    - total: Sum of both (total operations needed)
    """
    def _count():
        with get_session_maker()() as session:
            # Count memories without embedding_summary
            need_summary = session.execute(
                select(func.count()).select_from(Memory).where(
                    Memory.embedding_summary.is_(None)
                )
            ).scalar() or 0

            # Count memories that have embedding_summary but need (re)embedding
            need_embedding = session.execute(
                select(func.count()).select_from(Memory).where(
                    Memory.embedding_summary.is_not(None) &
                    (
                        (Memory.embedding.is_(None)) |
                        ((Memory.embedding.is_not(None)) &
                         ((Memory.embedding_model != current_model) | (Memory.embedding_model.is_(None))))
                    )
                )
            ).scalar() or 0

            return {
                "need_summary": need_summary,
                "need_embedding": need_embedding,
                "total": need_summary + need_embedding,
            }

    return await run_sync(_count)


async def get_memories_needing_reembedding(current_model: str, limit: int = 10) -> list[dict]:
    """Get memories that need embedding and have embedding_summary ready."""
    def _get():
        with get_session_maker()() as session:
            # Only get memories that have embedding_summary (required for quality embeddings)
            memories = session.execute(
                select(Memory).where(
                    Memory.embedding_summary.is_not(None) &
                    (
                        (Memory.embedding.is_(None)) |
                        ((Memory.embedding.is_not(None)) &
                         ((Memory.embedding_model != current_model) | (Memory.embedding_model.is_(None))))
                    )
                ).limit(limit)
            ).scalars().all()
            return [
                {
                    "id": m.id,
                    "title": m.title,
                    "content": m.content,
                    "embedding_summary": m.embedding_summary,
                }
                for m in memories
            ]

    return await run_sync(_get)
