from contextlib import contextmanager
from datetime import datetime, timedelta
from sqlalchemy import select, func

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

            # Get tags for each memory
            result = []
            for m in memories:
                memory_tags = session.execute(
                    select(MemoryTag, Tag)
                    .join(Tag, MemoryTag.tag_id == Tag.id)
                    .where(MemoryTag.memory_id == m.id)
                ).all()
                tags = [
                    {"id": tag.id, "name": tag.name, "source": mt.source}
                    for mt, tag in memory_tags
                ]
                result.append({
                    "id": m.id,
                    "type": m.type,
                    "url": m.url,
                    "title": m.title,
                    "summary": m.summary,
                    "tags": tags,
                    "created_at": m.created_at.isoformat(),
                })

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

            return {
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
    """Count memories that need embedding (no embedding or stale embedding)."""
    def _count():
        with get_session_maker()() as session:
            # Count memories that:
            # 1. Have no embedding at all (embedding IS NULL), OR
            # 2. Have embeddings but embedding_model != current_model (stale)
            count = session.execute(
                select(func.count()).select_from(Memory).where(
                    (Memory.embedding.is_(None)) |
                    ((Memory.embedding.is_not(None)) &
                     ((Memory.embedding_model != current_model) | (Memory.embedding_model.is_(None))))
                )
            ).scalar()
            return count or 0

    return await run_sync(_count)


async def get_memories_needing_reembedding(current_model: str, limit: int = 10) -> list[dict]:
    """Get memories that need embedding (no embedding or stale embedding)."""
    def _get():
        with get_session_maker()() as session:
            memories = session.execute(
                select(Memory).where(
                    (Memory.embedding.is_(None)) |
                    ((Memory.embedding.is_not(None)) &
                     ((Memory.embedding_model != current_model) | (Memory.embedding_model.is_(None))))
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

            result = []
            for conv, message_count in conversations:
                # Get last message for preview
                last_message = session.execute(
                    select(Message)
                    .where(Message.conversation_id == conv.id)
                    .order_by(Message.created_at.desc())
                    .limit(1)
                ).scalars().first()

                result.append({
                    "id": conv.id,
                    "title": conv.title,
                    "pinned": conv.pinned,
                    "created_at": conv.created_at.isoformat(),
                    "updated_at": conv.updated_at.isoformat(),
                    "message_count": message_count,
                    "last_message": last_message.content[:100] if last_message else None,
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
