"""Document memory API routes."""
import asyncio
import logging
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from ..db.crud import (
    create_document_memory,
    get_document_memory,
    get_memory,
    delete_document_memory,
    update_document_thumbnail,
)
from ..services.media.document_storage import (
    save_document_file,
    read_document_file,
    delete_document_file,
)
from ..services.media.video_storage import (
    save_thumbnail,
    read_thumbnail,
    delete_thumbnail,
)
from ..services.media.document_utils import (
    validate_document_format,
    extract_pdf_text,
    generate_pdf_thumbnail,
)
from ..services.ai.processing import process_document_memory_async
from ..events import event_manager, MemoryEvent, EventType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/document", tags=["document"])

# File size limits (in bytes)
MAX_DOCUMENT_SIZE = 50 * 1024 * 1024  # 50 MB

# Supported document formats
SUPPORTED_DOCUMENT_FORMATS = {"pdf"}
SUPPORTED_DOCUMENT_MIMES = {
    "application/pdf": "pdf",
}


def get_format_from_filename(filename: str) -> str | None:
    """Extract and validate document format from filename."""
    if "." not in filename:
        return None
    ext = filename.rsplit(".", 1)[1].lower()
    return ext if ext in SUPPORTED_DOCUMENT_FORMATS else None


def get_format_from_mime(mime_type: str) -> str | None:
    """Get document format from MIME type."""
    return SUPPORTED_DOCUMENT_MIMES.get(mime_type)


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
):
    """Upload a document file (PDF).

    Accepts multipart form data with:
    - file: The document file

    Supported formats: pdf
    Max size: 50 MB

    The document will be:
    1. Saved encrypted
    2. Text extracted
    3. Thumbnail generated from first page
    4. AI processed for summary/tags/embedding
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Validate format from filename or content type
    document_format = get_format_from_filename(file.filename)
    if not document_format and file.content_type:
        document_format = get_format_from_mime(file.content_type)

    if not document_format:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported document format. Supported: {', '.join(SUPPORTED_DOCUMENT_FORMATS)}"
        )

    if not validate_document_format(document_format):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported document format: {document_format}"
        )

    # Read file content
    document_data = await file.read()
    if not document_data:
        raise HTTPException(status_code=400, detail="Empty document file")

    # Check file size
    if len(document_data) > MAX_DOCUMENT_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_DOCUMENT_SIZE // (1024 * 1024)} MB"
        )

    # Extract text from PDF
    try:
        content, page_count = extract_pdf_text(document_data)
    except Exception as e:
        logger.error(f"Failed to extract PDF text: {e}")
        raise HTTPException(status_code=400, detail="Failed to extract text from PDF")

    # Reject PDFs with no extractable text (image-only PDFs, blank pages, etc.)
    if not content or not content.strip():
        raise HTTPException(
            status_code=400,
            detail="PDF contains no extractable text. Image-only or scanned PDFs are not supported."
        )

    # Generate thumbnail
    thumbnail_path = None
    try:
        thumbnail_data = generate_pdf_thumbnail(document_data)
        thumbnail_path = save_thumbnail(thumbnail_data, "jpg")
    except Exception as e:
        logger.warning(f"Failed to generate thumbnail: {e}")
        # Continue without thumbnail

    # Save encrypted document file
    document_path = save_document_file(document_data, document_format)

    # Create document memory record with original filename as title
    initial_title = file.filename.rsplit(".", 1)[0] if "." in file.filename else file.filename
    memory = await create_document_memory(
        title=initial_title,
        document_path=document_path,
        document_format=document_format,
        content=content,
        document_page_count=page_count,
        thumbnail_path=thumbnail_path,
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

    # Start AI processing in background
    asyncio.create_task(process_document_memory_async(memory_id))

    logger.info(f"Created document memory {memory_id} from {file.filename}")
    return memory


@router.get("/{memory_id}/file")
async def get_document_file(memory_id: int):
    """Get the document file for download/viewing.

    Returns the decrypted document with appropriate content type.
    """
    memory = await get_document_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Document memory not found")

    document_path = memory.get("document_path")
    if not document_path:
        raise HTTPException(status_code=404, detail="Document file not found")

    document_format = memory.get("document_format", "pdf")

    try:
        document_data = read_document_file(document_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Document file not found on disk")

    # Determine content type
    content_type_map = {
        "pdf": "application/pdf",
    }
    content_type = content_type_map.get(document_format, "application/octet-stream")

    # Stream the document data
    async def document_generator():
        # Yield in chunks for efficient streaming
        chunk_size = 256 * 1024  # 256KB chunks
        for i in range(0, len(document_data), chunk_size):
            yield document_data[i:i + chunk_size]

    return StreamingResponse(
        document_generator(),
        media_type=content_type,
        headers={
            "Content-Length": str(len(document_data)),
            "Content-Disposition": f'inline; filename="{quote(f"{memory.get("title", "document")}.{document_format}", safe="")}"',
        }
    )


@router.get("/{memory_id}/thumbnail")
async def get_document_thumbnail(memory_id: int):
    """Get the thumbnail image for a document."""
    memory = await get_document_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Document memory not found")

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
async def retry_processing(memory_id: int):
    """Retry AI processing for a document memory."""
    memory = await get_document_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Document memory not found")

    if not memory.get("content"):
        raise HTTPException(
            status_code=400,
            detail="Document has no extracted content to process"
        )

    # Start background processing
    asyncio.create_task(process_document_memory_async(memory_id))

    logger.info(f"Retrying AI processing for document memory {memory_id}")
    return {"success": True, "message": "AI processing retry started"}


@router.delete("/{memory_id}")
async def delete_document_memory_endpoint(memory_id: int):
    """Delete a document memory and all its files."""
    # Delete from database and get paths
    paths = await delete_document_memory(memory_id)

    if paths is None:
        raise HTTPException(status_code=404, detail="Document memory not found")

    # Delete all associated files
    if paths.get("document_path"):
        delete_document_file(paths["document_path"])
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

    logger.info(f"Deleted document memory {memory_id}")
    return {"deleted": True}
