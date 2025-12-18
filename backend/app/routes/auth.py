from fastapi import APIRouter, HTTPException

from ..config import reload_settings
from ..db import init_db, is_db_initialized, db_exists, reset_db_connection
from ..services.secrets import derive_db_key, set_api_key, get_api_key, delete_api_key
from ..schemas import SetPasswordRequest, UnlockRequest, ApiKeyRequest


router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/auth/status")
async def auth_status():
    """Check if password is set and if DB is unlocked."""
    return {
        "has_password": db_exists(),
        "is_unlocked": is_db_initialized(),
    }


@router.post("/auth/setup")
async def setup_password(request: SetPasswordRequest):
    """Set the master password for the first time."""
    if db_exists():
        raise HTTPException(status_code=400, detail="Password already set")

    db_key = derive_db_key(request.password)
    await init_db(db_key)
    reload_settings()  # Load settings from newly created DB

    return {"success": True}


@router.post("/auth/unlock")
async def unlock(request: UnlockRequest):
    """Unlock the database with the master password."""
    if not db_exists():
        raise HTTPException(status_code=400, detail="No password set")

    db_key = derive_db_key(request.password)
    try:
        await init_db(db_key)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid password")

    reload_settings()  # Load settings from unlocked DB
    return {"success": True}


@router.post("/settings/api-key")
async def save_api_key_endpoint(request: ApiKeyRequest):
    """Save an API key to the encrypted database."""
    await set_api_key(request.provider, request.api_key)
    return {"success": True}


@router.get("/settings/api-key/{provider}")
async def check_api_key(provider: str):
    """Check if an API key exists (doesn't return the key)."""
    key = await get_api_key(provider)
    return {"has_key": key is not None}


@router.delete("/settings/api-key/{provider}")
async def remove_api_key(provider: str):
    """Remove an API key from the database."""
    await delete_api_key(provider)
    return {"success": True}


@router.post("/auth/logout")
async def logout():
    """Logout by resetting the database connection (locks the app)."""
    reset_db_connection()
    return {"success": True}
