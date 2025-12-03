from .core import init_db, is_db_initialized, db_exists, DB_PATH
from .crud import (
    create_note,
    get_notes,
    get_note,
    get_note_by_url,
    delete_note,
    update_note,
    update_note_embedding,
    get_notes_without_embeddings,
    get_setting,
    set_setting,
    delete_setting,
)
from .search import search_similar_notes

__all__ = [
    "init_db",
    "is_db_initialized",
    "db_exists",
    "DB_PATH",
    "create_note",
    "get_notes",
    "get_note",
    "get_note_by_url",
    "delete_note",
    "update_note",
    "update_note_embedding",
    "get_notes_without_embeddings",
    "get_setting",
    "set_setting",
    "delete_setting",
    "search_similar_notes",
]
