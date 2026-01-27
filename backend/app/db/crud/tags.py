from sqlalchemy import select, func

from ..core import get_session_maker, run_sync
from ...models import Tag, MemoryTag, Memory


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
