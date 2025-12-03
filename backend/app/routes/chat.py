from fastapi import APIRouter

from ..services.ai import chat as ai_chat
from ..schemas import ChatRequest


router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat")
async def chat(request: ChatRequest):
    response = await ai_chat(request.message)
    return {"response": response, "sources": []}
