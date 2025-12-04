import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..events import event_manager, MemoryEvent, EventType
from ..db import (
    create_memory,
    get_memories,
    get_memory,
    get_memory_by_url,
    delete_memory,
    update_memory,
    update_memory_embedding,
    get_memories_without_embeddings,
    get_all_tags,
    add_tags_to_memory,
    remove_tag_from_memory,
)
from ..services.embeddings import get_embedding
from ..services.ai_processing import process_memory_async
from ..schemas import MemoryCreate, format_memory_for_embedding

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["memories"])


@router.get("/memories/events")
async def memory_events():
    """SSE endpoint for real-time memory updates."""

    async def event_stream():
        queue = event_manager.subscribe()
        try:
            # Send initial connection confirmation
            yield 'data: {"type": "connected"}\n\n'

            while True:
                try:
                    # Wait for events with timeout for keepalive
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield event.to_sse()
                except asyncio.TimeoutError:
                    # Send keepalive comment
                    yield ": keepalive\n\n"
        finally:
            event_manager.unsubscribe(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/memories")
async def list_memories(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    type: str | None = Query(None, description="Filter by type: web or note"),
    date_range: str | None = Query(None, description="Filter by date: today, week, month"),
    tag: str | None = Query(None, description="Filter by tag name"),
):
    memories, total = await get_memories(
        limit=limit,
        offset=offset,
        type_filter=type,
        date_filter=date_range,
        tag_filter=tag,
    )
    return {
        "memories": memories,
        "total": total,
        "has_more": offset + len(memories) < total,
    }


@router.get("/memories/{memory_id}")
async def read_memory(memory_id: int):
    memory = await get_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")
    return memory


@router.post("/memories")
async def save_memory(memory: MemoryCreate):
    # Check for duplicate URL
    if memory.url:
        existing = await get_memory_by_url(memory.url)
        if existing:
            return {"duplicate": True, "existing_memory": existing}

    embedding = None
    try:
        embedding = await get_embedding(format_memory_for_embedding(memory.title, memory.content))
    except Exception as e:
        logger.warning(f"Embedding generation failed: {e}")

    # For web memories, store original title for reference (AI will generate a cleaner title later)
    original_title = memory.title if memory.type == "web" else None

    result = await create_memory(
        title=memory.title,
        content=memory.content,
        memory_type=memory.type,
        url=memory.url,
        embedding=embedding,
        original_title=original_title,
    )

    memory_id = result["id"]

    # Add manual tags if provided
    if memory.tags:
        await add_tags_to_memory(memory_id, memory.tags, source="manual")

    # Spawn background task for AI processing (summary + auto tags)
    if memory.content:
        asyncio.create_task(process_memory_async(memory_id))

    # Fetch full memory with tags to emit event
    full_memory = await get_memory(memory_id)
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_CREATED,
            memory_id=memory_id,
            data=full_memory,
        )
    )

    return result


@router.put("/memories/{memory_id}")
async def update_memory_endpoint(memory_id: int, memory: MemoryCreate):
    embedding = None
    try:
        embedding = await get_embedding(format_memory_for_embedding(memory.title, memory.content))
    except Exception as e:
        logger.warning(f"Embedding generation failed: {e}")

    result = await update_memory(
        memory_id=memory_id,
        title=memory.title,
        content=memory.content,
        embedding=embedding,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Memory not found")

    # Fetch full memory with tags to emit event
    full_memory = await get_memory(memory_id)
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_UPDATED,
            memory_id=memory_id,
            data=full_memory,
        )
    )

    return result


@router.delete("/memories/{memory_id}")
async def remove_memory(memory_id: int):
    deleted = await delete_memory(memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")

    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_DELETED,
            memory_id=memory_id,
            data=None,
        )
    )

    return {"deleted": True}


@router.post("/memories/generate-embeddings")
async def generate_embeddings():
    """Generate embeddings for all memories that don't have them."""
    memories = await get_memories_without_embeddings()
    processed = 0
    failed = 0

    for memory in memories:
        try:
            text = format_memory_for_embedding(memory['title'], memory['content'])
            embedding = await get_embedding(text)
            await update_memory_embedding(memory["id"], embedding)
            processed += 1
        except Exception as e:
            logger.warning(f"Embedding generation failed for memory {memory['id']}: {e}")
            failed += 1

    return {"processed": processed, "failed": failed, "total": len(memories)}


# Tag endpoints

@router.get("/tags")
async def list_tags():
    """Get all tags sorted by usage count (most used first)."""
    tags = await get_all_tags()
    return {"tags": tags}


@router.post("/memories/{memory_id}/tags")
async def add_tag_to_memory(memory_id: int, tag_name: str = Query(..., min_length=1)):
    """Add a manual tag to a memory."""
    memory = await get_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")

    added = await add_tags_to_memory(memory_id, [tag_name], source="manual")
    if not added:
        return {"added": False, "message": "Tag already exists on this memory"}
    return {"added": True, "tag": added[0]}


@router.delete("/memories/{memory_id}/tags/{tag_id}")
async def remove_tag(memory_id: int, tag_id: int):
    """Remove a tag from a memory."""
    removed = await remove_tag_from_memory(memory_id, tag_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Tag not found on this memory")
    return {"removed": True}
