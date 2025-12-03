from pydantic import BaseModel


# Auth schemas
class SetPasswordRequest(BaseModel):
    password: str


class UnlockRequest(BaseModel):
    password: str


class ApiKeyRequest(BaseModel):
    provider: str
    api_key: str


# Note schemas
class NoteCreate(BaseModel):
    title: str = ""
    content: str = ""
    type: str = "web"
    url: str | None = None


# Chat schemas
class ChatRequest(BaseModel):
    message: str
    mode: str = "quick"


# Helpers
def format_note_for_embedding(title: str | None, content: str | None) -> str:
    """Format note title and content for embedding generation."""
    return f"{title or ''}\n{content or ''}"
