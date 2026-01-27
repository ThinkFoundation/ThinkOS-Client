# Memory CRUD functions
from .memories import (
    create_memory,
    get_memories,
    get_memory,
    get_memory_by_url,
    delete_memory,
    update_memory,
    update_memory_embedding,
    update_memory_summary,
    update_memory_embedding_summary,
    update_memory_title,
    get_memories_without_embeddings,
    count_memories_without_embedding_summary,
    get_memories_without_embedding_summary,
    increment_processing_attempts,
    count_memories_with_embeddings,
    count_memories_needing_reembedding,
    count_memories_needing_processing,
    get_memories_needing_reembedding,
)

# Tag CRUD functions
from .tags import (
    get_all_tags,
    get_or_create_tag,
    add_tags_to_memory,
    remove_tag_from_memory,
    get_memory_tags,
)

# Settings CRUD functions
from .settings import (
    get_setting,
    set_setting,
    delete_setting,
)

# Conversation CRUD functions
from .conversations import (
    create_conversation,
    get_conversations,
    get_conversation,
    delete_conversation,
    update_conversation_title,
    toggle_conversation_pinned,
    add_message,
)

# Media CRUD functions (voice memos, audio, video, documents)
from .media import (
    create_media_memory,
    update_memory_transcript,
    update_transcription_status,
    reset_transcription_status_if_not_processing,
    get_media_memory,
    delete_media_memory,
    create_video_memory,
    update_video_processing_status,
    update_video_audio,
    update_video_thumbnail,
    get_video_memory,
    delete_video_memory,
    create_document_memory,
    get_document_memory,
    update_document_thumbnail,
    delete_document_memory,
)

__all__ = [
    # Memory functions
    "create_memory",
    "get_memories",
    "get_memory",
    "get_memory_by_url",
    "delete_memory",
    "update_memory",
    "update_memory_embedding",
    "update_memory_summary",
    "update_memory_embedding_summary",
    "update_memory_title",
    "get_memories_without_embeddings",
    "count_memories_without_embedding_summary",
    "get_memories_without_embedding_summary",
    "increment_processing_attempts",
    "count_memories_with_embeddings",
    "count_memories_needing_reembedding",
    "count_memories_needing_processing",
    "get_memories_needing_reembedding",
    # Tag functions
    "get_all_tags",
    "get_or_create_tag",
    "add_tags_to_memory",
    "remove_tag_from_memory",
    "get_memory_tags",
    # Settings functions
    "get_setting",
    "set_setting",
    "delete_setting",
    # Conversation functions
    "create_conversation",
    "get_conversations",
    "get_conversation",
    "delete_conversation",
    "update_conversation_title",
    "toggle_conversation_pinned",
    "add_message",
    # Media functions
    "create_media_memory",
    "update_memory_transcript",
    "update_transcription_status",
    "reset_transcription_status_if_not_processing",
    "get_media_memory",
    "delete_media_memory",
    "create_video_memory",
    "update_video_processing_status",
    "update_video_audio",
    "update_video_thumbnail",
    "get_video_memory",
    "delete_video_memory",
    "create_document_memory",
    "get_document_memory",
    "update_document_thumbnail",
    "delete_document_memory",
]
