"""Query rewriting for context-dependent follow-up messages."""

import logging
import re

from .client import get_client, get_model

logger = logging.getLogger(__name__)

# Patterns indicating follow-up queries
FOLLOWUP_PATTERNS = [
    r"\b(this|that|these|those|it)\b",  # Demonstrative pronouns
    r"\b(the same|mentioned|discussed)\b",  # References
    r"^(and|also|plus)\b",  # Continuations
    r"\b(more|else|another)\b.*\b(about|on)\b",  # "more about"
    r"^(explain|elaborate|expand|clarify)\b",  # Elaboration requests
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in FOLLOWUP_PATTERNS]


def needs_rewriting(query: str, history: list[dict]) -> bool:
    """Detect if query needs context from conversation history."""
    if not history:
        return False

    query_lower = query.lower().strip()

    # Short queries with history are likely follow-ups
    if len(query_lower) < 25 and len(history) >= 2:
        return True

    # Check for follow-up patterns
    for pattern in COMPILED_PATTERNS:
        if pattern.search(query_lower):
            return True

    # Check if query produces minimal keywords
    from ..query.processing import extract_keywords

    keywords = extract_keywords(query)
    if (not keywords or len(keywords.split(" OR ")) <= 1) and len(history) >= 2:
        return True

    return False


def format_history_for_rewrite(history: list[dict], max_turns: int = 4) -> str:
    """Format recent conversation for rewrite prompt."""
    recent = history[-max_turns:]
    formatted = []
    for msg in recent:
        role = "User" if msg["role"] == "user" else "Assistant"
        content = msg["content"][:500] + "..." if len(msg["content"]) > 500 else msg["content"]
        formatted.append(f"{role}: {content}")
    return "\n".join(formatted)


async def rewrite_query(query: str, history: list[dict]) -> str:
    """Rewrite vague query using conversation context."""
    if not history:
        return query

    history_text = format_history_for_rewrite(history)

    prompt = f"""Given this conversation:
{history_text}

The user now asks: "{query}"

Rewrite this query to be self-contained for searching a knowledge base.
- Replace pronouns (this, that, it) with actual topics
- Include key terms from the conversation
- Keep it under 50 words
- Output ONLY the rewritten query

Rewritten query:"""

    try:
        client = await get_client()
        model = get_model()

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "Rewrite follow-up questions to be self-contained for search. Be concise. Output only the rewritten query.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=100,
            temperature=0.3,
        )

        rewritten = (
            response.choices[0].message.content.strip()
            if response.choices[0].message.content
            else query
        )

        # Clean artifacts
        if rewritten.startswith('"') and rewritten.endswith('"'):
            rewritten = rewritten[1:-1]
        if rewritten.lower().startswith("rewritten query:"):
            rewritten = rewritten[16:].strip()

        logger.info(f"Query rewritten: '{query}' -> '{rewritten}'")
        return rewritten

    except Exception as e:
        logger.error(f"Query rewrite failed: {e}")
        return query


async def maybe_rewrite_query(query: str, history: list[dict]) -> tuple[str, bool]:
    """Check if rewriting needed and perform it."""
    if needs_rewriting(query, history):
        rewritten = await rewrite_query(query, history)
        return rewritten, True
    return query, False
