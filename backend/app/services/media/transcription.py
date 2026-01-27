"""Transcription service using faster-whisper for local speech-to-text."""
import asyncio
import logging
import tempfile
import os
from pathlib import Path

from faster_whisper import WhisperModel

from .audio_storage import read_audio_file
from ...db.crud import get_setting

logger = logging.getLogger(__name__)

# Supported Whisper models (smallest to largest)
WHISPER_MODELS = ["tiny", "base", "small", "medium"]
DEFAULT_WHISPER_MODEL = "base"

# Cached model instance
_whisper_model: WhisperModel | None = None
_loaded_model_name: str | None = None


async def get_whisper_model_setting() -> str:
    """Get the configured Whisper model from settings."""
    model = await get_setting("whisper_model")
    if model and model in WHISPER_MODELS:
        return model
    return DEFAULT_WHISPER_MODEL


def _get_whisper_model(model_name: str) -> WhisperModel:
    """Get or create the Whisper model instance.

    Models are cached to avoid reloading on every transcription.
    """
    global _whisper_model, _loaded_model_name

    if _whisper_model is not None and _loaded_model_name == model_name:
        return _whisper_model

    logger.info(f"Loading Whisper model: {model_name}")

    # Use CPU by default for broader compatibility
    # faster-whisper will use CTranslate2 which is efficient on CPU
    _whisper_model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",  # Use int8 quantization for faster CPU inference
    )
    _loaded_model_name = model_name

    logger.info(f"Whisper model '{model_name}' loaded successfully")
    return _whisper_model


def unload_whisper_model() -> None:
    """Unload the Whisper model to free memory."""
    global _whisper_model, _loaded_model_name
    _whisper_model = None
    _loaded_model_name = None
    logger.info("Whisper model unloaded")


def _transcribe_audio_sync(audio_path: str, model_name: str) -> tuple[str, list[dict]]:
    """Synchronous transcription - runs in thread pool.

    This function contains all blocking operations and should be called
    via asyncio.to_thread() to avoid blocking the event loop.
    """
    # Read and decrypt the audio file
    audio_data = read_audio_file(audio_path)

    # Extract format from filename (e.g., "abc123.mp3.enc" -> "mp3")
    parts = audio_path.split(".")
    if len(parts) >= 3:
        audio_format = parts[-2]  # Get format before .enc
    else:
        audio_format = "wav"  # Default fallback

    # Write to a temp file (Whisper needs a file path)
    temp_suffix = f".{audio_format}"
    with tempfile.NamedTemporaryFile(suffix=temp_suffix, delete=False) as temp_file:
        temp_path = temp_file.name
        temp_file.write(audio_data)

    try:
        # Load model and transcribe
        model = _get_whisper_model(model_name)

        # Transcribe with automatic language detection
        segments, info = model.transcribe(
            temp_path,
            beam_size=5,
            language=None,  # Auto-detect language
            vad_filter=True,  # Filter out non-speech
        )

        # Collect segments with timestamps
        transcript_parts = []
        segment_list = []
        for segment in segments:
            text = segment.text.strip()
            transcript_parts.append(text)
            segment_list.append({
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": text,
            })

        transcript = " ".join(transcript_parts)

        logger.info(
            f"Transcription complete: {len(transcript)} chars, "
            f"{len(segment_list)} segments, "
            f"language={info.language}, probability={info.language_probability:.2f}"
        )

        return transcript, segment_list

    finally:
        # Clean up temp file
        try:
            os.unlink(temp_path)
        except Exception as e:
            logger.warning(f"Failed to delete temp file: {e}")


async def transcribe_audio(audio_path: str) -> tuple[str, list[dict]]:
    """Transcribe an encrypted audio file.

    Args:
        audio_path: Relative path to the encrypted audio file

    Returns:
        Tuple of (full transcript text, list of segment dicts with start/end/text)

    Raises:
        Exception: If transcription fails
    """
    # Get configured model (async DB call)
    model_name = await get_whisper_model_setting()

    # Run blocking transcription in thread pool
    return await asyncio.to_thread(_transcribe_audio_sync, audio_path, model_name)


def _transcribe_audio_bytes_sync(audio_data: bytes, audio_format: str, model_name: str) -> tuple[str, list[dict]]:
    """Synchronous transcription from bytes - runs in thread pool.

    This function contains all blocking operations and should be called
    via asyncio.to_thread() to avoid blocking the event loop.
    """
    # Write to temp file
    temp_suffix = f".{audio_format}"
    with tempfile.NamedTemporaryFile(suffix=temp_suffix, delete=False) as temp_file:
        temp_path = temp_file.name
        temp_file.write(audio_data)

    try:
        model = _get_whisper_model(model_name)

        segments, info = model.transcribe(
            temp_path,
            beam_size=5,
            language=None,
            vad_filter=True,
        )

        transcript_parts = []
        segment_list = []
        for segment in segments:
            text = segment.text.strip()
            transcript_parts.append(text)
            segment_list.append({
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": text,
            })

        return " ".join(transcript_parts), segment_list

    finally:
        try:
            os.unlink(temp_path)
        except Exception as e:
            logger.warning(f"Failed to delete temp file: {e}")


async def transcribe_audio_bytes(audio_data: bytes, audio_format: str) -> tuple[str, list[dict]]:
    """Transcribe audio data directly from bytes.

    Args:
        audio_data: Raw audio bytes
        audio_format: Audio format (e.g., "mp3", "wav")

    Returns:
        Tuple of (full transcript text, list of segment dicts with start/end/text)
    """
    # Get configured model (async DB call)
    model_name = await get_whisper_model_setting()

    # Run blocking transcription in thread pool
    return await asyncio.to_thread(_transcribe_audio_bytes_sync, audio_data, audio_format, model_name)
