"""Video memory API routes."""
import asyncio
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from ..db.crud import (
    create_video_memory,
    get_video_memory,
    get_memory,
    delete_video_memory,
    update_video_audio,
    update_video_thumbnail,
    update_video_processing_status,
    reset_transcription_status_if_not_processing,
)
from ..services.media.video_storage import (
    save_video_file,
    read_video_file,
    delete_video_file,
    save_thumbnail,
    read_thumbnail,
    delete_thumbnail,
)
from ..services.media.audio_storage import (
    save_audio_file,
    read_audio_file,
    delete_audio_file,
)
from ..services.ai.processing import process_voice_memory_async
from ..events import event_manager, MemoryEvent, EventType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video", tags=["video"])

# File size limits (in bytes)
MAX_VIDEO_SIZE = 500 * 1024 * 1024  # 500 MB
MAX_AUDIO_SIZE = 100 * 1024 * 1024  # 100 MB for extracted audio
MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024  # 10 MB for thumbnails

# Supported video formats
SUPPORTED_VIDEO_FORMATS = {"mp4", "webm", "mov", "mkv", "avi"}
SUPPORTED_VIDEO_MIMES = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
    "video/x-msvideo": "avi",
}


def validate_video_format(filename: str) -> str | None:
    """Extract and validate video format from filename."""
    if "." not in filename:
        return None
    ext = filename.rsplit(".", 1)[1].lower()
    return ext if ext in SUPPORTED_VIDEO_FORMATS else None


def get_format_from_mime(mime_type: str) -> str | None:
    """Get video format from MIME type."""
    return SUPPORTED_VIDEO_MIMES.get(mime_type)


@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    duration: float = Form(None),
    width: int = Form(None),
    height: int = Form(None),
):
    """Upload a video file.

    Accepts multipart form data with:
    - file: The video file
    - duration: Video duration in seconds (from frontend metadata)
    - width: Video width in pixels
    - height: Video height in pixels

    Supported formats: mp4, webm, mov, mkv, avi
    Max size: 500 MB
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Validate format from filename or content type
    video_format = validate_video_format(file.filename)
    if not video_format and file.content_type:
        video_format = get_format_from_mime(file.content_type)

    if not video_format:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format. Supported: {', '.join(SUPPORTED_VIDEO_FORMATS)}"
        )

    # Validate dimensions (if provided)
    if duration is not None and (duration < 0 or duration > 86400):  # Max 24 hours
        raise HTTPException(status_code=400, detail="Invalid video duration")
    if width is not None and (width < 1 or width > 7680):  # Max 8K
        raise HTTPException(status_code=400, detail="Invalid video width")
    if height is not None and (height < 1 or height > 4320):  # Max 8K
        raise HTTPException(status_code=400, detail="Invalid video height")

    # Read file content
    video_data = await file.read()
    if not video_data:
        raise HTTPException(status_code=400, detail="Empty video file")

    # Check file size
    if len(video_data) > MAX_VIDEO_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_VIDEO_SIZE // (1024 * 1024)} MB"
        )

    # Save encrypted video file
    video_path = save_video_file(video_data, video_format)

    # Create video memory record with original filename as title
    initial_title = file.filename.rsplit(".", 1)[0] if "." in file.filename else file.filename
    memory = await create_video_memory(
        title=initial_title,
        video_path=video_path,
        video_format=video_format,
        video_duration=duration,
        video_width=width,
        video_height=height,
        media_source="upload",
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

    logger.info(f"Created video memory {memory_id} from {file.filename}")
    return memory


@router.post("/{memory_id}/audio")
async def upload_extracted_audio(
    memory_id: int,
    file: UploadFile = File(...),
):
    """Upload extracted audio from a video.

    Called by the frontend after extracting audio with ffmpeg.wasm.
    This starts the transcription pipeline.
    """
    memory = await get_video_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Video memory not found")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Get audio format from filename
    audio_format = "m4a"  # Default
    if "." in file.filename:
        ext = file.filename.rsplit(".", 1)[1].lower()
        if ext in {"m4a", "mp3", "wav", "webm", "ogg", "aac"}:
            audio_format = ext

    # Read and save audio file
    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Empty audio file")

    # Check file size
    if len(audio_data) > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file too large. Maximum size is {MAX_AUDIO_SIZE // (1024 * 1024)} MB"
        )

    audio_path = save_audio_file(audio_data, audio_format)

    # Update video memory with audio info
    await update_video_audio(memory_id, audio_path, audio_format)

    # Fetch complete memory for SSE event
    updated_memory = await get_video_memory(memory_id)

    # Emit update event with full memory data
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_UPDATED,
            memory_id=memory_id,
            data=updated_memory,
        )
    )

    # Start transcription pipeline
    asyncio.create_task(process_voice_memory_async(memory_id))

    logger.info(f"Added extracted audio to video memory {memory_id}")
    return {"success": True, "audio_path": audio_path}


@router.post("/{memory_id}/thumbnail")
async def upload_thumbnail(
    memory_id: int,
    file: UploadFile = File(...),
):
    """Upload a thumbnail for a video.

    Called by the frontend after generating thumbnail with ffmpeg.wasm.
    """
    memory = await get_video_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Video memory not found")

    # Read thumbnail data
    thumbnail_data = await file.read()
    if not thumbnail_data:
        raise HTTPException(status_code=400, detail="Empty thumbnail file")

    # Check file size
    if len(thumbnail_data) > MAX_THUMBNAIL_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Thumbnail too large. Maximum size is {MAX_THUMBNAIL_SIZE // (1024 * 1024)} MB"
        )

    # Get image format (default to jpg)
    image_format = "jpg"
    if file.filename and "." in file.filename:
        ext = file.filename.rsplit(".", 1)[1].lower()
        if ext in {"jpg", "jpeg", "png", "webp"}:
            image_format = ext

    # Save encrypted thumbnail
    thumbnail_path = save_thumbnail(thumbnail_data, image_format)

    # Update video memory
    await update_video_thumbnail(memory_id, thumbnail_path)

    # Fetch complete memory for SSE event
    updated_memory = await get_video_memory(memory_id)

    # Emit update event with full memory data
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_UPDATED,
            memory_id=memory_id,
            data=updated_memory,
        )
    )

    logger.info(f"Added thumbnail to video memory {memory_id}")
    return {"success": True, "thumbnail_path": thumbnail_path}


@router.get("/{memory_id}/stream")
async def stream_video(memory_id: int):
    """Stream the video file for playback.

    Returns the decrypted video with appropriate content type.
    """
    memory = await get_video_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Video memory not found")

    video_path = memory.get("video_path")
    if not video_path:
        raise HTTPException(status_code=404, detail="Video file not found")

    video_format = memory.get("video_format", "mp4")

    try:
        video_data = read_video_file(video_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Video file not found on disk")

    # Determine content type
    content_type_map = {
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
        "mkv": "video/x-matroska",
        "avi": "video/x-msvideo",
    }
    content_type = content_type_map.get(video_format, "video/mp4")

    # Stream the video data
    async def video_generator():
        # Yield in chunks for efficient streaming
        chunk_size = 256 * 1024  # 256KB chunks for video
        for i in range(0, len(video_data), chunk_size):
            yield video_data[i:i + chunk_size]

    return StreamingResponse(
        video_generator(),
        media_type=content_type,
        headers={
            "Content-Length": str(len(video_data)),
            "Accept-Ranges": "bytes",
        }
    )


@router.get("/{memory_id}/thumbnail")
async def get_thumbnail(memory_id: int):
    """Get the thumbnail image for a video."""
    memory = await get_video_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Video memory not found")

    thumbnail_path = memory.get("thumbnail_path")
    if not thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    try:
        thumbnail_data = read_thumbnail(thumbnail_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Thumbnail file not found on disk")

    # Determine content type from path
    content_type = "image/jpeg"
    if thumbnail_path.endswith(".png.enc"):
        content_type = "image/png"
    elif thumbnail_path.endswith(".webp.enc"):
        content_type = "image/webp"

    return StreamingResponse(
        iter([thumbnail_data]),
        media_type=content_type,
        headers={"Content-Length": str(len(thumbnail_data))},
    )


@router.post("/{memory_id}/retry")
async def retry_transcription(memory_id: int):
    """Retry transcription for a failed video memory."""
    memory = await get_video_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Video memory not found")

    if not memory.get("audio_path"):
        raise HTTPException(
            status_code=400,
            detail="Audio not yet extracted. Please retry audio extraction first."
        )

    # Atomically reset status to pending only if not already processing
    status_reset = await reset_transcription_status_if_not_processing(memory_id)
    if not status_reset:
        raise HTTPException(
            status_code=400,
            detail="Transcription is already in progress"
        )

    # Fetch complete memory for SSE event
    updated_memory = await get_video_memory(memory_id)

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

    logger.info(f"Retrying transcription for video memory {memory_id}")
    return {"success": True, "message": "Transcription retry started"}


@router.delete("/{memory_id}")
async def delete_video_memory_endpoint(memory_id: int):
    """Delete a video memory and all its files."""
    # Delete from database and get paths
    paths = await delete_video_memory(memory_id)

    if paths is None:
        raise HTTPException(status_code=404, detail="Video memory not found")

    # Delete all associated files
    if paths.get("video_path"):
        delete_video_file(paths["video_path"])
    if paths.get("audio_path"):
        delete_audio_file(paths["audio_path"])
    if paths.get("thumbnail_path"):
        delete_thumbnail(paths["thumbnail_path"])

    # Emit deletion event
    await event_manager.publish(
        MemoryEvent(
            type=EventType.MEMORY_DELETED,
            memory_id=memory_id,
            data=None,
        )
    )

    logger.info(f"Deleted video memory {memory_id}")
    return {"deleted": True}
