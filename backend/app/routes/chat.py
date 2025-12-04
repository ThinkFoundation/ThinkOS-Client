from fastapi import APIRouter, HTTPException
from openai import APIConnectionError

from ..services.ai import chat as ai_chat
from ..schemas import ChatRequest
from ..config import settings
from ..db.crud import create_conversation, add_message, update_conversation_title, get_conversation
from ..events import event_manager, MemoryEvent, EventType


router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat")
async def chat(request: ChatRequest):
    conversation_id = request.conversation_id
    is_new_conversation = False

    # Validate or create conversation
    if conversation_id is None:
        conversation = await create_conversation()
        conversation_id = conversation["id"]
        is_new_conversation = True

        # Emit conversation created event
        await event_manager.publish(MemoryEvent(
            type=EventType.CONVERSATION_CREATED,
            memory_id=conversation_id,
            data=conversation,
        ))
    else:
        # Verify conversation exists
        existing = await get_conversation(conversation_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

    # Save user message
    user_message = await add_message(conversation_id, "user", request.message)

    # Set conversation title from first message if new
    if is_new_conversation:
        # Use first 50 chars of message as title
        title = request.message[:50] + ("..." if len(request.message) > 50 else "")
        await update_conversation_title(conversation_id, title)

        # Emit title update event
        await event_manager.publish(MemoryEvent(
            type=EventType.CONVERSATION_UPDATED,
            memory_id=conversation_id,
            data={"title": title},
        ))

    try:
        response = await ai_chat(request.message)

        # Save assistant message
        assistant_message = await add_message(conversation_id, "assistant", response)

        return {
            "response": response,
            "conversation_id": conversation_id,
            "sources": []
        }
    except APIConnectionError:
        error_msg = ""
        if settings.ai_provider == "ollama":
            error_msg = "Cannot connect to Ollama. Please make sure Ollama is running, or switch to OpenAI in Settings."
        else:
            error_msg = "Cannot connect to OpenAI. Please check your API key in Settings."

        # Save error as assistant message
        await add_message(conversation_id, "assistant", error_msg)

        return {
            "response": None,
            "conversation_id": conversation_id,
            "error": error_msg,
            "sources": []
        }
    except Exception as e:
        error_msg = f"An error occurred: {str(e)}"

        # Save error as assistant message
        await add_message(conversation_id, "assistant", error_msg)

        return {
            "response": None,
            "conversation_id": conversation_id,
            "error": error_msg,
            "sources": []
        }
