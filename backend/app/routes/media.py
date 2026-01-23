"""Media memory API routes (voice memos and audio uploads)."""
import asyncio
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from ..db.crud import (
    create_media_memory,
    get_media_memory,
    get_memory,
    delete_media_memory,
    reset_transcription_status_if_not_processing,
)
from ..services.audio_storage import save_audio_file, read_audio_file, delete_audio_file
from ..services.audio_utils import (
    validate_audio_format,
    get_format_from_mime,
    get_audio_duration,
    SUPPORTED_FORMATS,
)
from ..services.ai_processing import process_voice_memory_async
from ..events import event_manager, MemoryEvent, EventType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media", tags=["media"])

# File size limits (in bytes)
MAX_AUDIO_SIZE = 100 * 1024 * 1024  # 100 MB


@router.post("/record")
async def record_voice_memo(file: UploadFile = File(...)):
    """Upload a voice memo from a quick recording.

    Accepts multipart form data with an audio file.
    Supported formats: mp3, wav, m4a, webm, ogg, flac
    Max size: 100 MB
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Validate format from filename or content type
    audio_format = validate_audio_format(file.filename)
    if not audio_format and file.content_type:
        audio_format = get_format_from_mime(file.content_type)

    if not audio_format:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format. Supported: {', '.join(SUPPORTED_FORMATS)}"
        )

    # Read file content
    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Empty audio file")

    # Check file size
    if len(audio_data) > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_AUDIO_SIZE // (1024 * 1024)} MB"
        )

    # Extract duration
    duration = get_audio_duration(audio_data, audio_format)

    # Save encrypted audio file
    audio_path = save_audio_file(audio_data, audio_format)

    # Create voice memo record
    initial_title = "Voice Memo"
    memory = await create_media_memory(
        title=initial_title,
        audio_path=audio_path,
        audio_format=audio_format,
        memory_type="voice_memo",
        media_source="recording",
        audio_duration=duration,
    )

    memory_id = memory["id"]

    # Emit creation event
    full_memory = await get_memory(memory_id)
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_CREATED,
            memory_id=memory_id,
            data=full_memory,
        )
    )

    # Start background processing (transcription + AI)
    asyncio.create_task(process_voice_memory_async(memory_id))

    logger.info(f"Created voice memo {memory_id}")
    return memory


@router.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload an audio file for transcription.

    Accepts multipart form data with an audio file.
    Supported formats: mp3, wav, m4a, webm, ogg, flac
    Max size: 100 MB
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Validate format from filename or content type
    audio_format = validate_audio_format(file.filename)
    if not audio_format and file.content_type:
        audio_format = get_format_from_mime(file.content_type)

    if not audio_format:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format. Supported: {', '.join(SUPPORTED_FORMATS)}"
        )

    # Read file content
    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Empty audio file")

    # Check file size
    if len(audio_data) > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_AUDIO_SIZE // (1024 * 1024)} MB"
        )

    # Extract duration
    duration = get_audio_duration(audio_data, audio_format)

    # Save encrypted audio file
    audio_path = save_audio_file(audio_data, audio_format)

    # Create audio memory record with original filename as title
    initial_title = file.filename.rsplit(".", 1)[0] if "." in file.filename else file.filename
    memory = await create_media_memory(
        title=initial_title,
        audio_path=audio_path,
        audio_format=audio_format,
        memory_type="audio",
        media_source="upload",
        audio_duration=duration,
    )

    memory_id = memory["id"]

    # Emit creation event
    full_memory = await get_memory(memory_id)
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_CREATED,
            memory_id=memory_id,
            data=full_memory,
        )
    )

    # Start background processing (transcription + AI)
    asyncio.create_task(process_voice_memory_async(memory_id))

    logger.info(f"Created audio memory {memory_id} from {file.filename}")
    return memory


@router.get("/{memory_id}/stream")
async def stream_audio(memory_id: int):
    """Stream the audio file for playback.

    Returns the decrypted audio with appropriate content type.
    """
    memory = await get_media_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Media memory not found")

    audio_path = memory.get("audio_path")
    if not audio_path:
        raise HTTPException(status_code=404, detail="Audio file not found")

    audio_format = memory.get("audio_format", "mp3")

    try:
        audio_data = read_audio_file(audio_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    # Determine content type
    content_type_map = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "m4a": "audio/mp4",
        "webm": "audio/webm",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
    }
    content_type = content_type_map.get(audio_format, "audio/mpeg")

    # Stream the audio data
    async def audio_generator():
        # Yield in chunks for efficient streaming
        chunk_size = 64 * 1024  # 64KB chunks
        for i in range(0, len(audio_data), chunk_size):
            yield audio_data[i:i + chunk_size]

    return StreamingResponse(
        audio_generator(),
        media_type=content_type,
        headers={
            "Content-Length": str(len(audio_data)),
            "Accept-Ranges": "bytes",
        }
    )


@router.post("/{memory_id}/retry")
async def retry_transcription(memory_id: int):
    """Retry transcription for a failed media memory."""
    memory = await get_media_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Media memory not found")

    # Atomically reset status to pending only if not already processing
    # This prevents race conditions when multiple retry requests come in
    status_reset = await reset_transcription_status_if_not_processing(memory_id)
    if not status_reset:
        raise HTTPException(
            status_code=400,
            detail="Transcription is already in progress"
        )

    # Fetch complete memory for SSE event
    updated_memory = await get_media_memory(memory_id)

    # Emit update event with full memory data
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_UPDATED,
            memory_id=memory_id,
            data=updated_memory,
        )
    )

    # Start background processing
    asyncio.create_task(process_voice_memory_async(memory_id))

    logger.info(f"Retrying transcription for media memory {memory_id}")
    return {"success": True, "message": "Transcription retry started"}


@router.delete("/{memory_id}")
async def delete_media_memory_endpoint(memory_id: int):
    """Delete a media memory and its audio file."""
    # Delete from database and get audio path
    audio_path = await delete_media_memory(memory_id)

    if audio_path is None:
        raise HTTPException(status_code=404, detail="Media memory not found")

    # Delete the audio file
    delete_audio_file(audio_path)

    # Emit deletion event
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_DELETED,
            memory_id=memory_id,
            data=None,
        )
    )

    logger.info(f"Deleted media memory {memory_id}")
    return {"deleted": True}
