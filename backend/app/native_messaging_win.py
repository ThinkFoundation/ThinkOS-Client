"""Windows named pipe server for native messaging.

Runs in a dedicated thread with ProactorEventLoop since uvicorn uses
SelectorEventLoop which doesn't support named pipes on Windows.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import sys
import threading
from typing import Callable, Awaitable, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from asyncio import WriteTransport

logger = logging.getLogger(__name__)

PIPE_NAME = r"\\.\pipe\think-native"


class WindowsPipeProtocol(asyncio.Protocol):
    """Protocol handler for Windows named pipe connections."""

    def __init__(self, message_handler: Callable[[dict], Awaitable[dict]]):
        self.message_handler = message_handler
        self.transport: WriteTransport | None = None
        self.buffer = b""
        self.expected_length: int | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        # Cast to WriteTransport since we know pipes support writing
        self.transport = transport  # type: ignore[assignment]
        logger.debug("Native messaging client connected (Windows pipe)")

    def data_received(self, data: bytes):
        """Handle incoming data with length-prefixed protocol."""
        self.buffer += data
        self._process_buffer()

    def _process_buffer(self):
        """Process buffered data, extracting complete messages."""
        while True:
            # Need at least 4 bytes for length prefix
            if len(self.buffer) < 4:
                return

            if self.expected_length is None:
                self.expected_length = struct.unpack("<I", self.buffer[:4])[0]
                self.buffer = self.buffer[4:]

            # Wait for complete message (expected_length is guaranteed non-None here)
            expected = self.expected_length
            if len(self.buffer) < expected:
                return

            # Extract complete message
            message_bytes = self.buffer[: self.expected_length]
            self.buffer = self.buffer[self.expected_length :]
            self.expected_length = None

            # Process message asynchronously
            try:
                request = json.loads(message_bytes.decode("utf-8"))
                asyncio.create_task(self._handle_message(request))
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON in native message: {e}")

    async def _handle_message(self, request: dict):
        """Handle a complete message and send response."""
        try:
            response = await self.message_handler(request)
        except Exception as e:
            logger.exception("Error handling native message")
            response = {
                "id": request.get("id"),
                "error": {"code": -32000, "message": str(e)},
            }

        # Send response
        response_bytes = json.dumps(response).encode("utf-8")
        if self.transport and not self.transport.is_closing():
            self.transport.write(struct.pack("<I", len(response_bytes)))
            self.transport.write(response_bytes)

    def connection_lost(self, _exc: Exception | None) -> None:
        logger.debug("Native messaging client disconnected (Windows pipe)")


class WindowsNamedPipeServer:
    """Windows named pipe server running in dedicated thread with ProactorEventLoop."""

    def __init__(self, message_handler: Callable[[dict], Awaitable[dict]]):
        self.message_handler = message_handler
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._server: Any = None
        self._stop_event = threading.Event()
        self._started_event = threading.Event()

    def start(self):
        """Start the pipe server in a background thread."""
        self._thread = threading.Thread(target=self._run_server, daemon=True)
        self._thread.start()

        # Wait for server to start (with timeout)
        if not self._started_event.wait(timeout=5.0):
            logger.warning("Windows pipe server start timeout")

    def _run_server(self):
        """Run the pipe server (called in background thread)."""
        # Create ProactorEventLoop for named pipe support
        self._loop = asyncio.new_event_loop()

        # On Windows 3.8+, ProactorEventLoop is the default, but be explicit
        if sys.platform == "win32":
            self._loop = asyncio.ProactorEventLoop()

        asyncio.set_event_loop(self._loop)

        try:
            self._loop.run_until_complete(self._serve())
        except Exception as e:
            logger.error(f"Windows pipe server error: {e}")
        finally:
            self._loop.close()

    async def _serve(self):
        """Main serving coroutine."""

        def protocol_factory():
            return WindowsPipeProtocol(self.message_handler)

        try:
            # Start the pipe server using low-level API
            # Note: start_serving_pipe is only available on ProactorEventLoop (Windows)
            # We use getattr to avoid Pylance errors on non-Windows platforms
            start_serving_pipe = getattr(self._loop, "start_serving_pipe", None)
            if start_serving_pipe is None:
                raise RuntimeError("start_serving_pipe not available - requires ProactorEventLoop on Windows")
            self._server = await start_serving_pipe(protocol_factory, PIPE_NAME)

            logger.info(f"Windows named pipe server listening on {PIPE_NAME}")
            self._started_event.set()

            # Run until stop is requested
            while not self._stop_event.is_set():
                await asyncio.sleep(0.1)

        except Exception as e:
            logger.error(f"Failed to start Windows pipe server: {e}")
            self._started_event.set()  # Unblock start() even on failure
            raise
        finally:
            # Cleanup
            if self._server:
                self._server.close()

    def stop(self):
        """Stop the pipe server."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)
        logger.info("Windows named pipe server stopped")
