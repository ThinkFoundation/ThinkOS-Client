import asyncio
import json
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openai import APIConnectionError

from ..services.ai import chat as ai_chat, chat_stream as ai_chat_stream, get_model
from ..models_info import get_context_window
from ..services.ai_processing import process_conversation_title_async
from ..services.embeddings import get_embedding, get_current_embedding_model
from ..services.query_processing import preprocess_query, extract_keywords
from ..services.query_rewriting import maybe_rewrite_query
from ..services.suggestions import get_quick_prompts, generate_followup_suggestions
from ..services.special_handlers import is_special_prompt, execute_special_handler
from ..services.memory_filtering import filter_memories_dynamically, format_memories_as_context
from ..db.search import search_similar_memories
from ..schemas import ChatRequest
from .. import config
from ..db.crud import create_conversation, add_message, update_conversation_title, get_conversation
from ..events import event_manager, MemoryEvent, EventType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])


@router.get("/chat/suggestions")
async def chat_suggestions():
    """Get dynamic quick prompts for starting a conversation.

    Returns a mix of special prompts (handled with date-based retrieval)
    and dynamic prompts based on user's recent memories and tags.
    """
    try:
        prompts = await get_quick_prompts()
        return {
            "quick_prompts": prompts,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.error(f"Failed to generate suggestions: {e}")
        # Fallback to static prompts
        return {
            "quick_prompts": [
                {"id": "fallback-1", "text": "Summarize what I learned recently", "type": "special"},
                {"id": "fallback-2", "text": "What connections exist between my memories?", "type": "special"},
            ],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }


async def _retrieve_context(message: str, history: list[dict]) -> tuple[str, list[dict]]:
    """Retrieve relevant context and sources using RAG.

    Returns:
        tuple[str, list[dict]]: (context string, list of source dicts)
    """
    context = ""
    sources = []

    # Skip RAG for very short messages (< 10 chars)
    if len(message.strip()) < 10:
        return context, sources

    try:
        # Check for special prompts that need date-based retrieval
        special_handler = await is_special_prompt(message)

        if special_handler:
            # Use special handler (date-based retrieval) for generic prompts
            logger.info(f"Using special handler: {special_handler}")
            context, sources = await execute_special_handler(special_handler, message)
        else:
            # Normal RAG flow with embedding search
            # Query rewriting for follow-up messages
            search_query, was_rewritten = await maybe_rewrite_query(message, history)
            if was_rewritten:
                logger.info(f"Using rewritten query for RAG: '{search_query}'")

            # Preprocess query to improve semantic matching
            processed_query = preprocess_query(search_query)
            keyword_query = extract_keywords(search_query)
            query_embedding = await get_embedding(processed_query)
            embedding_model = get_current_embedding_model()
            similar_memories = await search_similar_memories(
                query_embedding, limit=10, keyword_query=keyword_query
            )

            if similar_memories:
                # Filter using dynamic threshold with model-specific thresholds
                filtered_memories = filter_memories_dynamically(similar_memories, embedding_model=embedding_model)
                context = format_memories_as_context(filtered_memories)
                # Build sources list from filtered memories
                sources = [
                    {
                        "id": m["id"],
                        "title": m["title"],
                        "url": m.get("url"),
                        "distance": m.get("distance"),
                        "match_type": m.get("match_type", "vector"),
                        "rrf_score": m.get("rrf_score"),
                    }
                    for m in filtered_memories
                ]
    except Exception as e:
        # RAG is an enhancement, not required - log and continue
        logger.error(f"RAG retrieval error: {e}")

    return context, sources


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
    await add_message(conversation_id, "user", request.message)

    # Set conversation title from first message if new
    if is_new_conversation:
        # Set temporary truncated title immediately
        temp_title = request.message[:50] + ("..." if len(request.message) > 50 else "")
        await update_conversation_title(conversation_id, temp_title)

        # Generate AI title in background
        asyncio.create_task(process_conversation_title_async(conversation_id, request.message))

    # --- Get conversation history (moved earlier for query rewriting) ---
    history = []
    conv_data = await get_conversation(conversation_id)
    if conv_data and conv_data.get("messages"):
        # Exclude the message we just added (it's the current user message)
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in conv_data["messages"][:-1]
        ]

    # --- RAG: Retrieve relevant memories ---
    context, sources = await _retrieve_context(request.message, history)

    try:
        response = await ai_chat(request.message, context=context, history=history)

        # Save assistant message with sources
        await add_message(conversation_id, "assistant", response, sources=sources)

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

    # Get conversation history (moved earlier for query rewriting)
    history = []
    conv_data = await get_conversation(conversation_id)
    if conv_data and conv_data.get("messages"):
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in conv_data["messages"][:-1]
        ]

    # RAG: Retrieve relevant memories
    context, sources = await _retrieve_context(request.message, history)

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
            done_data: dict = {'type': 'done'}
            if usage_data:
                done_data['usage'] = usage_data
                done_data['context_window'] = get_context_window(get_model())
            yield f"data: {json.dumps(done_data)}\n\n"

            # Generate and send follow-up suggestions (non-blocking)
            try:
                followups = await generate_followup_suggestions(
                    request.message,
                    full_response,
                    sources,
                )
                if followups:
                    yield f"data: {json.dumps({'type': 'followups', 'suggestions': followups})}\n\n"
            except Exception as e:
                logger.warning(f"Follow-up generation failed: {e}")
                # Silent failure - don't break the chat

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
