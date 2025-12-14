import asyncio
import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openai import APIConnectionError

from ..services.ai import chat as ai_chat, chat_stream as ai_chat_stream, get_model
from ..models_info import get_context_window
from ..services.ai_processing import process_conversation_title_async
from ..services.embeddings import get_embedding
from ..services.query_processing import preprocess_query, extract_keywords
from ..db.search import search_similar_memories
from ..schemas import ChatRequest
from .. import config
from ..db.crud import create_conversation, add_message, update_conversation_title, get_conversation
from ..events import event_manager, MemoryEvent, EventType


router = APIRouter(prefix="/api", tags=["chat"])


def format_memories_as_context(memories: list[dict], max_chars: int = 4000) -> str:
    """Format retrieved memories into a context string for the LLM."""
    if not memories:
        return ""

    context_parts = []
    total_chars = 0

    for memory in memories:
        # Skip memories with low relevance (high distance)
        # Allow FTS-only matches (distance=None) through
        distance = memory.get("distance")
        if distance is not None and distance > 0.85:
            continue

        title = memory.get("title", "Untitled")
        content = memory.get("content", "")

        # Truncate content if too long
        if len(content) > 800:
            content = content[:800] + "..."

        entry = f"### {title}\n{content}"

        # Check if adding this would exceed limit
        if total_chars + len(entry) > max_chars:
            break

        context_parts.append(entry)
        total_chars += len(entry)

    if not context_parts:
        return ""

    return "## Relevant Memories:\n\n" + "\n\n---\n\n".join(context_parts)


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
        # Set temporary truncated title immediately
        temp_title = request.message[:50] + ("..." if len(request.message) > 50 else "")
        await update_conversation_title(conversation_id, temp_title)

        # Generate AI title in background
        asyncio.create_task(process_conversation_title_async(conversation_id, request.message))

    # --- RAG: Retrieve relevant memories ---
    context = ""
    sources = []

    try:
        # Preprocess query to improve semantic matching
        processed_query = preprocess_query(request.message)
        keyword_query = extract_keywords(request.message)
        query_embedding = await get_embedding(processed_query)
        similar_memories = await search_similar_memories(
            query_embedding, limit=10, keyword_query=keyword_query
        )

        if similar_memories:
            context = format_memories_as_context(similar_memories)
            # Build sources list (include memories with distance < 0.85)
            sources = [
                {"id": m["id"], "title": m["title"], "url": m.get("url"), "distance": m.get("distance")}
                for m in similar_memories
                if m.get("distance") is None or m.get("distance", 1.0) < 0.85
            ]
    except Exception as e:
        # RAG is an enhancement, not required - log and continue
        print(f"RAG retrieval error: {e}")

    # --- Get conversation history ---
    history = []
    conv_data = await get_conversation(conversation_id)
    if conv_data and conv_data.get("messages"):
        # Exclude the message we just added (it's the current user message)
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in conv_data["messages"][:-1]
        ]

    try:
        response = await ai_chat(request.message, context=context, history=history)

        # Save assistant message with sources
        assistant_message = await add_message(conversation_id, "assistant", response, sources=sources)

        return {
            "response": response,
            "conversation_id": conversation_id,
            "sources": sources,
            "searched": True
        }
    except APIConnectionError:
        error_msg = ""
        if config.settings.ai_provider == "ollama":
            error_msg = "Cannot connect to Ollama. Please make sure Ollama is running, or switch to OpenAI in Settings."
        else:
            error_msg = "Cannot connect to OpenAI. Please check your API key in Settings."

        # Save error as assistant message
        await add_message(conversation_id, "assistant", error_msg)

        return {
            "response": None,
            "conversation_id": conversation_id,
            "error": error_msg,
            "sources": [],
            "searched": True
        }
    except Exception as e:
        error_msg = f"An error occurred: {str(e)}"

        # Save error as assistant message
        await add_message(conversation_id, "assistant", error_msg)

        return {
            "response": None,
            "conversation_id": conversation_id,
            "error": error_msg,
            "sources": [],
            "searched": True
        }


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """Stream chat response with Server-Sent Events."""
    conversation_id = request.conversation_id
    is_new_conversation = False

    # Validate or create conversation
    if conversation_id is None:
        conversation = await create_conversation()
        conversation_id = conversation["id"]
        is_new_conversation = True

        await event_manager.publish(MemoryEvent(
            type=EventType.CONVERSATION_CREATED,
            memory_id=conversation_id,
            data=conversation,
        ))
    else:
        existing = await get_conversation(conversation_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

    # Save user message
    await add_message(conversation_id, "user", request.message)

    # Set conversation title from first message if new
    if is_new_conversation:
        # Set temporary truncated title immediately
        temp_title = request.message[:50] + ("..." if len(request.message) > 50 else "")
        await update_conversation_title(conversation_id, temp_title)

        # Generate AI title in background
        asyncio.create_task(process_conversation_title_async(conversation_id, request.message))

    # RAG: Retrieve relevant memories
    context = ""
    sources = []

    try:
        # Preprocess query to improve semantic matching
        processed_query = preprocess_query(request.message)
        keyword_query = extract_keywords(request.message)
        query_embedding = await get_embedding(processed_query)
        similar_memories = await search_similar_memories(
            query_embedding, limit=10, keyword_query=keyword_query
        )

        if similar_memories:
            context = format_memories_as_context(similar_memories)
            # Build sources list (include memories with distance < 0.85 or FTS-only matches)
            sources = [
                {"id": m["id"], "title": m["title"], "url": m.get("url"), "distance": m.get("distance")}
                for m in similar_memories
                if m.get("distance") is None or m.get("distance", 1.0) < 0.85
            ]
    except Exception as e:
        print(f"RAG retrieval error: {e}")

    # Get conversation history
    history = []
    conv_data = await get_conversation(conversation_id)
    if conv_data and conv_data.get("messages"):
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in conv_data["messages"][:-1]
        ]

    async def generate():
        full_response = ""
        usage_data = None

        # Send metadata first (conversation_id, sources)
        yield f"data: {json.dumps({'type': 'meta', 'conversation_id': conversation_id, 'sources': sources, 'searched': True})}\n\n"

        try:
            async for token, usage in ai_chat_stream(request.message, context=context, history=history):
                if token:
                    full_response += token
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                if usage:
                    usage_data = usage

            # Save complete response with sources and usage
            await add_message(conversation_id, "assistant", full_response, sources=sources, usage=usage_data)

            # Signal done with usage and context window info
            done_data = {'type': 'done'}
            if usage_data:
                done_data['usage'] = usage_data
                done_data['context_window'] = get_context_window(get_model())
            yield f"data: {json.dumps(done_data)}\n\n"

        except APIConnectionError:
            error_msg = "Cannot connect to AI provider. Please check your settings."
            if config.settings.ai_provider == "ollama":
                error_msg = "Cannot connect to Ollama. Please make sure Ollama is running."
            await add_message(conversation_id, "assistant", error_msg)
            yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"

        except Exception as e:
            error_msg = f"An error occurred: {str(e)}"
            await add_message(conversation_id, "assistant", error_msg)
            yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
