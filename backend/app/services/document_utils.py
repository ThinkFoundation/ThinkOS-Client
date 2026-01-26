"""PDF document utility functions."""
import io
import logging
import os
import sys

from pypdf import PdfReader
from pdf2image import convert_from_bytes
from PIL import Image

logger = logging.getLogger(__name__)

# Supported document formats (extensible for images later)
SUPPORTED_FORMATS = {"pdf"}


def validate_document_format(format: str) -> bool:
    """Check if the document format is supported."""
    return format.lower() in SUPPORTED_FORMATS


def get_poppler_path() -> str | None:
    """Get the path to bundled Poppler binaries.

    Returns:
        Path to Poppler bin directory when running from PyInstaller bundle,
        or None to use system Poppler during development.
    """
    # When running from PyInstaller bundle
    if getattr(sys, "frozen", False):
        poppler_path = os.path.join(sys._MEIPASS, "poppler")
        if os.path.exists(poppler_path):
            return poppler_path
    return None  # Use system poppler during development


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

    Args:
        pdf_bytes: Raw PDF file bytes
        max_size: Maximum dimension (width or height) in pixels

    Returns:
        JPEG image bytes of the thumbnail
    """
    try:
        # Convert first page to image using pdf2image (requires Poppler)
        images = convert_from_bytes(
            pdf_bytes,
            first_page=1,
            last_page=1,
            dpi=72,  # Low DPI for thumbnails
            poppler_path=get_poppler_path(),
        )

        if not images:
            raise ValueError("PDF has no pages")

        thumbnail = images[0]

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
