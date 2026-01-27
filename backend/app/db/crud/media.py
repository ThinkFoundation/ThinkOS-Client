import json
import logging
from sqlalchemy import select, update

from ..core import get_session_maker, run_sync
from ...models import Memory, Tag, MemoryTag

logger = logging.getLogger(__name__)


# Media memory functions (voice memos and audio uploads)

async def create_media_memory(
    title: str,
    audio_path: str,
    audio_format: str,
    memory_type: str = "voice_memo",
    media_source: str = "recording",
    audio_duration: float | None = None,
) -> dict:
    """Create a new media memory record (voice memo or audio upload).

    Args:
        title: Initial title (may be updated after transcription)
        audio_path: Relative path to encrypted audio file
        audio_format: Audio format (e.g., "mp3", "wav")
        memory_type: "voice_memo" for recordings, "audio" for uploads
        media_source: "recording" or "upload"
        audio_duration: Duration in seconds

    Returns:
        Dict with memory info
    """
    def _create():
        with get_session_maker()() as session:
            memory = Memory(
                type=memory_type,
                title=title,
                audio_path=audio_path,
                audio_format=audio_format,
                audio_duration=audio_duration,
                media_source=media_source,
                transcription_status="pending",
            )
            session.add(memory)
            session.commit()
            session.refresh(memory)
            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "audio_path": memory.audio_path,
                "audio_format": memory.audio_format,
                "audio_duration": memory.audio_duration,
                "media_source": memory.media_source,
                "transcription_status": memory.transcription_status,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_create)


async def update_memory_transcript(
    memory_id: int, transcript: str, segments: list[dict] | None = None
) -> bool:
    """Update the transcript and segments for a voice memory."""
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.transcript = transcript
            # Also store transcript as content for search/embedding
            memory.content = transcript
            # Store segments with timestamps as JSON
            if segments:
                memory.transcript_segments = json.dumps(segments)
                # Set audio_duration from last segment if not already set
                # (WebM recordings may not have duration extracted by mutagen)
                if not memory.audio_duration and len(segments) > 0:
                    memory.audio_duration = segments[-1]["end"]
                    logger.info(
                        f"Set audio duration from transcript segments for memory {memory_id}: {memory.audio_duration}s"
                    )
            session.commit()
            return True

    return await run_sync(_update)


async def update_transcription_status(memory_id: int, status: str) -> bool:
    """Update the transcription status for a voice memory.

    Args:
        memory_id: Memory ID
        status: One of "pending", "processing", "completed", "failed"
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return False
            memory.transcription_status = status
            session.commit()
            return True

    return await run_sync(_update)


async def reset_transcription_status_if_not_processing(memory_id: int) -> bool:
    """Atomically reset transcription status to 'pending' only if not currently processing.

    This prevents race conditions when multiple retry requests come in simultaneously.

    Args:
        memory_id: Memory ID

    Returns:
        True if status was reset (was not processing), False if already processing or not found
    """
    def _update():
        with get_session_maker()() as session:
            # Atomic update: only update if status is not 'processing'
            result = session.execute(
                update(Memory)
                .where(Memory.id == memory_id)
                .where(Memory.transcription_status != "processing")
                .values(transcription_status="pending")
            )
            session.commit()
            # rowcount tells us if any row was actually updated
            return result.rowcount > 0

    return await run_sync(_update)


async def get_media_memory(memory_id: int) -> dict | None:
    """Get a media memory (voice memo or audio) with audio details."""
    def _get():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type not in ("voice_memo", "audio"):
                return None

            # Get tags
            memory_tags = session.execute(
                select(MemoryTag, Tag)
                .join(Tag, MemoryTag.tag_id == Tag.id)
                .where(MemoryTag.memory_id == memory_id)
            ).all()
            tags = [
                {"id": tag.id, "name": tag.name, "source": mt.source}
                for mt, tag in memory_tags
            ]

            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "content": memory.content,
                "summary": memory.summary,
                "transcript": memory.transcript,
                "audio_path": memory.audio_path,
                "audio_format": memory.audio_format,
                "audio_duration": memory.audio_duration,
                "media_source": memory.media_source,
                "transcription_status": memory.transcription_status,
                "tags": tags,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_get)


async def delete_media_memory(memory_id: int) -> str | None:
    """Delete a media memory and return the audio path for cleanup.

    Returns:
        The audio_path if memory was deleted (for file cleanup), None if not found
    """
    def _delete():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory:
                return None
            audio_path = memory.audio_path
            session.delete(memory)
            session.commit()
            return audio_path

    return await run_sync(_delete)


# Video memory functions

async def create_video_memory(
    title: str,
    video_path: str,
    video_format: str,
    video_duration: float | None = None,
    video_width: int | None = None,
    video_height: int | None = None,
    media_source: str = "upload",
) -> dict:
    """Create a new video memory record.

    Args:
        title: Initial title (may be updated after transcription)
        video_path: Relative path to encrypted video file
        video_format: Video format (e.g., "mp4", "webm", "mov")
        video_duration: Duration in seconds
        video_width: Video width in pixels
        video_height: Video height in pixels
        media_source: Source of the video (usually "upload")

    Returns:
        Dict with memory info
    """
    def _create():
        with get_session_maker()() as session:
            memory = Memory(
                type="video",
                title=title,
                video_path=video_path,
                video_format=video_format,
                video_duration=video_duration,
                video_width=video_width,
                video_height=video_height,
                media_source=media_source,
                video_processing_status="pending_extraction",
            )
            session.add(memory)
            session.commit()
            session.refresh(memory)
            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "video_path": memory.video_path,
                "video_format": memory.video_format,
                "video_duration": memory.video_duration,
                "video_width": memory.video_width,
                "video_height": memory.video_height,
                "media_source": memory.media_source,
                "video_processing_status": memory.video_processing_status,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_create)


async def update_video_processing_status(memory_id: int, status: str) -> bool:
    """Update the video processing status.

    Args:
        memory_id: Memory ID
        status: One of "pending_extraction", "extracting", "ready", "failed"
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return False
            memory.video_processing_status = status
            session.commit()
            return True

    return await run_sync(_update)


async def update_video_audio(
    memory_id: int,
    audio_path: str,
    audio_format: str,
) -> bool:
    """Update the extracted audio info for a video memory.

    Called after frontend extracts audio and uploads it.

    Args:
        memory_id: Memory ID
        audio_path: Relative path to encrypted audio file
        audio_format: Audio format (e.g., "m4a", "mp3")
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return False
            memory.audio_path = audio_path
            memory.audio_format = audio_format
            memory.transcription_status = "pending"
            memory.video_processing_status = "ready"
            session.commit()
            return True

    return await run_sync(_update)


async def update_video_thumbnail(memory_id: int, thumbnail_path: str) -> bool:
    """Update the thumbnail path for a video memory.

    Args:
        memory_id: Memory ID
        thumbnail_path: Relative path to encrypted thumbnail file
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return False
            memory.thumbnail_path = thumbnail_path
            session.commit()
            return True

    return await run_sync(_update)


async def get_video_memory(memory_id: int) -> dict | None:
    """Get a video memory with all details."""
    def _get():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return None

            # Get tags
            memory_tags = session.execute(
                select(MemoryTag, Tag)
                .join(Tag, MemoryTag.tag_id == Tag.id)
                .where(MemoryTag.memory_id == memory_id)
            ).all()
            tags = [
                {"id": tag.id, "name": tag.name, "source": mt.source}
                for mt, tag in memory_tags
            ]

            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "content": memory.content,
                "summary": memory.summary,
                "video_path": memory.video_path,
                "video_format": memory.video_format,
                "video_duration": memory.video_duration,
                "video_width": memory.video_width,
                "video_height": memory.video_height,
                "thumbnail_path": memory.thumbnail_path,
                "video_processing_status": memory.video_processing_status,
                "audio_path": memory.audio_path,
                "audio_format": memory.audio_format,
                "transcript": memory.transcript,
                "transcription_status": memory.transcription_status,
                "media_source": memory.media_source,
                "transcript_segments": (
                    json.loads(memory.transcript_segments)
                    if memory.transcript_segments
                    else None
                ),
                "tags": tags,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_get)


async def delete_video_memory(memory_id: int) -> dict | None:
    """Delete a video memory and return paths for cleanup.

    Returns:
        Dict with video_path, audio_path, and thumbnail_path for file cleanup,
        or None if not found
    """
    def _delete():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "video":
                return None
            paths = {
                "video_path": memory.video_path,
                "audio_path": memory.audio_path,
                "thumbnail_path": memory.thumbnail_path,
            }
            session.delete(memory)
            session.commit()
            return paths

    return await run_sync(_delete)


# Document memory functions

async def create_document_memory(
    title: str,
    document_path: str,
    document_format: str,
    content: str | None = None,
    document_page_count: int | None = None,
    thumbnail_path: str | None = None,
) -> dict:
    """Create a new document memory record.

    Args:
        title: Document title (typically filename without extension)
        document_path: Relative path to encrypted document file
        document_format: Document format (e.g., "pdf")
        content: Extracted text content from document
        document_page_count: Number of pages in document
        thumbnail_path: Relative path to encrypted thumbnail file

    Returns:
        Dict with memory info
    """
    def _create():
        with get_session_maker()() as session:
            memory = Memory(
                type="document",
                title=title,
                document_path=document_path,
                document_format=document_format,
                content=content,
                document_page_count=document_page_count,
                thumbnail_path=thumbnail_path,
            )
            session.add(memory)
            session.commit()
            session.refresh(memory)
            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "document_path": memory.document_path,
                "document_format": memory.document_format,
                "document_page_count": memory.document_page_count,
                "thumbnail_path": memory.thumbnail_path,
                "content": memory.content,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_create)


async def get_document_memory(memory_id: int) -> dict | None:
    """Get a document memory with all details."""
    def _get():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "document":
                return None

            # Get tags
            memory_tags = session.execute(
                select(MemoryTag, Tag)
                .join(Tag, MemoryTag.tag_id == Tag.id)
                .where(MemoryTag.memory_id == memory_id)
            ).all()
            tags = [
                {"id": tag.id, "name": tag.name, "source": mt.source}
                for mt, tag in memory_tags
            ]

            return {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "content": memory.content,
                "summary": memory.summary,
                "document_path": memory.document_path,
                "document_format": memory.document_format,
                "document_page_count": memory.document_page_count,
                "thumbnail_path": memory.thumbnail_path,
                "tags": tags,
                "created_at": memory.created_at.isoformat(),
            }

    return await run_sync(_get)


async def update_document_thumbnail(memory_id: int, thumbnail_path: str) -> bool:
    """Update the thumbnail path for a document memory.

    Args:
        memory_id: Memory ID
        thumbnail_path: Relative path to encrypted thumbnail file
    """
    def _update():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "document":
                return False
            memory.thumbnail_path = thumbnail_path
            session.commit()
            return True

    return await run_sync(_update)


async def delete_document_memory(memory_id: int) -> dict | None:
    """Delete a document memory and return paths for cleanup.

    Returns:
        Dict with document_path and thumbnail_path for file cleanup,
        or None if not found
    """
    def _delete():
        with get_session_maker()() as session:
            memory = session.get(Memory, memory_id)
            if not memory or memory.type != "document":
                return None
            paths = {
                "document_path": memory.document_path,
                "thumbnail_path": memory.thumbnail_path,
            }
            session.delete(memory)
            session.commit()
            return paths

    return await run_sync(_delete)
