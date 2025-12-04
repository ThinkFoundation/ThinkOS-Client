from fastapi import APIRouter

from .auth import router as auth_router
from .memories import router as memories_router
from .chat import router as chat_router
from .settings import router as settings_router
from .conversations import router as conversations_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(memories_router)
router.include_router(chat_router)
router.include_router(settings_router)
router.include_router(conversations_router)
