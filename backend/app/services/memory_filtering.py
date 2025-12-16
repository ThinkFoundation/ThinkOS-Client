"""Shared memory filtering logic for RAG retrieval."""

import logging

logger = logging.getLogger(__name__)

# Model-specific cosine distance thresholds
# Different embedding models have different distance distributions
MODEL_THRESHOLDS = {
    "ollama:mxbai-embed-large": {"excellent": 0.25, "good": 0.35, "cutoff": 0.45},
    "ollama:snowflake-arctic-embed": {"excellent": 0.25, "good": 0.35, "cutoff": 0.45},
    "openai:text-embedding-3-small": {"excellent": 0.40, "good": 0.50, "cutoff": 0.60},
    "openai:text-embedding-3-large": {"excellent": 0.28, "good": 0.38, "cutoff": 0.48},
}
DEFAULT_THRESHOLDS = {"excellent": 0.25, "good": 0.35, "cutoff": 0.45}


def filter_memories_dynamically(
    memories: list[dict], max_results: int = 5, embedding_model: str | None = None
) -> list[dict]:
    """Filter memories using distance-based relevance.

    Strategy:
    - Sort by distance (best first)
    - Include results within a range of the best match
    - All match types (hybrid/keyword/vector) must pass distance check
    - Adaptive limits based on best match quality
    - Use model-specific thresholds when available
    """
    if not memories:
        logger.info("No memories to filter")
        return []

    # Get model-specific thresholds
    thresholds = (
        MODEL_THRESHOLDS.get(embedding_model, DEFAULT_THRESHOLDS)
        if embedding_model
        else DEFAULT_THRESHOLDS
    )

    # Sort by distance (lowest/best first)
    sorted_memories = sorted(memories, key=lambda m: m.get("distance") or 999)

    # Log what we're working with
    logger.info(f"Filtering {len(sorted_memories)} memories (model: {embedding_model})")
    for m in sorted_memories[:5]:
        dist = m.get("distance")
        dist_str = f"{dist:.3f}" if dist is not None else "N/A"
        rrf = m.get("rrf_score") or 0
        rrf_str = f"{rrf:.4f}" if rrf else "N/A"
        logger.info(
            f"  [{m.get('match_type', '?')}] {m.get('title', '')[:50]}... dist={dist_str} rrf={rrf_str}"
        )

    # Get the best distance
    best_distance = sorted_memories[0].get("distance") if sorted_memories else None
    if best_distance is None or best_distance >= thresholds["cutoff"]:
        logger.info(
            f"Best match too distant ({best_distance} >= {thresholds['cutoff']}), returning empty"
        )
        return []

    # Calculate dynamic threshold: include results within range of best
    # Tighter range for better matches, looser for weaker ones
    if best_distance < thresholds["excellent"]:
        # Excellent match: include results within +0.08
        threshold = best_distance + 0.08
        max_results = 5
    elif best_distance < thresholds["good"]:
        # Good match: include results within +0.06
        threshold = best_distance + 0.06
        max_results = 3
    else:
        # Marginal match: only include very close results
        threshold = best_distance + 0.04
        max_results = 2

    logger.info(
        f"Best distance: {best_distance:.3f}, threshold: {threshold:.3f}, max: {max_results}"
    )

    filtered = []
    for m in sorted_memories:
        distance = m.get("distance")
        match_type = m.get("match_type", "vector")

        if distance is None:
            continue

        if distance <= threshold:
            logger.info(
                f"  Including [{match_type}] (dist={distance:.3f}): {m.get('title', '')[:30]}"
            )
            filtered.append(m)
        else:
            logger.info(
                f"  Excluding [{match_type}] (dist={distance:.3f} > {threshold:.3f}): {m.get('title', '')[:30]}"
            )

    result = filtered[:max_results]
    logger.info(f"Filtered to {len(result)} memories")
    return result


def format_memories_as_context(memories: list[dict], max_chars: int = 8000) -> str:
    """Format retrieved memories into a context string for the LLM.

    Expects memories to be pre-filtered by filter_memories_dynamically.
    Uses more generous limits to give LLM more context for valuable answers.
    """
    if not memories:
        return ""

    context_parts = []
    total_chars = 0

    for memory in memories:
        title = memory.get("title", "Untitled")
        content = memory.get("content", "")

        # Truncate content if too long (increased from 800 to 2000 for richer context)
        if len(content) > 2000:
            content = content[:2000] + "..."

        entry = f"### {title}\n{content}"

        # Check if adding this would exceed limit
        if total_chars + len(entry) > max_chars:
            break

        context_parts.append(entry)
        total_chars += len(entry)

    if not context_parts:
        return ""

    return "## Relevant Memories:\n\n" + "\n\n---\n\n".join(context_parts)
