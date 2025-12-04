"""Conversation history routes."""

from fastapi import APIRouter, HTTPException

from ..db.crud import (
    create_conversation,
    get_conversations,
    get_conversation,
    delete_conversation,
    update_conversation_title,
)
from ..schemas import ConversationCreate, ConversationUpdate
from ..events import event_manager, MemoryEvent, EventType

router = APIRouter()


@router.get("/api/conversations")
async def list_conversations(limit: int = 50, offset: int = 0):
    """Get all conversations, most recent first."""
    conversations = await get_conversations(limit=limit, offset=offset)
    return {"conversations": conversations}


@router.post("/api/conversations")
async def create_new_conversation(request: ConversationCreate):
    """Create a new conversation."""
    conversation = await create_conversation(title=request.title)

    # Emit event
    await event_manager.publish(MemoryEvent(
        type=EventType.CONVERSATION_CREATED,
        memory_id=conversation["id"],  # Reusing memory_id field for conversation_id
        data=conversation,
    ))

    return conversation


@router.get("/api/conversations/{conversation_id}")
async def get_conversation_detail(conversation_id: int):
    """Get a conversation with all its messages."""
    conversation = await get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation_route(conversation_id: int):
    """Delete a conversation."""
    success = await delete_conversation(conversation_id)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Emit event
    await event_manager.publish(MemoryEvent(
        type=EventType.CONVERSATION_DELETED,
        memory_id=conversation_id,
        data=None,
    ))

    return {"success": True}


@router.put("/api/conversations/{conversation_id}")
async def update_conversation(conversation_id: int, request: ConversationUpdate):
    """Update a conversation's title."""
    success = await update_conversation_title(conversation_id, request.title)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Emit event
    await event_manager.publish(MemoryEvent(
        type=EventType.CONVERSATION_UPDATED,
        memory_id=conversation_id,
        data={"title": request.title},
    ))

    return {"success": True}
