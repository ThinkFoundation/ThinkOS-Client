from fastapi import APIRouter

from .auth import router as auth_router
from .notes import router as notes_router
from .chat import router as chat_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(notes_router)
router.include_router(chat_router)
