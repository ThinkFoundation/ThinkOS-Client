"""Special handlers for prompts that need custom retrieval strategies.

These handlers bypass embedding-based search for generic queries like
"summarize what I learned recently" which don't have meaningful semantic content.
Instead, they use date-based retrieval or other strategies.
"""
import logging

from ..db.crud import get_memories

logger = logging.getLogger(__name__)


async def handle_recent_memories(message: str) -> tuple[str, list[dict]]:
    """Handle 'summarize recent' type prompts with date-based retrieval.

    Returns:
        Tuple of (context_string, sources_list)
    """
    # Get memories from the last week
    memories, _ = await get_memories(limit=10, date_filter="week")

    if not memories:
        return "", []

    # Format as context
    context_parts = []
    for mem in memories:
        title = mem.get("title", "Untitled")
        summary = mem.get("summary") or ""

        # Include tags if available
        tags = mem.get("tags", [])
        tags_str = ""
        if tags:
            tag_names = [t["name"] for t in tags[:5]]
            tags_str = f" [Tags: {', '.join(tag_names)}]"

        context_parts.append(f"### {title}{tags_str}\n{summary}")

    context = "## Recent Memories (last 7 days):\n\n" + "\n\n---\n\n".join(context_parts)

    sources = [
        {"id": m["id"], "title": m.get("title", "Untitled"), "url": m.get("url")}
        for m in memories
    ]

    return context, sources


async def handle_recent_connections(message: str) -> tuple[str, list[dict]]:
    """Handle 'find connections' prompts with diverse memory retrieval.

    Returns:
        Tuple of (context_string, sources_list)
    """
    # Get memories from the last month for broader view
    memories, _ = await get_memories(limit=15, date_filter="month")

    if not memories:
        return "", []

    # Format context emphasizing topics and tags for finding connections
    context_parts = []
    for mem in memories:
        title = mem.get("title", "Untitled")
        summary = mem.get("summary") or ""

        # Include tags prominently for connection finding
        tags = mem.get("tags", [])
        tags_str = ""
        if tags:
            tag_names = [t["name"] for t in tags]
            tags_str = f"\nTags: {', '.join(tag_names)}"

        context_parts.append(f"### {title}{tags_str}\n{summary}")

    context = (
        "## Your Memories (analyze for connections):\n\n"
        + "\n\n---\n\n".join(context_parts)
    )

    sources = [
        {"id": m["id"], "title": m.get("title", "Untitled"), "url": m.get("url")}
        for m in memories
    ]

    return context, sources


# Registry of special handlers
SPECIAL_HANDLERS = {
    "recent_memories": handle_recent_memories,
    "recent_connections": handle_recent_connections,
}


async def is_special_prompt(message: str) -> str | None:
    """Check if message matches a special prompt pattern.

    Returns:
        Handler name if matched, None otherwise
    """
    message_lower = message.lower().strip()

    # Pattern matching for recent/summary prompts
    if any(
        phrase in message_lower
        for phrase in [
            "summarize what i learned recently",
            "what did i learn recently",
            "summarize my recent",
            "what have i learned lately",
            "recent learnings",
            "summarize what i saved recently",
        ]
    ):
        return "recent_memories"

    # Pattern matching for connection prompts
    if any(
        phrase in message_lower
        for phrase in [
            "connections exist between",
            "what connections",
            "find connections",
            "how are my memories connected",
            "connections between my memories",
            "relate to each other",
        ]
    ):
        return "recent_connections"

    return None


async def execute_special_handler(
    handler_name: str, message: str
) -> tuple[str, list[dict]]:
    """Execute a special handler and return (context, sources).

    Args:
        handler_name: Name of the handler to execute
        message: The user's message

    Returns:
        Tuple of (context_string, sources_list)
    """
    handler = SPECIAL_HANDLERS.get(handler_name)
    if not handler:
        logger.warning(f"Unknown special handler: {handler_name}")
        return "", []

    try:
        return await handler(message)
    except Exception as e:
        logger.error(f"Special handler {handler_name} failed: {e}")
        return "", []
