"""Secure storage for secrets."""
import hashlib
import secrets as stdlib_secrets
from pathlib import Path
import platform
import os

from ..db import get_setting, set_setting, delete_setting


def _get_data_dir() -> Path:
    """Get the app data directory."""
    system = platform.system()
    if system == "Darwin":
        data_dir = Path.home() / "Library" / "Application Support" / "Think"
    elif system == "Windows":
        data_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Think"
    else:
        data_dir = Path.home() / ".local" / "share" / "Think"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _get_salt_path() -> Path:
    """Get the path to the salt file."""
    return _get_data_dir() / ".salt"


async def set_api_key(provider: str, api_key: str) -> None:
    """Store an API key in the encrypted database."""
    await set_setting(f"api_key_{provider}", api_key)


async def get_api_key(provider: str) -> str | None:
    """Retrieve an API key from the encrypted database."""
    return await get_setting(f"api_key_{provider}")


async def delete_api_key(provider: str) -> None:
    """Remove an API key from the database."""
    await delete_setting(f"api_key_{provider}")


def get_or_create_salt() -> str:
    """Get existing salt or create a new one.

    Uses binary mode to avoid Windows UTF-8 BOM issues that can cause
    the derived key to differ between setup and unlock.
    """
    salt_path = _get_salt_path()
    if salt_path.exists():
        # Read as bytes to avoid encoding issues (BOM on Windows)
        return salt_path.read_bytes().decode('ascii').strip()
    salt = stdlib_secrets.token_hex(16)
    # Write as bytes to avoid BOM being added on Windows
    salt_path.write_bytes(salt.encode('ascii'))
    return salt


def derive_db_key(password: str) -> str:
    """Derive a database encryption key from the master password."""
    salt = get_or_create_salt()
    db_key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode(),
        salt.encode(),
        100000
    ).hex()
    return db_key
