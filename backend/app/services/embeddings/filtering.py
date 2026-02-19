"""Shared memory filtering logic for RAG retrieval."""

import logging
from datetime import datetime

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

# Budget constants
BUDGET_FLOOR_CHARS = 2000
BUDGET_CEILING_CHARS = 60000
DEFAULT_BUDGET_CHARS = 8000
SYSTEM_PROMPT_CHARS_ESTIMATE = 500
RESPONSE_RESERVE_TOKENS = 1024
CHARS_PER_TOKEN = 4


def compute_context_budget(
    context_window_tokens: int,
    history: list[dict],
    system_prompt_chars: int = SYSTEM_PROMPT_CHARS_ESTIMATE,
    response_reserve_tokens: int = RESPONSE_RESERVE_TOKENS,
) -> int:
    """Compute how many characters of memory context we can fit.

    Estimates token usage for system prompt, conversation history, and
    response reserve, then returns the remaining space as characters.
    Result is clamped between BUDGET_FLOOR_CHARS and BUDGET_CEILING_CHARS.
    """
    # Estimate tokens used by history
    history_chars = sum(len(m.get("content", "")) for m in history)
    history_tokens = history_chars // CHARS_PER_TOKEN

    # Estimate tokens used by system prompt
    system_tokens = system_prompt_chars // CHARS_PER_TOKEN

    # Reserve at least response_reserve_tokens or 10% of window, whichever is larger
    effective_reserve = max(response_reserve_tokens, context_window_tokens // 10)

    # Available tokens for context
    available_tokens = context_window_tokens - system_tokens - history_tokens - effective_reserve

    # Convert to chars
    available_chars = available_tokens * CHARS_PER_TOKEN

    budget = max(BUDGET_FLOOR_CHARS, min(BUDGET_CEILING_CHARS, available_chars))
    logger.info(
        f"Context budget: {budget} chars "
        f"(window={context_window_tokens}, history_tokens={history_tokens}, "
        f"available_tokens={available_tokens})"
    )
    return budget


def filter_memories_dynamically(
    memories: list[dict],
    embedding_model: str | None = None,
    context_budget_chars: int = DEFAULT_BUDGET_CHARS,
) -> list[dict]:
    """Filter memories using distance-based relevance.

    Strategy:
    - Sort by distance (best first)
    - Include results within a range of the best match
    - All match types (hybrid/keyword/vector) must pass distance check
    - Adaptive limits based on best match quality
    - Use model-specific thresholds when available
    - Scale max_results caps based on context_budget_chars
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

    # Budget scaling factor: how much bigger is our budget vs the 8k default?
    budget_scale = context_budget_chars / DEFAULT_BUDGET_CHARS

    # Sort by distance (lowest/best first)
    sorted_memories = sorted(memories, key=lambda m: m.get("distance") or 999)

    # Log what we're working with
    logger.info(f"Filtering {len(sorted_memories)} memories (model: {embedding_model}, budget_scale: {budget_scale:.1f}x)")
    for m in sorted_memories[:5]:
        dist = m.get("distance")
        dist_str = f"{dist:.3f}" if dist is not None else "N/A"
        rrf = m.get("rrf_score") or 0
        rrf_str = f"{rrf:.4f}" if rrf else "N/A"
        logger.debug(
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
    # Scale max_results based on budget (capped at reasonable limits)
    # Widen acceptance range when we have more budget to fill:
    # at 2x budget add +0.01, at 4x add +0.02, capped at +0.03
    budget_bonus = min(0.03, max(0.0, (budget_scale - 1.0) * 0.01))

    if best_distance < thresholds["excellent"]:
        threshold = best_distance + 0.08 + budget_bonus
        max_results = min(10, max(5, int(5 * budget_scale)))
    elif best_distance < thresholds["good"]:
        threshold = best_distance + 0.06 + budget_bonus
        max_results = min(8, max(3, int(3 * budget_scale)))
    else:
        # Marginal match: half the bonus to stay conservative
        threshold = best_distance + 0.04 + (budget_bonus * 0.5)
        max_results = min(4, max(2, int(2 * budget_scale)))

    # Never exceed the model's absolute cutoff
    threshold = min(threshold, thresholds["cutoff"])

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
            logger.debug(
                f"  Including [{match_type}] (dist={distance:.3f}): {m.get('title', '')[:30]}"
            )
            filtered.append(m)
        else:
            logger.debug(
                f"  Excluding [{match_type}] (dist={distance:.3f} > {threshold:.3f}): {m.get('title', '')[:30]}"
            )

    result = filtered[:max_results]
    logger.info(
        f"Filter stats: {{"
        f"input: {len(memories)}, output: {len(result)}, "
        f"best_distance: {best_distance:.4f}, threshold: {threshold:.4f}, "
        f"budget_scale: {budget_scale:.2f}, budget_bonus: {budget_bonus:.4f}, "
        f"max_results_cap: {max_results}, model: {embedding_model or 'default'}"
        f"}}"
    )
    return result


def _format_metadata_line(memory: dict) -> str:
    """Build a compact metadata line: memory type + saved date."""
    memory_type = memory.get("type") or memory.get("memory_type") or "note"
    created = memory.get("created_at") or memory.get("date")
    if created:
        if isinstance(created, str):
            try:
                dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                date_str = dt.strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                date_str = ""
        elif isinstance(created, datetime):
            date_str = created.strftime("%Y-%m-%d")
        else:
            date_str = ""
    else:
        date_str = ""
    parts = [memory_type]
    if date_str:
        parts.append(f"saved {date_str}")
    return f"[{' | '.join(parts)}]"


def format_memories_as_context(memories: list[dict], max_chars: int = DEFAULT_BUDGET_CHARS) -> str:
    """Format retrieved memories into a context string for the LLM.

    Expects memories to be pre-filtered by filter_memories_dynamically.
    Dynamically allocates space per memory and includes AI-generated
    summaries as overview (for long content) or fallback (when truncated).
    """
    if not memories:
        return ""

    num_memories = len(memories)
    # Per-memory char budget (floor of 2000 to keep each entry meaningful)
    per_memory_limit = max(2000, max_chars // num_memories)

    context_parts = []
    total_chars = 0
    summaries_used = 0

    for memory in memories:
        title = memory.get("title", "Untitled")
        content = memory.get("content", "")
        summary = memory.get("summary") or ""
        metadata = _format_metadata_line(memory)

        # Build the entry
        header = f"### {title}\n{metadata}"
        header_len = len(header) + 1  # +1 for newline

        # Remaining space for this memory's body
        body_budget = min(per_memory_limit, max_chars - total_chars) - header_len
        if body_budget <= 0:
            # Try to squeeze in just the summary as a last-resort entry
            if summary:
                summary_entry = f"{header}\n{summary}"
                if total_chars + len(summary_entry) <= max_chars:
                    context_parts.append(summary_entry)
                    total_chars += len(summary_entry)
            break

        # Decide what body content to include
        content_needs_truncation = len(content) > body_budget
        summary_included = False

        if summary and not content_needs_truncation:
            # Content fits fully: include summary as overview + full content
            body = f"{summary}\n\n{content}"
            if len(body) > body_budget:
                # Summary + full content exceeds budget, just use content
                body = content
            else:
                summary_included = True
        elif content_needs_truncation and summary:
            # Content must be truncated: include summary as fallback + truncated content
            # Reserve space for summary line
            summary_line = f"{summary}\n\n"
            content_budget = body_budget - len(summary_line)
            if content_budget > 200:
                body = f"{summary_line}{content[:content_budget]}..."
                summary_included = True
            else:
                # Not enough room for both; use summary alone
                body = summary
                summary_included = True
        else:
            # No summary available: just use content directly
            if len(content) > body_budget:
                body = content[:body_budget] + "..."
            else:
                body = content

        if summary_included:
            summaries_used += 1

        entry = f"{header}\n{body}"

        # Final check against overall budget
        if total_chars + len(entry) > max_chars:
            # Try a trimmed version
            remaining = max_chars - total_chars
            if remaining > header_len + 200:
                trim_budget = remaining - header_len - 1
                if summary and len(summary) <= trim_budget:
                    entry = f"{header}\n{summary}"
                else:
                    entry = f"{header}\n{content[:trim_budget]}..."
                context_parts.append(entry)
                total_chars += len(entry)
            break

        context_parts.append(entry)
        total_chars += len(entry)

    if not context_parts:
        return ""

    result = "## Relevant Memories:\n\n" + "\n\n---\n\n".join(context_parts)
    utilization_pct = round((len(result) / max_chars) * 100, 1) if max_chars > 0 else 0
    logger.info(
        f"Formatted {len(context_parts)} memories into {len(result)} chars "
        f"(budget: {max_chars}, utilization: {utilization_pct}%, summaries: {summaries_used}/{len(context_parts)})"
    )
    return result
