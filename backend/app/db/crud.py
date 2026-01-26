import json
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta
from sqlalchemy import select, func

logger = logging.getLogger(__name__)

from ..models import Memory, Setting, Tag, MemoryTag, Conversation, Message, MessageSource
from .core import get_session_maker, run_sync, serialize_embedding


@contextmanager
def transaction():
    """Context manager for atomic database operations.

    Usage:
        with transaction() as session:
            # All operations in this block are atomic
            session.add(obj)
            # Commits on exit, rolls back on exception
    """
    session = get_session_maker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


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


# Tag CRUD functions

async def get_all_tags() -> list[dict]:
    """Get all tags sorted by usage count (most used first)."""
    def _get():
        with get_session_maker()() as session:
            # Count usage for each tag
            tags_with_counts = session.execute(
                select(Tag, func.count(MemoryTag.memory_id).label("usage_count"))
                .outerjoin(MemoryTag, Tag.id == MemoryTag.tag_id)
                .group_by(Tag.id)
                .order_by(func.count(MemoryTag.memory_id).desc())
            ).all()
            return [
                {"id": tag.id, "name": tag.name, "usage_count": count}
                for tag, count in tags_with_counts
            ]

    return await run_sync(_get)


async def get_or_create_tag(name: str) -> dict:
    """Get existing tag or create new one. Name is normalized to lowercase."""
    def _get_or_create():
        normalized_name = name.strip().lower()
        with get_session_maker()() as session:
            tag = session.execute(
                select(Tag).where(Tag.name == normalized_name)
            ).scalars().first()
            if not tag:
                tag = Tag(name=normalized_name)
                session.add(tag)
                session.commit()
                session.refresh(tag)
            return {"id": tag.id, "name": tag.name}

    return await run_sync(_get_or_create)


async def add_tags_to_memory(memory_id: int, tag_names: list[str], source: str = "manual") -> list[dict]:
    """Add tags to a memory. Creates tags if they don't exist."""
    def _add():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return []

            added_tags = []
            for name in tag_names:
                normalized_name = name.strip().lower()
                if not normalized_name:
                    continue

                # Get or create tag
                tag = session.execute(
                    select(Tag).where(Tag.name == normalized_name)
                ).scalars().first()
                if not tag:
                    tag = Tag(name=normalized_name)
                    session.add(tag)
                    session.flush()

                # Check if link already exists
                existing_link = session.execute(
                    select(MemoryTag).where(
                        MemoryTag.memory_id == memory_id,
                        MemoryTag.tag_id == tag.id
                    )
                ).scalars().first()

                if not existing_link:
                    memory_tag = MemoryTag(memory_id=memory_id, tag_id=tag.id, source=source)
                    session.add(memory_tag)
                    added_tags.append({"id": tag.id, "name": tag.name, "source": source})

            session.commit()
            return added_tags

    return await run_sync(_add)


async def remove_tag_from_memory(memory_id: int, tag_id: int) -> bool:
    """Remove a tag link from a memory."""
    def _remove():
        with get_session_maker()() as session:
            memory_tag = session.execute(
                select(MemoryTag).where(
                    MemoryTag.memory_id == memory_id,
                    MemoryTag.tag_id == tag_id
                )
            ).scalars().first()
            if not memory_tag:
                return False
            session.delete(memory_tag)
            session.commit()
            return True

    return await run_sync(_remove)


async def get_memory_tags(memory_id: int) -> list[dict]:
    """Get all tags for a memory with source info."""
    def _get():
        with get_session_maker()() as session:
            memory_tags = session.execute(
                select(MemoryTag, Tag)
                .join(Tag, MemoryTag.tag_id == Tag.id)
                .where(MemoryTag.memory_id == memory_id)
            ).all()
            return [
                {"id": tag.id, "name": tag.name, "source": mt.source}
                for mt, tag in memory_tags
            ]

    return await run_sync(_get)


# Settings functions

async def get_setting(key: str) -> str | None:
    """Get a setting value by key."""
    def _get():
        with get_session_maker()() as session:
            setting = session.get(Setting, key)
            return setting.value if setting else None

    return await run_sync(_get)


async def set_setting(key: str, value: str) -> None:
    """Set a setting value."""
    def _set():
        with get_session_maker()() as session:
            setting = session.get(Setting, key)
            if setting:
                setting.value = value
            else:
                setting = Setting(key=key, value=value)
                session.add(setting)
            session.commit()

    await run_sync(_set)


async def delete_setting(key: str) -> None:
    """Delete a setting."""
    def _delete():
        with get_session_maker()() as session:
            setting = session.get(Setting, key)
            if setting:
                session.delete(setting)
                session.commit()

    await run_sync(_delete)


# Conversation functions

async def create_conversation(title: str = "") -> dict:
    """Create a new conversation."""
    def _create():
        with get_session_maker()() as session:
            conversation = Conversation(title=title)
            session.add(conversation)
            session.commit()
            session.refresh(conversation)
            return {
                "id": conversation.id,
                "title": conversation.title,
                "pinned": conversation.pinned,
                "created_at": conversation.created_at.isoformat(),
                "updated_at": conversation.updated_at.isoformat(),
                "message_count": 0,
            }

    return await run_sync(_create)


async def get_conversations(limit: int = 50, offset: int = 0) -> list[dict]:
    """Get all conversations ordered by pinned status then most recent update."""
    def _get():
        with get_session_maker()() as session:
            # Get conversations with message count, pinned first then by date
            conversations = session.execute(
                select(
                    Conversation,
                    func.count(Message.id).label("message_count")
                )
                .outerjoin(Message, Conversation.id == Message.conversation_id)
                .group_by(Conversation.id)
                .order_by(Conversation.pinned.desc(), Conversation.updated_at.desc())
                .offset(offset)
                .limit(limit)
            ).all()

            if not conversations:
                return []

            # Batch fetch last messages for all conversations in a single query
            conv_ids = [conv.id for conv, _ in conversations]

            # Subquery to get the max created_at for each conversation
            from sqlalchemy import and_
            last_msg_subq = (
                select(
                    Message.conversation_id,
                    func.max(Message.created_at).label("max_created_at")
                )
                .where(Message.conversation_id.in_(conv_ids))
                .group_by(Message.conversation_id)
                .subquery()
            )

            # Get the actual messages matching the max created_at
            last_messages_query = (
                select(Message)
                .join(
                    last_msg_subq,
                    and_(
                        Message.conversation_id == last_msg_subq.c.conversation_id,
                        Message.created_at == last_msg_subq.c.max_created_at
                    )
                )
            )
            last_messages = session.execute(last_messages_query).scalars().all()

            # Build lookup dict
            last_message_by_conv = {msg.conversation_id: msg.content[:100] for msg in last_messages}

            result = []
            for conv, message_count in conversations:
                result.append({
                    "id": conv.id,
                    "title": conv.title,
                    "pinned": conv.pinned,
                    "created_at": conv.created_at.isoformat(),
                    "updated_at": conv.updated_at.isoformat(),
                    "message_count": message_count,
                    "last_message": last_message_by_conv.get(conv.id),
                })

            return result

    return await run_sync(_get)


async def get_conversation(conversation_id: int) -> dict | None:
    """Get a conversation with all its messages and their sources."""
    def _get():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return None

            messages = session.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at.asc())
            ).scalars().all()

            message_list = []
            for m in messages:
                # Get sources for this message
                sources_result = session.execute(
                    select(MessageSource, Memory)
                    .join(Memory, MessageSource.memory_id == Memory.id)
                    .where(MessageSource.message_id == m.id)
                ).all()

                sources = [
                    {"id": mem.id, "title": mem.title, "url": mem.url}
                    for msg_src, mem in sources_result
                ]

                message_list.append({
                    "id": m.id,
                    "role": m.role,
                    "content": m.content,
                    "created_at": m.created_at.isoformat(),
                    "sources": sources,
                    "prompt_tokens": m.prompt_tokens,
                    "completion_tokens": m.completion_tokens,
                    "total_tokens": m.total_tokens,
                })

            return {
                "id": conversation.id,
                "title": conversation.title,
                "created_at": conversation.created_at.isoformat(),
                "updated_at": conversation.updated_at.isoformat(),
                "messages": message_list,
            }

    return await run_sync(_get)


async def delete_conversation(conversation_id: int) -> bool:
    """Delete a conversation and all its messages."""
    def _delete():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return False
            session.delete(conversation)
            session.commit()
            return True

    return await run_sync(_delete)


async def update_conversation_title(conversation_id: int, title: str) -> bool:
    """Update a conversation's title."""
    def _update():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return False
            conversation.title = title
            session.commit()
            return True

    return await run_sync(_update)


async def toggle_conversation_pinned(conversation_id: int, pinned: bool) -> bool:
    """Toggle a conversation's pinned status."""
    def _update():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return False
            conversation.pinned = pinned
            session.commit()
            return True

    return await run_sync(_update)


async def add_message(
    conversation_id: int,
    role: str,
    content: str,
    sources: list[dict] | None = None,
    usage: dict | None = None,
) -> dict | None:
    """Add a message to a conversation with optional sources and token usage."""
    def _add():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return None

            message = Message(
                conversation_id=conversation_id,
                role=role,
                content=content,
            )

            # Store token usage if provided (for assistant messages)
            if usage:
                message.prompt_tokens = usage.get("prompt_tokens")
                message.completion_tokens = usage.get("completion_tokens")
                message.total_tokens = usage.get("total_tokens")

            session.add(message)
            session.flush()  # Get message.id before adding sources

            # Store sources if provided
            if sources:
                for source in sources:
                    msg_source = MessageSource(
                        message_id=message.id,
                        memory_id=source["id"],
                        relevance_score=source.get("distance"),
                    )
                    session.add(msg_source)

            # Update conversation's updated_at
            conversation.updated_at = datetime.utcnow()

            session.commit()
            session.refresh(message)

            return {
                "id": message.id,
                "conversation_id": conversation_id,
                "role": message.role,
                "content": message.content,
                "created_at": message.created_at.isoformat(),
                "sources": sources or [],
                "prompt_tokens": message.prompt_tokens,
                "completion_tokens": message.completion_tokens,
                "total_tokens": message.total_tokens,
            }

    return await run_sync(_add)


# Media memory functions (voice memos and audio uploads)

async def create_media_memory(
    title: str,
    audio_path: str,
    audio_format: str,
    memory_type: str = "voice_memo",
    media_source: str = "recording",
    audio_duration: float | None = None,
) -> dict:
    """Create a new media memory record (voice memo or audio upload).

    Args:
        title: Initial title (may be updated after transcription)
        audio_path: Relative path to encrypted audio file
        audio_format: Audio format (e.g., "mp3", "wav")
        memory_type: "voice_memo" for recordings, "audio" for uploads
        media_source: "recording" or "upload"
        audio_duration: Duration in seconds

    Returns:
        Dict with memory info
    """
    def _create():
        with get_session_maker()() as session:
            memory = Memory(
                type=memory_type,
                title=title,
                audio_path=audio_path,
                audio_format=audio_format,
                audio_duration=audio_duration,
                media_source=media_source,
                transcription_status="pending",
            )
            session.add(memory)
            session.commit()
            session.refresh(memory)
            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "audio_path": memory.audio_path,
                "audio_format": memory.audio_format,
                "audio_duration": memory.audio_duration,
                "media_source": memory.media_source,
                "transcription_status": memory.transcription_status,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_create)


async def update_memory_transcript(
    memory_id: int, transcript: str, segments: list[dict] | None = None
) -> bool:
    """Update the transcript and segments for a voice memory."""
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.transcript = transcript
            # Also store transcript as content for search/embedding
            memory.content = transcript
            # Store segments with timestamps as JSON
            if segments:
                memory.transcript_segments = json.dumps(segments)
                # Set audio_duration from last segment if not already set
                # (WebM recordings may not have duration extracted by mutagen)
                if not memory.audio_duration and len(segments) > 0:
                    memory.audio_duration = segments[-1]["end"]
                    logger.info(
                        f"Set audio duration from transcript segments for memory {memory_id}: {memory.audio_duration}s"
                    )
            session.commit()
            return True

    return await run_sync(_update)


async def update_transcription_status(memory_id: int, status: str) -> bool:
    """Update the transcription status for a voice memory.

    Args:
        memory_id: Memory ID
        status: One of "pending", "processing", "completed", "failed"
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.transcription_status = status
            session.commit()
            return True

    return await run_sync(_update)


async def reset_transcription_status_if_not_processing(memory_id: int) -> bool:
    """Atomically reset transcription status to 'pending' only if not currently processing.

    This prevents race conditions when multiple retry requests come in simultaneously.

    Args:
        memory_id: Memory ID

    Returns:
        True if status was reset (was not processing), False if already processing or not found
    """
    def _update():
        with get_session_maker()() as session:
            from sqlalchemy import update
            # Atomic update: only update if status is not 'processing'
            result = session.execute(
                update(Memory)
                .where(Memory.id == memory_id)
                .where(Memory.transcription_status != "processing")
                .values(transcription_status="pending")
            )
            session.commit()
            # rowcount tells us if any row was actually updated
            return result.rowcount > 0

    return await run_sync(_update)


async def get_media_memory(memory_id: int) -> dict | None:
    """Get a media memory (voice memo or audio) with audio details."""
    def _get():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type not in ("voice_memo", "audio"):
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

            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "content": memory.content,
                "summary": memory.summary,
                "transcript": memory.transcript,
                "audio_path": memory.audio_path,
                "audio_format": memory.audio_format,
                "audio_duration": memory.audio_duration,
                "media_source": memory.media_source,
                "transcription_status": memory.transcription_status,
                "tags": tags,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_get)


async def delete_media_memory(memory_id: int) -> str | None:
    """Delete a media memory and return the audio path for cleanup.

    Returns:
        The audio_path if memory was deleted (for file cleanup), None if not found
    """
    def _delete():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return None
            audio_path = memory.audio_path
            session.delete(memory)
            session.commit()
            return audio_path

    return await run_sync(_delete)


# Video memory functions

async def create_video_memory(
    title: str,
    video_path: str,
    video_format: str,
    video_duration: float | None = None,
    video_width: int | None = None,
    video_height: int | None = None,
    media_source: str = "upload",
) -> dict:
    """Create a new video memory record.

    Args:
        title: Initial title (may be updated after transcription)
        video_path: Relative path to encrypted video file
        video_format: Video format (e.g., "mp4", "webm", "mov")
        video_duration: Duration in seconds
        video_width: Video width in pixels
        video_height: Video height in pixels
        media_source: Source of the video (usually "upload")

    Returns:
        Dict with memory info
    """
    def _create():
        with get_session_maker()() as session:
            memory = Memory(
                type="video",
                title=title,
                video_path=video_path,
                video_format=video_format,
                video_duration=video_duration,
                video_width=video_width,
                video_height=video_height,
                media_source=media_source,
                video_processing_status="pending_extraction",
            )
            session.add(memory)
            session.commit()
            session.refresh(memory)
            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "video_path": memory.video_path,
                "video_format": memory.video_format,
                "video_duration": memory.video_duration,
                "video_width": memory.video_width,
                "video_height": memory.video_height,
                "media_source": memory.media_source,
                "video_processing_status": memory.video_processing_status,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_create)


async def update_video_processing_status(memory_id: int, status: str) -> bool:
    """Update the video processing status.

    Args:
        memory_id: Memory ID
        status: One of "pending_extraction", "extracting", "ready", "failed"
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return False
            memory.video_processing_status = status
            session.commit()
            return True

    return await run_sync(_update)


async def update_video_audio(
    memory_id: int,
    audio_path: str,
    audio_format: str,
) -> bool:
    """Update the extracted audio info for a video memory.

    Called after frontend extracts audio and uploads it.

    Args:
        memory_id: Memory ID
        audio_path: Relative path to encrypted audio file
        audio_format: Audio format (e.g., "m4a", "mp3")
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return False
            memory.audio_path = audio_path
            memory.audio_format = audio_format
            memory.transcription_status = "pending"
            memory.video_processing_status = "ready"
            session.commit()
            return True

    return await run_sync(_update)


async def update_video_thumbnail(memory_id: int, thumbnail_path: str) -> bool:
    """Update the thumbnail path for a video memory.

    Args:
        memory_id: Memory ID
        thumbnail_path: Relative path to encrypted thumbnail file
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return False
            memory.thumbnail_path = thumbnail_path
            session.commit()
            return True

    return await run_sync(_update)


async def get_video_memory(memory_id: int) -> dict | None:
    """Get a video memory with all details."""
    def _get():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
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

            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "content": memory.content,
                "summary": memory.summary,
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
                "tags": tags,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_get)


async def delete_video_memory(memory_id: int) -> dict | None:
    """Delete a video memory and return paths for cleanup.

    Returns:
        Dict with video_path, audio_path, and thumbnail_path for file cleanup,
        or None if not found
    """
    def _delete():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return None
            paths = {
                "video_path": memory.video_path,
                "audio_path": memory.audio_path,
                "thumbnail_path": memory.thumbnail_path,
            }
            session.delete(memory)
            session.commit()
            return paths

    return await run_sync(_delete)


# Document memory functions

async def create_document_memory(
    title: str,
    document_path: str,
    document_format: str,
    content: str | None = None,
    document_page_count: int | None = None,
    thumbnail_path: str | None = None,
) -> dict:
    """Create a new document memory record.

    Args:
        title: Document title (typically filename without extension)
        document_path: Relative path to encrypted document file
        document_format: Document format (e.g., "pdf")
        content: Extracted text content from document
        document_page_count: Number of pages in document
        thumbnail_path: Relative path to encrypted thumbnail file

    Returns:
        Dict with memory info
    """
    def _create():
        with get_session_maker()() as session:
            memory = Memory(
                type="document",
                title=title,
                document_path=document_path,
                document_format=document_format,
                content=content,
                document_page_count=document_page_count,
                thumbnail_path=thumbnail_path,
            )
            session.add(memory)
            session.commit()
            session.refresh(memory)
            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "document_path": memory.document_path,
                "document_format": memory.document_format,
                "document_page_count": memory.document_page_count,
                "thumbnail_path": memory.thumbnail_path,
                "content": memory.content,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_create)


async def get_document_memory(memory_id: int) -> dict | None:
    """Get a document memory with all details."""
    def _get():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "document":
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

            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "content": memory.content,
                "summary": memory.summary,
                "document_path": memory.document_path,
                "document_format": memory.document_format,
                "document_page_count": memory.document_page_count,
                "thumbnail_path": memory.thumbnail_path,
                "tags": tags,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_get)


async def update_document_thumbnail(memory_id: int, thumbnail_path: str) -> bool:
    """Update the thumbnail path for a document memory.

    Args:
        memory_id: Memory ID
        thumbnail_path: Relative path to encrypted thumbnail file
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "document":
                return False
            memory.thumbnail_path = thumbnail_path
            session.commit()
            return True

    return await run_sync(_update)


async def delete_document_memory(memory_id: int) -> dict | None:
    """Delete a document memory and return paths for cleanup.

    Returns:
        Dict with document_path and thumbnail_path for file cleanup,
        or None if not found
    """
    def _delete():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "document":
                return None
            paths = {
                "document_path": memory.document_path,
                "thumbnail_path": memory.thumbnail_path,
            }
            session.delete(memory)
            session.commit()
            return paths

    return await run_sync(_delete)
