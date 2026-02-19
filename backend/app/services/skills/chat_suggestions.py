"""Chat-Integration: pattern-based skill suggestions for chat context."""

import json
import logging

from ...db.crud.skills import get_skills_with_chat_triggers

logger = logging.getLogger(__name__)


async def detect_skill_suggestions(
    message: str,
    sources: list[dict],
) -> list[dict]:
    """Detect relevant skill suggestions based on chat message patterns and context memories.

    Returns max 3 suggestions, each with:
    skill_id, skill_name, skill_icon, memory_id, memory_title, auto_parameters,
    match_reason, matched_pattern
    """
    if not sources:
        return []

    skills = await get_skills_with_chat_triggers()
    if not skills:
        return []

    suggestions = []
    message_lower = message.lower()

    for skill in skills:
        triggers = json.loads(skill["triggers"]) if isinstance(skill["triggers"], str) else skill["triggers"]
        chat_config = triggers.get("chat")
        if not chat_config:
            continue

        patterns = chat_config.get("patterns", [])
        matched_pattern = None

        for pattern in patterns:
            if pattern.lower() in message_lower:
                matched_pattern = pattern
                break

        if not matched_pattern:
            continue

        # Check input.accepts against source memories
        accepts = json.loads(skill["input_accepts"]) if skill["input_accepts"] else None

        for source in sources:
            source_type = source.get("type")
            if accepts and source_type and source_type not in accepts:
                continue

            suggestions.append({
                "skill_id": skill["id"],
                "skill_name": skill["name"],
                "skill_icon": skill["icon"],
                "memory_id": source["id"],
                "memory_title": source.get("title", "Untitled"),
                "auto_parameters": chat_config.get("auto_parameters", {}),
                "match_reason": "pattern_match",
                "matched_pattern": matched_pattern,
            })

    # Deduplicate: same skill + same memory = keep first
    seen = set()
    unique = []
    for s in suggestions:
        key = s["skill_id"]
        if key not in seen:
            seen.add(key)
            unique.append(s)

    return unique[:3]
