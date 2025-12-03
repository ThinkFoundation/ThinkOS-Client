from sqlalchemy import select

from ..models import Note, Setting
from .core import get_session_maker, run_sync, serialize_embedding


async def create_note(
    title: str,
    content: str,
    note_type: str = "web",
    url: str | None = None,
    summary: str | None = None,
    embedding: list[float] | None = None,
) -> dict:
    def _create():
        with get_session_maker()() as session:
            note = Note(
                type=note_type,
                url=url,
                title=title,
                content=content,
                summary=summary,
                embedding=serialize_embedding(embedding) if embedding else None,
            )
            session.add(note)
            session.commit()
            session.refresh(note)
            return {
                "id": note.id,
                "type": note.type,
                "url": note.url,
                "title": note.title,
                "created_at": note.created_at.isoformat(),
            }

    return await run_sync(_create)


async def get_notes() -> list[dict]:
    def _get():
        with get_session_maker()() as session:
            notes = session.execute(
                select(Note).order_by(Note.created_at.desc())
            ).scalars().all()
            return [
                {
                    "id": n.id,
                    "type": n.type,
                    "url": n.url,
                    "title": n.title,
                    "created_at": n.created_at.isoformat(),
                }
                for n in notes
            ]

    return await run_sync(_get)


async def get_note(note_id: int) -> dict | None:
    def _get():
        with get_session_maker()() as session:
            note = session.get(Note, note_id)
            if not note:
                return None
            return {
                "id": note.id,
                "type": note.type,
                "url": note.url,
                "title": note.title,
                "content": note.content,
                "summary": note.summary,
                "created_at": note.created_at.isoformat(),
            }

    return await run_sync(_get)


async def get_note_by_url(url: str) -> dict | None:
    def _get():
        with get_session_maker()() as session:
            note = session.execute(
                select(Note).where(Note.url == url).order_by(Note.created_at.desc())
            ).scalars().first()
            if not note:
                return None
            return {
                "id": note.id,
                "title": note.title,
                "created_at": note.created_at.isoformat(),
            }

    return await run_sync(_get)


async def delete_note(note_id: int) -> bool:
    def _delete():
        with get_session_maker()() as session:
            note = session.get(Note, note_id)
            if not note:
                return False
            session.delete(note)
            session.commit()
            return True

    return await run_sync(_delete)


async def update_note(
    note_id: int,
    title: str,
    content: str,
    embedding: list[float] | None = None,
) -> dict | None:
    def _update():
        with get_session_maker()() as session:
            note = session.get(Note, note_id)
            if not note:
                return None
            note.title = title
            note.content = content
            if embedding:
                note.embedding = serialize_embedding(embedding)
            session.commit()
            session.refresh(note)
            return {
                "id": note.id,
                "type": note.type,
                "url": note.url,
                "title": note.title,
                "created_at": note.created_at.isoformat(),
            }

    return await run_sync(_update)


async def update_note_embedding(note_id: int, embedding: list[float]) -> bool:
    """Update embedding for a specific note."""
    def _update():
        with get_session_maker()() as session:
            note = session.get(Note, note_id)
            if not note:
                return False
            note.embedding = serialize_embedding(embedding)
            session.commit()
            return True

    return await run_sync(_update)


async def get_notes_without_embeddings() -> list[dict]:
    """Get all notes that don't have embeddings yet."""
    def _get():
        with get_session_maker()() as session:
            notes = session.execute(
                select(Note).where(Note.embedding.is_(None))
            ).scalars().all()
            return [
                {
                    "id": n.id,
                    "title": n.title,
                    "content": n.content,
                }
                for n in notes
            ]

    return await run_sync(_get)


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
