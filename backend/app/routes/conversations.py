"""Conversation history routes."""

from fastapi import APIRouter, HTTPException

from .. import config
from ..db.crud import (
    create_conversation,
    get_conversations,
    get_conversation,
    delete_conversation,
    update_conversation_title,
    toggle_conversation_pinned,
)
from ..schemas import ConversationCreate, ConversationUpdate, ConversationPinUpdate
from ..events import event_manager, MemoryEvent, EventType
from ..models_info import get_context_window

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

    # Add current model's context window for usage indicator
    model = config.settings.ollama_model if config.settings.ai_provider == "ollama" else config.settings.openai_model
    conversation["context_window"] = get_context_window(model)

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


@router.patch("/api/conversations/{conversation_id}/pin")
async def pin_conversation(conversation_id: int, request: ConversationPinUpdate):
    """Toggle a conversation's pinned status."""
    success = await toggle_conversation_pinned(conversation_id, request.pinned)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Emit event
    await event_manager.publish(MemoryEvent(
        type=EventType.CONVERSATION_UPDATED,
        memory_id=conversation_id,
        data={"pinned": request.pinned},
    ))

    return {"success": True, "pinned": request.pinned}
