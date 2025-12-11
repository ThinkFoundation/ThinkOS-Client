"""Background AI processing for memories - generates summaries and tags."""
import asyncio
import json
import logging

from .ai import get_client, get_model
from ..db.crud import (
    get_memory,
    update_memory_summary,
    update_memory_title,
    add_tags_to_memory,
    get_all_tags,
    update_conversation_title,
)
from ..events import event_manager, MemoryEvent, EventType

logger = logging.getLogger(__name__)


async def generate_summary(content: str, title: str = "") -> str:
    """Generate a concise summary for memory content."""
    client = await get_client()
    model = get_model()

    prompt = f"""Summarize the following content in 1-2 sentences. Be concise and capture the main idea.

Title: {title}
Content: {content[:3000]}

Summary:"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that creates concise summaries."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=150,
        )
        return response.choices[0].message.content.strip() if response.choices[0].message.content else ""
    except Exception as e:
        logger.error(f"Failed to generate summary: {e}")
        return ""


async def generate_title(content: str, original_title: str = "") -> str:
    """Generate a concise title (5-10 words) from content."""
    client = await get_client()
    model = get_model()

    prompt = f"""Generate a concise, descriptive title for this webpage content.

Original page title: {original_title}
Content preview: {content[:2000]}

Requirements:
- 5-10 words maximum
- Capture the main topic/purpose
- Remove site names, separators like "|" or "-", and marketing fluff
- Be informative and scannable

Title:"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that creates concise, descriptive titles. Respond with only the title, no quotes or extra formatting."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=50,
        )
        title = response.choices[0].message.content.strip() if response.choices[0].message.content else ""
        # Remove quotes if the model wrapped the title
        if title.startswith('"') and title.endswith('"'):
            title = title[1:-1]
        return title
    except Exception as e:
        logger.error(f"Failed to generate title: {e}")
        return ""


async def generate_tags(content: str, title: str, existing_tags: list[str]) -> list[str]:
    """Generate relevant tags for memory content.

    Args:
        content: The memory content
        title: The memory title
        existing_tags: List of existing tag names in the system to prefer

    Returns:
        List of tag names (3-5 tags)
    """
    client = await get_client()
    model = get_model()

    existing_tags_str = ", ".join(existing_tags[:50]) if existing_tags else "none yet"

    prompt = f"""Analyze this content and suggest 3-5 relevant tags for categorization.

Existing tags in the system: [{existing_tags_str}]

IMPORTANT: Prefer using existing tags when they fit. Only create new tags if none of the existing tags are appropriate.

Title: {title}
Content: {content[:2000]}

Return ONLY a JSON array of tag strings, like: ["tag1", "tag2", "tag3"]
Tags should be lowercase, single words or short phrases (2-3 words max).

Tags:"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that categorizes content with relevant tags. Always respond with a valid JSON array."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=100,
        )

        result = response.choices[0].message.content.strip() if response.choices[0].message.content else "[]"

        # Parse JSON response
        # Handle potential markdown code blocks
        if result.startswith("```"):
            result = result.split("```")[1]
            if result.startswith("json"):
                result = result[4:]
            result = result.strip()

        tags = json.loads(result)
        if isinstance(tags, list):
            # Normalize and limit
            return [str(t).strip().lower() for t in tags[:5] if t]
        return []
    except json.JSONDecodeError:
        logger.error(f"Failed to parse tags response: {response.choices[0].message.content if response.choices else 'no response'}")
        return []
    except Exception as e:
        logger.error(f"Failed to generate tags: {e}")
        return []


async def process_memory_async(memory_id: int) -> None:
    """Background task to process a memory with AI.

    Generates summary, tags, and title (for web memories), then updates the memory.
    This function is designed to be run as a background task.
    """
    try:
        # Get the memory
        memory = await get_memory(memory_id)
        if not memory:
            logger.error(f"Memory {memory_id} not found for processing")
            return

        content = memory.get("content", "")
        title = memory.get("title", "")
        memory_type = memory.get("type", "")
        original_title = memory.get("original_title", "")

        if not content:
            logger.info(f"Memory {memory_id} has no content, skipping AI processing")
            return

        # Get existing tags for context
        all_tags = await get_all_tags()
        existing_tag_names = [t["name"] for t in all_tags]

        # Build list of tasks to run in parallel
        tasks = [
            generate_summary(content, title),
            generate_tags(content, title, existing_tag_names),
        ]

        # Generate title for memories that have original_title (web pages and chat summaries)
        should_generate_title = bool(original_title)
        if should_generate_title:
            tasks.append(generate_title(content, original_title))

        results = await asyncio.gather(*tasks)

        summary = results[0]
        tags = results[1]
        new_title = results[2] if should_generate_title else None

        updated = False

        # Update memory with AI-generated title
        if new_title:
            await update_memory_title(memory_id, new_title)
            logger.info(f"Updated memory {memory_id} title: '{original_title[:50]}...' -> '{new_title}'")
            updated = True

        # Update memory with summary
        if summary:
            await update_memory_summary(memory_id, summary)
            logger.info(f"Updated memory {memory_id} with summary")
            updated = True

        # Add AI-generated tags
        if tags:
            await add_tags_to_memory(memory_id, tags, source="ai")
            logger.info(f"Added {len(tags)} AI tags to memory {memory_id}: {tags}")
            updated = True

        # Emit update event so clients can refresh with AI-generated content
        if updated:
            updated_memory = await get_memory(memory_id)
            await event_manager.publish(
                MemoryEvent(
                    type=EventType.MEMORY_UPDATED,
                    memory_id=memory_id,
                    data=updated_memory,
                )
            )
            logger.info(f"Emitted update event for memory {memory_id}")

    except Exception as e:
        logger.error(f"Failed to process memory {memory_id}: {e}")


async def generate_conversation_title(message: str) -> str:
    """Generate a short title summarizing a conversation's first message."""
    client = await get_client()
    model = get_model()

    prompt = f"""Generate a concise title for this chat message.

Message: {message[:500]}

Requirements:
- 5-8 words maximum
- Capture the main topic or intent
- Be informative and scannable

Title:"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that creates concise chat titles. Respond with only the title, no quotes or extra formatting."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=50,
        )
        title = response.choices[0].message.content.strip() if response.choices[0].message.content else ""
        # Remove quotes if the model wrapped the title
        if title.startswith('"') and title.endswith('"'):
            title = title[1:-1]
        return title
    except Exception as e:
        logger.error(f"Failed to generate conversation title: {e}")
        return ""


async def process_conversation_title_async(conversation_id: int, message: str) -> None:
    """Background task to generate and update conversation title.

    Generates an AI summary title for a conversation based on the first message.
    This function is designed to be run as a background task.
    """
    try:
        title = await generate_conversation_title(message)

        if title:
            await update_conversation_title(conversation_id, title)
            logger.info(f"Updated conversation {conversation_id} title: '{title}'")

            # Emit update event so clients can refresh with AI-generated title
            await event_manager.publish(
                MemoryEvent(
                    type=EventType.CONVERSATION_UPDATED,
                    memory_id=conversation_id,
                    data={"title": title},
                )
            )

    except Exception as e:
        logger.error(f"Failed to process conversation title {conversation_id}: {e}")
