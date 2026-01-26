"""PDF document utility functions."""
import io
import logging

import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image

logger = logging.getLogger(__name__)

# Supported document formats (extensible for images later)
SUPPORTED_FORMATS = {"pdf"}


def validate_document_format(format: str) -> bool:
    """Check if the document format is supported."""
    return format.lower() in SUPPORTED_FORMATS


def extract_pdf_text(pdf_bytes: bytes) -> tuple[str, int]:
    """Extract text content from a PDF file.

    Args:
        pdf_bytes: Raw PDF file bytes

    Returns:
        Tuple of (extracted_text, page_count)
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        page_count = len(reader.pages)
        text_parts = []

        for page in reader.pages:
            text = page.extract_text()
            if text and text.strip():
                text_parts.append(text)

        full_text = "\n\n".join(text_parts)
        logger.info(f"Extracted {len(full_text)} chars from {page_count} pages")
        return full_text, page_count
    except Exception as e:
        logger.error(f"Failed to extract PDF text: {e}")
        raise


def generate_pdf_thumbnail(pdf_bytes: bytes, max_size: int = 300) -> bytes:
    """Generate a thumbnail image from the first page of a PDF.

    Uses pypdfium2 (PDFium) for rendering - no external dependencies required.

    Args:
        pdf_bytes: Raw PDF file bytes
        max_size: Maximum dimension (width or height) in pixels

    Returns:
        JPEG image bytes of the thumbnail
    """
    try:
        # Open PDF with pypdfium2
        pdf = pdfium.PdfDocument(pdf_bytes)

        if len(pdf) == 0:
            raise ValueError("PDF has no pages")

        # Render first page at scale 1 (72 DPI equivalent)
        page = pdf[0]
        bitmap = page.render(scale=1)
        thumbnail = bitmap.to_pil()

        # Resize to fit max_size while maintaining aspect ratio
        thumbnail.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

        # Convert to JPEG bytes
        output = io.BytesIO()
        thumbnail.save(output, format="JPEG", quality=85)
        img_bytes = output.getvalue()

        logger.info(f"Generated thumbnail: {thumbnail.width}x{thumbnail.height}")
        return img_bytes
    except Exception as e:
        logger.error(f"Failed to generate PDF thumbnail: {e}")
        raise
