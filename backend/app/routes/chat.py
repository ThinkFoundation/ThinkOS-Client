import asyncio
import json
import logging
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])


def filter_memories_dynamically(memories: list[dict], max_results: int = 5) -> list[dict]:
    """Filter memories using distance-based relevance.

    Strategy:
    - Sort by distance (best first)
    - Include results within a range of the best match
    - All match types (hybrid/keyword/vector) must pass distance check
    - Adaptive limits based on best match quality
    """
    if not memories:
        logger.info("No memories to filter")
        return []

    # Sort by distance (lowest/best first)
    sorted_memories = sorted(memories, key=lambda m: m.get("distance") or 999)

    # Log what we're working with
    logger.info(f"Filtering {len(sorted_memories)} memories")
    for m in sorted_memories[:5]:
        dist = m.get('distance')
        dist_str = f"{dist:.3f}" if dist is not None else "N/A"
        rrf = m.get('rrf_score') or 0
        rrf_str = f"{rrf:.4f}" if rrf else "N/A"
        logger.info(f"  [{m.get('match_type', '?')}] {m.get('title', '')[:50]}... dist={dist_str} rrf={rrf_str}")

    # Get the best distance
    best_distance = sorted_memories[0].get("distance") if sorted_memories else None
    if best_distance is None or best_distance >= 0.45:
        logger.info(f"Best match too distant ({best_distance}), returning empty")
        return []

    # Calculate dynamic threshold: include results within range of best
    # Tighter range for better matches, looser for weaker ones
    if best_distance < 0.25:
        # Excellent match: include results within +0.08
        threshold = best_distance + 0.08
        max_results = 5
    elif best_distance < 0.35:
        # Good match: include results within +0.06
        threshold = best_distance + 0.06
        max_results = 3
    else:
        # Marginal match: only include very close results
        threshold = best_distance + 0.04
        max_results = 2

    logger.info(f"Best distance: {best_distance:.3f}, threshold: {threshold:.3f}, max: {max_results}")

    filtered = []
    for m in sorted_memories:
        distance = m.get("distance")
        match_type = m.get("match_type", "vector")

        if distance is None:
            continue

        if distance <= threshold:
            logger.info(f"  Including [{match_type}] (dist={distance:.3f}): {m.get('title', '')[:30]}")
            filtered.append(m)
        else:
            logger.info(f"  Excluding [{match_type}] (dist={distance:.3f} > {threshold:.3f}): {m.get('title', '')[:30]}")

    result = filtered[:max_results]
    logger.info(f"Filtered to {len(result)} memories")
    return result


def format_memories_as_context(memories: list[dict], max_chars: int = 4000) -> str:
    """Format retrieved memories into a context string for the LLM.

    Expects memories to be pre-filtered by filter_memories_dynamically.
    """
    if not memories:
        return ""

    context_parts = []
    total_chars = 0

    for memory in memories:
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

    # Skip RAG for very short messages (< 10 chars)
    if len(request.message.strip()) >= 10:
        try:
            # Preprocess query to improve semantic matching
            processed_query = preprocess_query(request.message)
            keyword_query = extract_keywords(request.message)
            query_embedding = await get_embedding(processed_query)
            similar_memories = await search_similar_memories(
                query_embedding, limit=10, keyword_query=keyword_query
            )

            if similar_memories:
                # Filter using dynamic threshold
                filtered_memories = filter_memories_dynamically(similar_memories)
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

    # Skip RAG for very short messages (< 10 chars)
    if len(request.message.strip()) >= 10:
        try:
            # Preprocess query to improve semantic matching
            processed_query = preprocess_query(request.message)
            keyword_query = extract_keywords(request.message)
            query_embedding = await get_embedding(processed_query)
            similar_memories = await search_similar_memories(
                query_embedding, limit=10, keyword_query=keyword_query
            )

            if similar_memories:
                # Filter using dynamic threshold
                filtered_memories = filter_memories_dynamically(similar_memories)
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
            logger.error(f"RAG retrieval error: {e}")

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
            done_data: dict = {'type': 'done'}
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
