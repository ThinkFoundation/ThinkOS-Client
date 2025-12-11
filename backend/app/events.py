"""Event manager for real-time memory updates via SSE."""

import asyncio
import json
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    MEMORY_CREATED = "memory_created"
    MEMORY_UPDATED = "memory_updated"
    MEMORY_DELETED = "memory_deleted"
    CONVERSATION_CREATED = "conversation_created"
    CONVERSATION_UPDATED = "conversation_updated"
    CONVERSATION_DELETED = "conversation_deleted"


@dataclass
class MemoryEvent:
    type: EventType
    memory_id: int
    data: dict[str, Any] | None = None

    def to_sse(self) -> str:
        """Format as SSE message."""
        payload = {
            "type": self.type.value,
            "memory_id": self.memory_id,
            "data": self.data,
        }
        return f"data: {json.dumps(payload)}\n\n"


class EventManager:
    """Simple pub/sub for memory events."""

    def __init__(self):
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        """Create a new subscriber queue."""
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        """Remove a subscriber."""
        self._subscribers.discard(queue)

    async def publish(self, event: MemoryEvent) -> None:
        """Publish event to all subscribers."""
        for queue in self._subscribers:
            await queue.put(event)


# Global event manager instance
event_manager = EventManager()
