"""Audio utilities for format validation and metadata extraction."""
import io
import logging
from pathlib import Path

from mutagen import File as MutagenFile
from mutagen.mp3 import MP3
from mutagen.wave import WAVE
from mutagen.mp4 import MP4
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis
from mutagen.flac import FLAC

logger = logging.getLogger(__name__)

# Supported audio formats
SUPPORTED_FORMATS = {"mp3", "wav", "m4a", "webm", "ogg", "flac"}

# MIME type to format mapping
MIME_TO_FORMAT = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
}


def validate_audio_format(filename: str) -> str | None:
    """Validate that a filename has a supported audio extension.

    Args:
        filename: The filename to validate

    Returns:
        The lowercase format extension if valid, None otherwise
    """
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext in SUPPORTED_FORMATS:
        return ext
    return None


def get_format_from_mime(mime_type: str) -> str | None:
    """Get audio format from MIME type.

    Args:
        mime_type: The MIME type (e.g., "audio/mpeg")

    Returns:
        The format string if recognized, None otherwise
    """
    return MIME_TO_FORMAT.get(mime_type.lower())


def get_audio_duration(audio_data: bytes, audio_format: str) -> float | None:
    """Extract duration in seconds from audio data.

    Args:
        audio_data: Raw audio file bytes
        audio_format: File format (e.g., "mp3", "wav")

    Returns:
        Duration in seconds, or None if extraction fails
    """
    try:
        # Create a file-like object from bytes
        audio_file = io.BytesIO(audio_data)

        # Use the appropriate mutagen class based on format
        if audio_format == "mp3":
            audio = MP3(audio_file)
        elif audio_format == "wav":
            audio = WAVE(audio_file)
        elif audio_format == "m4a":
            audio = MP4(audio_file)
        elif audio_format == "ogg":
            # Try Opus first, then Vorbis
            try:
                audio = OggOpus(audio_file)
            except Exception:
                audio_file.seek(0)
                audio = OggVorbis(audio_file)
        elif audio_format == "flac":
            audio = FLAC(audio_file)
        elif audio_format == "webm":
            # WebM is typically Opus in an EBML container
            # mutagen doesn't directly support WebM, so we try to handle it
            # by using the generic File approach
            audio_file.seek(0)
            audio = MutagenFile(audio_file)
            if audio is None:
                logger.warning(f"Could not parse WebM audio file")
                return None
        else:
            # Try generic mutagen detection
            audio = MutagenFile(audio_file)
            if audio is None:
                logger.warning(f"Unsupported audio format for duration: {audio_format}")
                return None

        duration = audio.info.length if audio and audio.info else None
        return float(duration) if duration else None

    except Exception as e:
        logger.warning(f"Failed to extract audio duration: {e}")
        return None


def format_duration(seconds: float | None) -> str:
    """Format duration in seconds to human-readable string (M:SS or H:MM:SS).

    Args:
        seconds: Duration in seconds

    Returns:
        Formatted string like "2:34" or "1:05:30"
    """
    if seconds is None:
        return "0:00"

    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60

    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"
