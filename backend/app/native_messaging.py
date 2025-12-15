"""Native messaging socket server for secure extension communication."""

import asyncio
import json
import logging
import struct
import sys
from pathlib import Path

from .db import get_memory_by_url, create_memory, update_memory, get_memory, is_db_initialized
from .db.crud import create_conversation, add_message
from .db.search import search_similar_memories
from .schemas import MemoryCreate, format_memory_for_embedding
from .services.embeddings import get_embedding
from .services.ai_processing import process_memory_async, process_conversation_title_async
from .services.ai import chat
from .services.query_processing import preprocess_query, extract_keywords
from .events import event_manager, MemoryEvent, EventType

logger = logging.getLogger(__name__)

# Socket path varies by platform
if sys.platform == "win32":
    SOCKET_PATH = r"\\.\pipe\think-native"
else:
    SOCKET_PATH = Path.home() / ".think" / "native.sock"


class NativeMessagingServer:
    """Async socket server for native messaging communication (Unix/macOS)."""

    def __init__(self):
        self.server = None

    async def start(self):
        """Start the Unix socket server.

        Note: This method only handles Unix sockets. Windows uses a separate
        named pipe server (see native_messaging_win.py).
        """
        if sys.platform == "win32":
            # Windows is handled by WindowsNamedPipeServer in native_messaging_win.py
            return

        # Ensure directory exists
        socket_path = Path(SOCKET_PATH)
        socket_path.parent.mkdir(parents=True, exist_ok=True)

        # Remove existing socket file
        if socket_path.exists():
            socket_path.unlink()

        self.server = await asyncio.start_unix_server(
            self._handle_client,
            path=str(socket_path),
        )

        # Set socket permissions (owner only)
        socket_path.chmod(0o600)

        logger.info(f"Native messaging server listening on {socket_path}")

    async def stop(self):
        """Stop the socket server."""
        if self.server:
            self.server.close()
            await self.server.wait_closed()

            # Clean up socket file
            socket_path = Path(SOCKET_PATH)
            if socket_path.exists():
                socket_path.unlink()

            logger.info("Native messaging server stopped")

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ):
        """Handle a single client connection from the native messaging stub."""
        peer = writer.get_extra_info("peername")
        logger.debug(f"Native messaging client connected: {peer}")

        try:
            while True:
                # Read message length (4 bytes, little-endian)
                length_bytes = await reader.readexactly(4)
                length = struct.unpack("<I", length_bytes)[0]

                # Read message body
                message_bytes = await reader.readexactly(length)
                request = json.loads(message_bytes.decode("utf-8"))

                logger.debug(f"Native message received: {request.get('method')}")

                # Process request
                response = await self._route_request(request)

                # Send response
                response_bytes = json.dumps(response).encode("utf-8")
                writer.write(struct.pack("<I", len(response_bytes)))
                writer.write(response_bytes)
                await writer.drain()

        except asyncio.IncompleteReadError:
            logger.debug("Native messaging client disconnected")
        except Exception as e:
            logger.error(f"Native messaging error: {e}")
        finally:
            writer.close()
            await writer.wait_closed()

    async def _route_request(self, request: dict) -> dict:
        """Route JSON-RPC style request to appropriate handler."""
        request_id = request.get("id")
        method = request.get("method", "")
        params = request.get("params", {})

        # Check if database is unlocked (same as HTTP middleware)
        if not is_db_initialized():
            return {
                "id": request_id,
                "error": {"code": -32001, "message": "Database not unlocked. Please unlock the app first."},
            }

        try:
            if method == "memories.create":
                result = await self._create_memory(params)
            elif method == "memories.update":
                result = await self._update_memory(params)
            elif method == "chat.message":
                result = await self._chat_message(params)
            elif method == "conversations.save":
                result = await self._save_conversation(params)
            elif method == "chat.summarize":
                result = await self._summarize_chat(params)
            else:
                return {
                    "id": request_id,
                    "error": {"code": -32601, "message": f"Unknown method: {method}"},
                }

            return {"id": request_id, "result": result}

        except Exception as e:
            logger.exception(f"Error handling {method}")
            return {
                "id": request_id,
                "error": {"code": -32000, "message": str(e)},
            }

    async def _create_memory(self, params: dict) -> dict:
        """Handle memories.create request."""
        url = params.get("url")
        title = params.get("title", "")
        content = params.get("content", "")

        # Check for duplicate URL
        if url:
            existing = await get_memory_by_url(url)
            if existing:
                return {"duplicate": True, "existing_memory": existing}

        # Generate embedding
        embedding = None
        try:
            embedding = await get_embedding(format_memory_for_embedding(title, content))
        except Exception as e:
            logger.warning(f"Embedding generation failed: {e}")

        # Store original title for web memories (AI will generate cleaner title)
        memory_type = params.get("type", "web")
        original_title = title if memory_type == "web" else None

        result = await create_memory(
            title=title,
            content=content,
            memory_type=memory_type,
            url=url,
            embedding=embedding,
            original_title=original_title,
        )

        memory_id = result["id"]

        # Spawn background task for AI processing
        if content:
            asyncio.create_task(process_memory_async(memory_id))

        # Emit event
        full_memory = await get_memory(memory_id)
        await event_manager.publish(
            MemoryEvent(
                type=EventType.MEMORY_CREATED,
                memory_id=memory_id,
                data=full_memory,
            )
        )

        return result

    async def _update_memory(self, params: dict) -> dict:
        """Handle memories.update request."""
        memory_id = params.get("id")
        if not memory_id:
            raise ValueError("Missing required parameter: id")

        title = params.get("title", "")
        content = params.get("content", "")

        # Generate embedding
        embedding = None
        try:
            embedding = await get_embedding(format_memory_for_embedding(title, content))
        except Exception as e:
            logger.warning(f"Embedding generation failed: {e}")

        result = await update_memory(
            memory_id=memory_id,
            title=title,
            content=content,
            embedding=embedding,
        )

        if not result:
            raise ValueError("Memory not found")

        # Emit event
        full_memory = await get_memory(memory_id)
        await event_manager.publish(
            MemoryEvent(
                type=EventType.MEMORY_UPDATED,
                memory_id=memory_id,
                data=full_memory,
            )
        )

        return result

    async def _chat_message(self, params: dict) -> dict:
        """Handle chat.message request - chat with current page + memories context."""
        message = params.get("message", "")
        page_content = params.get("page_content", "")
        page_url = params.get("page_url", "")
        page_title = params.get("page_title", "")
        history = params.get("history", [])

        if not message:
            raise ValueError("Missing required parameter: message")

        # Build context from current page and relevant memories
        context_parts = []
        sources = []

        # Add current page context
        if page_content:
            # Truncate page content to reasonable size
            truncated_content = page_content[:4000]
            context_parts.append(f"Current page ({page_title or page_url}):\n{truncated_content}")

        # Search for relevant memories based on the user's message
        try:
            processed_query = preprocess_query(message)
            query_embedding = await get_embedding(processed_query)
            keyword_query = extract_keywords(message)

            memories = await search_similar_memories(
                query_embedding=query_embedding,
                limit=10,
                keyword_query=keyword_query,
            )

            if memories:
                # Filter using dynamic threshold based on best match quality
                with_distance = [m for m in memories if m.get("distance") is not None]
                relevant_memories = []

                if with_distance:
                    with_distance.sort(key=lambda m: m["distance"])
                    best_distance = with_distance[0]["distance"]

                    # Only include if best match is good enough (< 0.25)
                    if best_distance < 0.25:
                        threshold = best_distance + 0.1
                        relevant_memories = [m for m in with_distance if m["distance"] <= threshold][:5]

                # Build sources list for the response
                sources = [
                    {"id": m["id"], "title": m["title"], "url": m.get("url")}
                    for m in relevant_memories
                ]

                if relevant_memories:
                    memories_context = "\n\n".join([
                        f"From saved memory '{m['title']}':\n{(m.get('summary') or m['content'][:500])}"
                        for m in relevant_memories
                    ])
                    context_parts.append(f"Relevant saved memories:\n{memories_context}")
        except Exception as e:
            logger.warning(f"Memory search failed: {e}")

        # Combine context
        context = "\n\n---\n\n".join(context_parts) if context_parts else ""

        # Get AI response
        response = await chat(message, context=context, history=history)

        return {"response": response, "sources": sources}

    async def _save_conversation(self, params: dict) -> dict:
        """Save a sidebar conversation to the app's conversation history."""
        messages = params.get("messages", [])
        page_title = params.get("page_title", "")
        page_url = params.get("page_url", "")

        if not messages:
            raise ValueError("No messages to save")

        # Create conversation with temporary title
        temp_title = f"Chat: {page_title or page_url}"[:50]
        conversation = await create_conversation(title=temp_title)
        conversation_id = conversation["id"]

        # Add all messages
        for msg in messages:
            await add_message(
                conversation_id=conversation_id,
                role=msg.get("role", "user"),
                content=msg.get("content", ""),
            )

        # Generate better title in background
        if messages:
            first_user_msg = next((m["content"] for m in messages if m.get("role") == "user"), "")
            if first_user_msg:
                asyncio.create_task(process_conversation_title_async(conversation_id, first_user_msg))

        return {"conversation_id": conversation_id, "title": temp_title}

    async def _summarize_chat(self, params: dict) -> dict:
        """Generate an AI summary of the chat and save it as a memory."""
        messages = params.get("messages", [])
        page_title = params.get("page_title", "")
        page_url = params.get("page_url", "")

        if not messages:
            raise ValueError("No messages to summarize")

        # Build conversation text for summarization
        conversation_text = "\n\n".join([
            f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}"
            for m in messages
        ])

        # Generate summary and title using AI in parallel
        summary_prompt = f"""Summarize the key insights and information from this conversation about "{page_title or page_url}".
Focus on the main topics discussed and any important facts or conclusions.

Conversation:
{conversation_text}

Provide a concise summary (2-4 paragraphs):"""

        title_prompt = f"""Generate a concise, descriptive title for this chat conversation.

Page context: {page_title or page_url}
Conversation:
{conversation_text[:1500]}

Requirements:
- 5-10 words maximum
- Capture the main topic discussed
- Be informative and scannable

Title:"""

        # Run both AI calls in parallel
        summary_task = chat(summary_prompt, context="", history=[])
        title_task = chat(title_prompt, context="", history=[])
        summary, generated_title = await asyncio.gather(summary_task, title_task)

        # Clean up the generated title
        title = generated_title.strip().strip('"')[:100] if generated_title else f"Chat: {page_title or 'Web Page'}"[:100]

        content = f"## Summary of conversation about: {page_title or page_url}\n\n{summary}"
        if page_url:
            content += f"\n\n---\nSource: {page_url}"

        # Generate embedding for the summary
        embedding = None
        try:
            embedding = await get_embedding(format_memory_for_embedding(title, content))
        except Exception as e:
            logger.warning(f"Embedding generation failed: {e}")

        result = await create_memory(
            title=title,
            content=content,
            memory_type="note",
            url=None,  # Don't link to URL since this is a derived note
            embedding=embedding,
            original_title=page_title or page_url,  # Store original context for regeneration
        )

        # Emit MEMORY_CREATED event so frontend updates immediately
        full_memory = await get_memory(result["id"])
        await event_manager.publish(
            MemoryEvent(
                type=EventType.MEMORY_CREATED,
                memory_id=result["id"],
                data=full_memory,
            )
        )

        # Spawn background task for AI processing (tags, summary field)
        asyncio.create_task(process_memory_async(result["id"]))

        return {"memory_id": result["id"], "title": title, "summary": summary}


# Global server instances
_unix_server: NativeMessagingServer | None = None
_windows_server = None  # WindowsNamedPipeServer when on Windows


async def route_request(request: dict) -> dict:
    """Route a native messaging request. Used by both Unix and Windows servers."""
    server = NativeMessagingServer()
    return await server._route_request(request)


async def start_native_messaging_server():
    """Start the native messaging server (platform-appropriate)."""
    global _unix_server, _windows_server

    if sys.platform == "win32":
        # Use Windows named pipe server in separate thread
        from .native_messaging_win import WindowsNamedPipeServer

        _windows_server = WindowsNamedPipeServer(route_request)
        _windows_server.start()
    else:
        # Use Unix socket server
        _unix_server = NativeMessagingServer()
        await _unix_server.start()


async def stop_native_messaging_server():
    """Stop the native messaging server."""
    global _unix_server, _windows_server

    if _unix_server:
        await _unix_server.stop()
        _unix_server = None

    if _windows_server:
        _windows_server.stop()
        _windows_server = None
