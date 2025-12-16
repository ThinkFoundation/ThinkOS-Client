"""Chat suggestion generation service."""
import json
import logging
import re
import threading
from datetime import datetime, timedelta, timezone

from .ai import get_client, get_model
from ..db.crud import get_memories, get_all_tags

logger = logging.getLogger(__name__)


class SuggestionsCache:
    """Thread-safe cache for suggestions with TTL."""

    def __init__(self, ttl_minutes: int = 5):
        self._lock = threading.Lock()
        self._prompts: list[dict] | None = None
        self._expires_at: datetime | None = None
        self._ttl = timedelta(minutes=ttl_minutes)

    def get(self) -> list[dict] | None:
        """Get cached prompts if still valid."""
        with self._lock:
            if self._prompts and self._expires_at:
                if self._expires_at > datetime.now(timezone.utc):
                    return self._prompts
            return None

    def set(self, prompts: list[dict]) -> None:
        """Cache prompts with TTL."""
        with self._lock:
            self._prompts = prompts
            self._expires_at = datetime.now(timezone.utc) + self._ttl

    def clear(self) -> None:
        """Clear the cache."""
        with self._lock:
            self._prompts = None
            self._expires_at = None


_suggestions_cache = SuggestionsCache()

# Special prompts with their handlers - these use date-based retrieval
SPECIAL_PROMPTS = [
    {
        "id": "recent-summary",
        "text": "Summarize what I learned recently",
        "type": "special",
        "handler": "recent_memories",
    },
    {
        "id": "find-connections",
        "text": "What connections exist between my memories?",
        "type": "special",
        "handler": "recent_connections",
    },
]


async def get_quick_prompts() -> list[dict]:
    """Generate quick prompts: 2 special + 2-3 dynamic from memories/tags.

    Results are cached for 5 minutes to avoid hitting the DB on every chat open.
    """
    # Return cached prompts if valid
    cached = _suggestions_cache.get()
    if cached is not None:
        return cached

    prompts = []

    # Add special prompts (handled with date-based retrieval)
    prompts.extend(SPECIAL_PROMPTS[:2])

    try:
        # Get recent memories for dynamic topic-based suggestions
        recent_memories, _ = await get_memories(limit=10, date_filter="week")

        if recent_memories:
            # Pick memories with good titles (not too short, not generic)
            good_memories = [
                m for m in recent_memories
                if m.get("title") and len(m["title"]) > 15
            ]

            # Add 1-2 topic-based prompts from recent memory titles
            for i, mem in enumerate(good_memories[:2]):
                title = mem["title"]
                # Truncate long titles
                if len(title) > 50:
                    title = title[:47] + "..."
                prompts.append({
                    "id": f"topic-{mem['id']}",
                    "text": f"Tell me about {title}",
                    "type": "dynamic",
                    "source": "recent_memory",
                })

        # Add 1 tag-based prompt from popular tags
        tags = await get_all_tags()
        if tags:
            # Find a tag with at least 2 uses
            popular_tags = [t for t in tags if t.get("usage_count", 0) >= 2]
            if popular_tags:
                tag = popular_tags[0]
                prompts.append({
                    "id": f"tag-{tag['name']}",
                    "text": f"What have I saved about {tag['name']}?",
                    "type": "dynamic",
                    "source": "popular_tag",
                })
    except Exception as e:
        logger.warning(f"Failed to generate dynamic prompts: {e}")
        # Continue with just special prompts

    # Limit to 5 total prompts
    prompts = prompts[:5]

    # Cache the results
    _suggestions_cache.set(prompts)

    return prompts


async def generate_followup_suggestions(
    user_message: str,
    assistant_response: str,
    sources: list[dict] | None = None,
) -> list[str]:
    """Generate 2-3 contextual follow-up questions using LLM.

    Args:
        user_message: The user's original message
        assistant_response: The AI's response
        sources: List of retrieved memory sources (optional)

    Returns:
        List of 2-3 follow-up question strings, or empty list on failure
    """
    try:
        client = await get_client()
        model = get_model()

        # Build context from sources
        source_context = ""
        if sources:
            source_titles = [s.get("title", "Untitled") for s in sources[:3] if s.get("title")]
            if source_titles:
                source_context = f"\nRetrieved memories: {', '.join(source_titles)}"

        prompt = f"""Based on this conversation, suggest 2-3 natural follow-up questions the user might ask.

User asked: {user_message[:500]}

Assistant responded: {assistant_response[:1000]}
{source_context}

Requirements:
- Questions should be specific and actionable
- Reference the actual content discussed
- If memories were retrieved, consider questions about those topics
- Keep questions concise (under 15 words each)
- Make them genuinely useful, not generic
- Do NOT suggest questions like "tell me more" or "can you elaborate"

Return ONLY a JSON array of 2-3 question strings, like: ["Question 1?", "Question 2?"]"""

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "Generate helpful follow-up questions. Return only valid JSON array of strings.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=150,
            temperature=0.7,
        )

        result = response.choices[0].message.content
        if not result:
            logger.warning("LLM returned empty content for follow-ups")
            return []

        result = result.strip()
        logger.debug(f"Raw follow-up response: {result[:200]}")

        # Handle markdown code blocks
        if result.startswith("```"):
            lines = result.split("\n")
            # Remove first and last lines (```json and ```)
            result = "\n".join(lines[1:-1] if len(lines) > 2 else lines)
            result = result.strip()

        # Try to parse as JSON
        try:
            suggestions = json.loads(result)
            if isinstance(suggestions, list):
                # Clean and validate suggestions
                cleaned = []
                for s in suggestions[:3]:
                    if isinstance(s, str) and s.strip():
                        cleaned.append(s.strip())
                return cleaned
        except json.JSONDecodeError as e:
            logger.warning(f"JSON parse failed: {e}, trying fallback extraction")

        # Fallback: extract questions from text (lines ending with ?)
        questions = re.findall(r'["\']?([^"\']+\?)["\']?', result)
        if questions:
            cleaned = [q.strip() for q in questions[:3] if len(q.strip()) > 10]
            if cleaned:
                logger.info(f"Extracted {len(cleaned)} questions via fallback")
                return cleaned

        logger.warning(f"Could not extract follow-ups from: {result[:100]}")
        return []

    except Exception as e:
        logger.error(f"Failed to generate follow-up suggestions: {e}", exc_info=True)
        return []


def clear_suggestions_cache() -> None:
    """Clear the suggestions cache. Useful when memories are added/deleted."""
    _suggestions_cache.clear()
