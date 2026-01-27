"""
Query preprocessing for improved memory retrieval.

Transforms question-style queries into statement-style queries that better
match stored memory content for embedding similarity search.
"""

import logging
import re

logger = logging.getLogger(__name__)

# Question patterns to transform - order matters (more specific first)
QUESTION_PATTERNS = [
    # "What did I save/have about X?" -> "X"
    (r"^what (?:do i|did i|have i) (?:have|save|store|keep|saved|stored) (?:about|on|regarding|for) (.+?)\??$", r"\1"),
    # "What is/are X?" -> "X"
    (r"^what (?:is|are|was|were) (.+?)\??$", r"\1"),
    # "How do/does/can/to X?" -> "X"
    (r"^how (?:do|does|did|can|could|to|should) (.+?)\??$", r"\1"),
    # "Show me/find/search X" -> "X"
    (r"^(?:show me|find|search|search for|look for|get) (?:my )?(?:memories? )?(?:about |on |regarding |for )?(.+?)\??$", r"\1"),
    # "Anything/something about X" -> "X"
    (r"^(?:anything|something|everything) (?:about|on|regarding|for) (.+?)\??$", r"\1"),
    # "Do I have anything about X?" -> "X"
    (r"^do i have (?:anything|something|any|a) (?:about|on|regarding|for|saved about) (.+?)\??$", r"\1"),
    # "Tell me about X" -> "X"
    (r"^(?:tell me|remind me) (?:about|of) (.+?)\??$", r"\1"),
    # "Where did I read about X?" -> "X"
    (r"^where (?:did i|have i) (?:read|see|find|save) (?:about|that) (.+?)\??$", r"\1"),
]


def preprocess_query(query: str) -> str:
    """
    Transform question-style queries into statement-style for better embedding match.

    Examples:
        "What did I save about React hooks?" -> "React hooks"
        "Show me my notes on Python" -> "notes on Python"
        "How does async await work?" -> "async await work"
        "React tutorial" -> "React tutorial" (unchanged)

    Returns the original query if no transformation applies.
    """
    query_stripped = query.strip()

    for pattern, replacement in QUESTION_PATTERNS:
        match = re.match(pattern, query_stripped, re.IGNORECASE)
        if match:
            result = re.sub(pattern, replacement, query_stripped, flags=re.IGNORECASE)
            logger.info(f"Query transformed: '{query_stripped}' -> '{result.strip()}'")
            return result.strip()

    logger.info(f"Query unchanged: '{query_stripped}'")
    return query_stripped


def extract_keywords(query: str) -> str:
    """
    Extract keywords from query for FTS5 matching.

    Removes common stop words and formats for FTS5 OR query syntax.

    Examples:
        "What did I save about React hooks?" -> "React OR hooks"
        "the quick brown fox" -> "quick OR brown OR fox"
    """
    stop_words = {
        'what', 'did', 'do', 'does', 'i', 'have', 'save', 'saved', 'about',
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'my', 'me', 'show',
        'find', 'search', 'for', 'on', 'in', 'to', 'of', 'and', 'or', 'how',
        'where', 'when', 'why', 'can', 'could', 'would', 'should', 'tell',
        'anything', 'something', 'everything', 'any', 'some', 'get', 'look',
        'remind', 'read', 'see', 'that', 'this', 'with', 'from', 'it', 'be',
    }

    # Remove punctuation and split
    cleaned = re.sub(r'[^\w\s]', ' ', query.lower())
    words = cleaned.split()

    # Filter stop words and short words
    keywords = [w for w in words if w not in stop_words and len(w) > 2]

    if not keywords:
        # Fallback: use all words over 2 chars
        keywords = [w for w in words if len(w) > 2]

    # FTS5 OR query for flexibility
    result = ' OR '.join(keywords) if keywords else query
    logger.info(f"Keywords extracted: '{query}' -> '{result}'")
    return result
