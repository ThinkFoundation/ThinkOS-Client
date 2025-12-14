from pydantic import BaseModel


# Auth schemas
class SetPasswordRequest(BaseModel):
    password: str


class UnlockRequest(BaseModel):
    password: str


class ApiKeyRequest(BaseModel):
    provider: str
    api_key: str


# Memory schemas
class MemoryCreate(BaseModel):
    title: str = ""
    content: str = ""
    type: str = "web"
    url: str | None = None
    tags: list[str] | None = None  # manual tags to add on creation


# Tag schemas
class TagResponse(BaseModel):
    id: int
    name: str


class MemoryTagResponse(BaseModel):
    id: int
    name: str
    source: str  # "ai" or "manual"


# Chat schemas
class ChatRequest(BaseModel):
    message: str
    conversation_id: int | None = None
    mode: str = "quick"


# Conversation schemas
class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: str


class ConversationResponse(BaseModel):
    id: int
    title: str
    pinned: bool = False
    created_at: str
    updated_at: str
    message_count: int
    last_message: str | None = None


class ConversationDetailResponse(BaseModel):
    id: int
    title: str
    created_at: str
    updated_at: str
    messages: list[MessageResponse]


class ConversationCreate(BaseModel):
    title: str = ""


class ConversationUpdate(BaseModel):
    title: str


class ConversationPinUpdate(BaseModel):
    pinned: bool


# Helpers
def format_memory_for_embedding(title: str | None, content: str | None) -> str:
    """Format memory title and content for embedding generation."""
    return f"{title or ''}\n{content or ''}"
