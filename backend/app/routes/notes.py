import logging

from fastapi import APIRouter, HTTPException

from ..db import (
    create_note,
    get_notes,
    get_note,
    get_note_by_url,
    delete_note,
    update_note,
    update_note_embedding,
    get_notes_without_embeddings,
)
from ..services.embeddings import get_embedding
from ..schemas import NoteCreate, format_note_for_embedding

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["notes"])


@router.get("/notes")
async def list_notes():
    notes = await get_notes()
    return {"notes": notes}


@router.get("/notes/{note_id}")
async def read_note(note_id: int):
    note = await get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.post("/notes")
async def save_note(note: NoteCreate):
    # Check for duplicate URL
    if note.url:
        existing = await get_note_by_url(note.url)
        if existing:
            return {"duplicate": True, "existing_note": existing}

    embedding = None
    try:
        embedding = await get_embedding(format_note_for_embedding(note.title, note.content))
    except Exception as e:
        logger.warning(f"Embedding generation failed: {e}")

    result = await create_note(
        title=note.title,
        content=note.content,
        note_type=note.type,
        url=note.url,
        embedding=embedding,
    )
    return result


@router.put("/notes/{note_id}")
async def update_note_endpoint(note_id: int, note: NoteCreate):
    embedding = None
    try:
        embedding = await get_embedding(format_note_for_embedding(note.title, note.content))
    except Exception as e:
        logger.warning(f"Embedding generation failed: {e}")

    result = await update_note(
        note_id=note_id,
        title=note.title,
        content=note.content,
        embedding=embedding,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Note not found")
    return result


@router.delete("/notes/{note_id}")
async def remove_note(note_id: int):
    deleted = await delete_note(note_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"deleted": True}


@router.post("/notes/generate-embeddings")
async def generate_embeddings():
    """Generate embeddings for all notes that don't have them."""
    notes = await get_notes_without_embeddings()
    processed = 0
    failed = 0

    for note in notes:
        try:
            text = format_note_for_embedding(note['title'], note['content'])
            embedding = await get_embedding(text)
            await update_note_embedding(note["id"], embedding)
            processed += 1
        except Exception as e:
            logger.warning(f"Embedding generation failed for note {note['id']}: {e}")
            failed += 1

    return {"processed": processed, "failed": failed, "total": len(notes)}
