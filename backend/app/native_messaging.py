"""Native messaging socket server for secure extension communication."""

import asyncio
import json
import logging
import struct
import sys
from pathlib import Path

from .db import get_memory_by_url, create_memory, update_memory, get_memory, is_db_initialized
from .schemas import MemoryCreate, format_memory_for_embedding
from .services.embeddings import get_embedding
from .services.ai_processing import process_memory_async
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
