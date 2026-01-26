from datetime import datetime
from sqlalchemy import String, Text, DateTime, LargeBinary, ForeignKey, Integer, Float
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(20), default="web")  # "web" | "note" | "voice_memo" | "audio" | "video"
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    media_source: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "recording" | "upload"
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    original_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    processing_attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Voice memory fields
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_format: Mapped[str | None] = mapped_column(String(20), nullable=True)
    audio_duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcription_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "pending" | "processing" | "completed" | "failed"
    transcript_segments: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of {start, end, text}

    # Video memory fields
    video_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    video_format: Mapped[str | None] = mapped_column(String(20), nullable=True)  # mp4, webm, mov, mkv, avi
    video_duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    video_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_processing_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "pending_extraction" | "extracting" | "ready" | "failed"

    # Document memory fields
    document_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    document_format: Mapped[str | None] = mapped_column(String(20), nullable=True)  # pdf (extensible later)
    document_page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tags: Mapped[list["MemoryTag"]] = relationship(back_populates="memory", cascade="all, delete-orphan")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)

    memories: Mapped[list["MemoryTag"]] = relationship(back_populates="tag")


class MemoryTag(Base):
    __tablename__ = "memory_tags"

    memory_id: Mapped[int] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)
    source: Mapped[str] = mapped_column(String(10), default="manual")  # "ai" or "manual"

    memory: Mapped["Memory"] = relationship(back_populates="tags")
    tag: Mapped["Tag"] = relationship(back_populates="memories")


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    pinned: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(10))  # "user" or "assistant"
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Token usage tracking (for assistant messages)
    prompt_tokens: Mapped[int | None] = mapped_column(nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(nullable=True)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    sources: Mapped[list["MessageSource"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class MessageSource(Base):
    __tablename__ = "message_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"))
    memory_id: Mapped[int] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"))
    relevance_score: Mapped[float | None] = mapped_column(nullable=True)

    message: Mapped["Message"] = relationship(back_populates="sources")
    memory: Mapped["Memory"] = relationship()


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    params: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress: Mapped[int] = mapped_column(default=0)
    processed: Mapped[int] = mapped_column(default=0)
    failed: Mapped[int] = mapped_column(default=0)
    total: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
