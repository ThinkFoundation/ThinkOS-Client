"""Background AI processing for memories - generates summaries and tags."""
import asyncio
import json
import logging

from .client import get_client, get_model
from ..embeddings import get_embedding, get_current_embedding_model
from ..media.transcription import transcribe_audio
from ...db.crud import (
    get_memory,
    update_memory_summary,
    update_memory_embedding_summary,
    update_memory_title,
    update_memory_embedding,
    update_memory_transcript,
    update_transcription_status,
    add_tags_to_memory,
    get_all_tags,
    update_conversation_title,
)
from ...events import event_manager, MemoryEvent, EventType

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
        response_text = response.choices[0].message.content if response and response.choices else 'no response'
        logger.error(f"Failed to parse tags response: {response_text}")
        return []
    except Exception as e:
        logger.error(f"Failed to generate tags: {e}")
        return []


async def generate_embedding_summary(content: str, title: str = "") -> str:
    """Generate a structured summary optimized for semantic search.

    This creates a structured format that helps match user queries like
    "What did I save about X?" in a personal knowledge hub.
    """
    client = await get_client()
    model = get_model()

    prompt = f"""Analyze this content and create a structured summary for semantic search.

Title: {title}
Content: {content[:3000]}

Create a structured summary in this exact format:
Topic: [main subject in 3-5 words]
Concepts: [key concepts, technologies, or ideas - comma separated]
Keywords: [searchable terms - comma separated]

Q: What is this about?
A: [1 sentence description]

Q: Why might this be saved?
A: [likely reasons for saving - learning, reference, project, etc.]

Output only the structured summary, nothing else."""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You create structured summaries for semantic search. Follow the exact format requested."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=300,
        )
        return response.choices[0].message.content.strip() if response.choices[0].message.content else ""
    except Exception as e:
        logger.error(f"Failed to generate embedding summary: {e}")
        return ""


async def process_memory_async(memory_id: int) -> None:
    """Background task to process a memory with AI.

    Generates summary, embedding_summary, tags, and title (for web memories),
    then re-embeds the memory using the structured embedding_summary.
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
            generate_embedding_summary(content, title),
            generate_tags(content, title, existing_tag_names),
        ]

        # Generate title for memories that have original_title (web pages and chat summaries)
        should_generate_title = bool(original_title)
        if should_generate_title:
            tasks.append(generate_title(content, original_title))

        results = await asyncio.gather(*tasks)

        summary = results[0]
        embedding_summary = results[1]
        tags = results[2]
        new_title = results[3] if should_generate_title else None

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

        # Update memory with embedding summary
        if embedding_summary:
            await update_memory_embedding_summary(memory_id, embedding_summary)
            logger.info(f"Updated memory {memory_id} with embedding summary")
            updated = True

            # Re-embed using the structured embedding summary
            try:
                # Skip embedding if summary is empty/whitespace
                if embedding_summary.strip():
                    embedding = await get_embedding(embedding_summary)
                    embedding_model = get_current_embedding_model()
                    await update_memory_embedding(memory_id, embedding, embedding_model)
                    logger.info(f"Re-embedded memory {memory_id} with embedding summary")
                else:
                    logger.warning(f"Embedding summary for memory {memory_id} is empty, skipping re-embed")
            except Exception as e:
                logger.error(f"Failed to re-embed memory {memory_id}: {e}")

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


async def generate_voice_title(transcript: str) -> str:
    """Generate a concise title from a voice transcript."""
    client = await get_client()
    model = get_model()

    prompt = f"""Generate a concise, descriptive title for this voice note transcript.

Transcript: {transcript[:1000]}

Requirements:
- 5-10 words maximum
- Capture the main topic or key point
- Be informative and scannable

Title:"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that creates concise, descriptive titles for voice notes. Respond with only the title, no quotes or extra formatting."},
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
        logger.error(f"Failed to generate voice title: {e}")
        return ""


async def process_voice_memory_async(memory_id: int) -> None:
    """Background task to process a media memory (voice memo or audio upload).

    Pipeline:
    1. Set status to "processing"
    2. Transcribe audio via faster-whisper
    3. Store transcript
    4. Generate title from transcript
    5. Generate summary, embedding_summary, tags
    6. Create embedding from embedding_summary
    7. Set status to "completed"
    8. Emit MEMORY_UPDATED event
    """
    try:
        # Get the memory
        memory = await get_memory(memory_id)
        if not memory:
            logger.error(f"Media memory {memory_id} not found for processing")
            return

        memory_type = memory.get("type")
        if memory_type not in ("voice_memo", "audio", "voice", "video"):
            logger.error(f"Memory {memory_id} is not a media memory (type={memory_type})")
            return

        audio_path = memory.get("audio_path")
        if not audio_path:
            logger.error(f"Voice memory {memory_id} has no audio_path")
            await update_transcription_status(memory_id, "failed")
            await event_manager.publish(
                MemoryEvent(
                    type=EventType.MEMORY_UPDATED,
                    memory_id=memory_id,
                    data={"transcription_status": "failed"},
                )
            )
            return

        # 1. Set status to processing
        await update_transcription_status(memory_id, "processing")

        # Emit update event for processing status
        await event_manager.publish(
            MemoryEvent(
                type=EventType.MEMORY_UPDATED,
                memory_id=memory_id,
                data={"transcription_status": "processing"},
            )
        )

        # 2. Transcribe the audio
        logger.info(f"Starting transcription for voice memory {memory_id}")
        transcript, segments = await transcribe_audio(audio_path)

        if not transcript or not transcript.strip():
            logger.warning(f"Transcription produced no text for memory {memory_id}")
            await update_transcription_status(memory_id, "failed")
            await event_manager.publish(
                MemoryEvent(
                    type=EventType.MEMORY_UPDATED,
                    memory_id=memory_id,
                    data={"transcription_status": "failed"},
                )
            )
            return

        # 3. Store transcript and segments
        await update_memory_transcript(memory_id, transcript, segments)
        logger.info(
            f"Stored transcript for voice memory {memory_id}: "
            f"{len(transcript)} chars, {len(segments)} segments"
        )

        # Get existing tags for context
        all_tags = await get_all_tags()
        existing_tag_names = [t["name"] for t in all_tags]

        # 4-5. Generate title, summary, embedding_summary, and tags in parallel
        tasks = [
            generate_voice_title(transcript),
            generate_summary(transcript, ""),
            generate_embedding_summary(transcript, ""),
            generate_tags(transcript, "", existing_tag_names),
        ]
        results = await asyncio.gather(*tasks)

        title = results[0]
        summary = results[1]
        embedding_summary = results[2]
        tags = results[3]

        updated = False

        # Update title
        if title:
            await update_memory_title(memory_id, title)
            logger.info(f"Updated voice memory {memory_id} title: '{title}'")
            updated = True

        # Update summary
        if summary:
            await update_memory_summary(memory_id, summary)
            logger.info(f"Updated voice memory {memory_id} with summary")
            updated = True

        # Update embedding summary and create embedding
        if embedding_summary:
            await update_memory_embedding_summary(memory_id, embedding_summary)
            logger.info(f"Updated voice memory {memory_id} with embedding summary")
            updated = True

            # 6. Create embedding from embedding_summary
            try:
                if embedding_summary.strip():
                    embedding = await get_embedding(embedding_summary)
                    embedding_model = get_current_embedding_model()
                    await update_memory_embedding(memory_id, embedding, embedding_model)
                    logger.info(f"Created embedding for voice memory {memory_id}")
            except Exception as e:
                logger.error(f"Failed to create embedding for voice memory {memory_id}: {e}")

        # Add AI-generated tags
        if tags:
            await add_tags_to_memory(memory_id, tags, source="ai")
            logger.info(f"Added {len(tags)} AI tags to voice memory {memory_id}: {tags}")
            updated = True

        # 7. Set status to completed
        await update_transcription_status(memory_id, "completed")

        # 8. Emit update event (always emit, even if AI generation failed)
        updated_memory = await get_memory(memory_id)
        await event_manager.publish(
            MemoryEvent(
                type=EventType.MEMORY_UPDATED,
                memory_id=memory_id,
                data=updated_memory,
            )
        )
        logger.info(f"Emitted update event for voice memory {memory_id}")

    except Exception as e:
        logger.error(f"Failed to process voice memory {memory_id}: {e}")
        # Set status to failed and notify frontend
        try:
            await update_transcription_status(memory_id, "failed")
            await event_manager.publish(
                MemoryEvent(
                    type=EventType.MEMORY_UPDATED,
                    memory_id=memory_id,
                    data={"transcription_status": "failed"},
                )
            )
        except Exception:
            pass


async def generate_document_title(content: str, filename: str = "") -> str:
    """Generate a concise title from document content."""
    client = await get_client()
    model = get_model()

    prompt = f"""Generate a concise, descriptive title for this document.

Original filename: {filename}
Content preview: {content[:2000]}

Requirements:
- 5-10 words maximum
- Capture the main topic or purpose
- Be informative and scannable

Title:"""

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that creates concise, descriptive titles for documents. Respond with only the title, no quotes or extra formatting."},
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
        logger.error(f"Failed to generate document title: {e}")
        return ""


async def process_document_memory_async(memory_id: int) -> None:
    """Background task to process a document memory.

    Pipeline:
    1. Generate title from content
    2. Generate summary, embedding_summary, tags
    3. Create embedding from embedding_summary
    4. Emit MEMORY_UPDATED event

    Note: Text extraction happens during upload, so content is already available.
    """
    try:
        # Get the memory
        memory = await get_memory(memory_id)
        if not memory:
            logger.error(f"Document memory {memory_id} not found for processing")
            return

        memory_type = memory.get("type")
        if memory_type != "document":
            logger.error(f"Memory {memory_id} is not a document memory (type={memory_type})")
            return

        content = memory.get("content")
        if not content:
            logger.warning(f"Document memory {memory_id} has no content, skipping AI processing")
            return

        original_title = memory.get("title", "")

        # Get existing tags for context
        all_tags = await get_all_tags()
        existing_tag_names = [t["name"] for t in all_tags]

        # Generate title, summary, embedding_summary, and tags in parallel
        tasks = [
            generate_document_title(content, original_title),
            generate_summary(content, original_title),
            generate_embedding_summary(content, original_title),
            generate_tags(content, original_title, existing_tag_names),
        ]
        results = await asyncio.gather(*tasks)

        title = results[0]
        summary = results[1]
        embedding_summary = results[2]
        tags = results[3]

        updated = False

        # Update title
        if title:
            await update_memory_title(memory_id, title)
            logger.info(f"Updated document memory {memory_id} title: '{title}'")
            updated = True

        # Update summary
        if summary:
            await update_memory_summary(memory_id, summary)
            logger.info(f"Updated document memory {memory_id} with summary")
            updated = True

        # Update embedding summary and create embedding
        if embedding_summary:
            await update_memory_embedding_summary(memory_id, embedding_summary)
            logger.info(f"Updated document memory {memory_id} with embedding summary")
            updated = True

            # Create embedding from embedding_summary
            try:
                if embedding_summary.strip():
                    embedding = await get_embedding(embedding_summary)
                    embedding_model = get_current_embedding_model()
                    await update_memory_embedding(memory_id, embedding, embedding_model)
                    logger.info(f"Created embedding for document memory {memory_id}")
            except Exception as e:
                logger.error(f"Failed to create embedding for document memory {memory_id}: {e}")

        # Add AI-generated tags
        if tags:
            await add_tags_to_memory(memory_id, tags, source="ai")
            logger.info(f"Added {len(tags)} AI tags to document memory {memory_id}: {tags}")
            updated = True

        # Emit update event (always emit, even if some AI generation failed)
        updated_memory = await get_memory(memory_id)
        await event_manager.publish(
            MemoryEvent(
                type=EventType.MEMORY_UPDATED,
                memory_id=memory_id,
                data=updated_memory,
            )
        )
        logger.info(f"Emitted update event for document memory {memory_id}")

    except Exception as e:
        logger.error(f"Failed to process document memory {memory_id}: {e}")
