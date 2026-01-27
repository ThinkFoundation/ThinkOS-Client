"""Encrypted audio file storage service for voice memories."""
import hashlib
import logging
import uuid
from pathlib import Path
import platform
import os

from cryptography.fernet import Fernet, InvalidToken
import base64

from ..secrets import get_or_create_salt

logger = logging.getLogger(__name__)


def _validate_path_within_directory(file_path: Path, base_dir: Path) -> None:
    """Validate that file_path resolves within base_dir to prevent path traversal attacks."""
    try:
        resolved_path = file_path.resolve()
        resolved_base = base_dir.resolve()
        if not resolved_path.is_relative_to(resolved_base):
            raise ValueError(f"Path traversal attempt detected: {file_path}")
    except (ValueError, RuntimeError) as e:
        raise ValueError(f"Invalid file path: {file_path}") from e

# In-memory cache for the derived encryption key
_encryption_key: bytes | None = None


def _get_audio_dir() -> Path:
    """Get the audio storage directory based on platform."""
    system = platform.system()
    if system == "Darwin":
        data_dir = Path.home() / "Library" / "Application Support" / "Think" / "audio"
    elif system == "Windows":
        data_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Think" / "audio"
    else:
        data_dir = Path.home() / ".local" / "share" / "Think" / "audio"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def derive_encryption_key(master_password: str) -> bytes:
    """Derive a Fernet encryption key from the master password.

    Uses the same salt as the database key derivation for consistency.
    """
    salt = get_or_create_salt()
    # Use PBKDF2 to derive a key, but with a different context than DB key
    key_material = hashlib.pbkdf2_hmac(
        'sha256',
        (master_password + "_audio").encode(),  # Add context to differentiate from DB key
        salt.encode(),
        100000,
        dklen=32  # Fernet requires 32 bytes
    )
    # Fernet requires base64-encoded 32-byte key
    return base64.urlsafe_b64encode(key_material)


def set_encryption_key(master_password: str) -> None:
    """Set the encryption key from the master password.

    Called after successful database unlock.
    """
    global _encryption_key
    _encryption_key = derive_encryption_key(master_password)


def clear_encryption_key() -> None:
    """Clear the encryption key (on logout)."""
    global _encryption_key
    _encryption_key = None


def _get_fernet() -> Fernet:
    """Get the Fernet instance for encryption/decryption."""
    if _encryption_key is None:
        raise RuntimeError("Encryption key not set. Database must be unlocked first.")
    return Fernet(_encryption_key)


def save_audio_file(audio_data: bytes, audio_format: str) -> str:
    """Save an audio file with encryption.

    Args:
        audio_data: Raw audio file bytes
        audio_format: File format (e.g., "mp3", "wav", "webm")

    Returns:
        Relative path to the encrypted file (e.g., "abc123.mp3.enc")
    """
    fernet = _get_fernet()

    # Generate unique filename
    filename = f"{uuid.uuid4()}.{audio_format}.enc"
    file_path = _get_audio_dir() / filename

    # Encrypt and save
    encrypted_data = fernet.encrypt(audio_data)
    file_path.write_bytes(encrypted_data)

    logger.info(f"Saved encrypted audio file: {filename}")
    return filename


def read_audio_file(relative_path: str) -> bytes:
    """Read and decrypt an audio file.

    Args:
        relative_path: Relative path returned by save_audio_file

    Returns:
        Decrypted audio file bytes

    Raises:
        ValueError: If path traversal attempt detected
        FileNotFoundError: If audio file doesn't exist
        RuntimeError: If decryption fails
    """
    fernet = _get_fernet()
    base_dir = _get_audio_dir()
    file_path = base_dir / relative_path

    _validate_path_within_directory(file_path, base_dir)

    if not file_path.exists():
        raise FileNotFoundError(f"Audio file not found: {relative_path}")

    encrypted_data = file_path.read_bytes()
    try:
        return fernet.decrypt(encrypted_data)
    except InvalidToken:
        logger.error(f"Decryption failed for audio file: {relative_path}")
        raise RuntimeError("Failed to decrypt audio file. The file may be corrupted or the encryption key may have changed.")


def delete_audio_file(relative_path: str) -> bool:
    """Delete an encrypted audio file.

    Args:
        relative_path: Relative path returned by save_audio_file

    Returns:
        True if file was deleted, False if it didn't exist

    Raises:
        ValueError: If path traversal attempt detected
    """
    base_dir = _get_audio_dir()
    file_path = base_dir / relative_path

    _validate_path_within_directory(file_path, base_dir)

    if file_path.exists():
        file_path.unlink()
        logger.info(f"Deleted audio file: {relative_path}")
        return True
    return False


def get_audio_file_path(relative_path: str) -> Path:
    """Get the full path to an audio file.

    Args:
        relative_path: Relative path returned by save_audio_file

    Returns:
        Full Path object to the file

    Raises:
        ValueError: If path traversal attempt detected
    """
    base_dir = _get_audio_dir()
    file_path = base_dir / relative_path

    _validate_path_within_directory(file_path, base_dir)

    return file_path
