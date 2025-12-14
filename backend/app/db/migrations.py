"""
Simple version-based database migration system.

Migrations run automatically when the database is unlocked.
Each migration is idempotent (safe to re-run).
"""

from typing import Callable
from sqlalchemy import Connection, text


MigrationFunc = Callable[[Connection], None]

# Migration registry: (version, description, function)
MIGRATIONS: list[tuple[int, str, MigrationFunc]] = []


def migration(version: int, description: str):
    """Decorator to register a migration."""
    def decorator(func: MigrationFunc) -> MigrationFunc:
        MIGRATIONS.append((version, description, func))
        return func
    return decorator


# --- Schema version tracking ---

SCHEMA_VERSION_TABLE = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""


def get_current_version(conn: Connection) -> int:
    """Get the current schema version, or 0 if no migrations applied."""
    result = conn.execute(text(
        "SELECT MAX(version) FROM schema_version"
    )).scalar()
    return result or 0


def record_migration(conn: Connection, version: int, description: str) -> None:
    """Record that a migration was applied."""
    conn.execute(text(
        "INSERT INTO schema_version (version, description) VALUES (:v, :d)"
    ), {"v": version, "d": description})


# --- Migrations ---

@migration(1, "Create memories table")
def migration_001(conn: Connection) -> None:
    """Create memories table if it doesn't exist."""
    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
    )).fetchone()

    if not result:
        conn.execute(text("""
            CREATE TABLE memories (
                id INTEGER PRIMARY KEY,
                type VARCHAR(20) NOT NULL DEFAULT 'web',
                url VARCHAR(2048),
                title VARCHAR(500),
                content TEXT,
                summary TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))


@migration(2, "Add tags and memory_tags tables")
def migration_002(conn: Connection) -> None:
    """Create tags and memory_tags tables."""
    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tags'"
    )).fetchone()

    if not result:
        conn.execute(text("""
            CREATE TABLE tags (
                id INTEGER PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE
            )
        """))

    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_tags'"
    )).fetchone()

    if not result:
        conn.execute(text("""
            CREATE TABLE memory_tags (
                memory_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                source VARCHAR(10) NOT NULL DEFAULT 'manual',
                PRIMARY KEY (memory_id, tag_id),
                FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        """))


@migration(3, "Add embedding column to memories")
def migration_003(conn: Connection) -> None:
    """Add embedding column for vector search."""
    result = conn.execute(text("PRAGMA table_info(memories)")).fetchall()
    columns = [row[1] for row in result]

    if "embedding" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN embedding BLOB"))


@migration(4, "Add settings table")
def migration_004(conn: Connection) -> None:
    """Create settings table."""
    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
    )).fetchone()

    if not result:
        conn.execute(text("""
            CREATE TABLE settings (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT NOT NULL
            )
        """))


@migration(5, "Add original_title column to memories")
def migration_005(conn: Connection) -> None:
    """Add original_title column for storing original web page titles."""
    result = conn.execute(text("PRAGMA table_info(memories)")).fetchall()
    columns = [row[1] for row in result]

    if "original_title" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN original_title VARCHAR(500)"))


@migration(6, "Create conversations and messages tables")
def migration_006(conn: Connection) -> None:
    """Create tables for chat history."""
    # Create conversations table
    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
    )).fetchone()

    if not result:
        conn.execute(text("""
            CREATE TABLE conversations (
                id INTEGER PRIMARY KEY,
                title VARCHAR(255) NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))

    # Create messages table
    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
    )).fetchone()

    if not result:
        conn.execute(text("""
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                role VARCHAR(10) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
        """))


@migration(7, "Create message_sources table for persisting chat sources")
def migration_007(conn: Connection) -> None:
    """Create message_sources table for storing RAG sources per message."""
    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='message_sources'"
    )).fetchone()

    if not result:
        conn.execute(text("""
            CREATE TABLE message_sources (
                id INTEGER PRIMARY KEY,
                message_id INTEGER NOT NULL,
                memory_id INTEGER NOT NULL,
                relevance_score REAL,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
                UNIQUE(message_id, memory_id)
            )
        """))
        # Index for efficient lookups
        conn.execute(text("""
            CREATE INDEX idx_message_sources_message_id ON message_sources(message_id)
        """))


@migration(8, "Add FTS5 full-text search for memories")
def migration_008(conn: Connection) -> None:
    """Create FTS5 virtual table for hybrid search."""
    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
    )).fetchone()

    if not result:
        # Create FTS5 virtual table
        conn.execute(text("""
            CREATE VIRTUAL TABLE memories_fts USING fts5(
                title,
                content,
                content='memories',
                content_rowid='id'
            )
        """))

        # Populate with existing data
        conn.execute(text("""
            INSERT INTO memories_fts(rowid, title, content)
            SELECT id, COALESCE(title, ''), COALESCE(content, '')
            FROM memories
        """))

        # Create triggers to keep FTS in sync
        conn.execute(text("""
            CREATE TRIGGER memories_fts_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, title, content)
                VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.content, ''));
            END
        """))

        conn.execute(text("""
            CREATE TRIGGER memories_fts_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, title, content)
                VALUES ('delete', old.id, COALESCE(old.title, ''), COALESCE(old.content, ''));
            END
        """))

        conn.execute(text("""
            CREATE TRIGGER memories_fts_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, title, content)
                VALUES ('delete', old.id, COALESCE(old.title, ''), COALESCE(old.content, ''));
                INSERT INTO memories_fts(rowid, title, content)
                VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.content, ''));
            END
        """))


@migration(9, "Add token usage columns to messages")
def migration_009(conn: Connection) -> None:
    """Add token usage tracking to messages."""
    result = conn.execute(text("PRAGMA table_info(messages)")).fetchall()
    columns = [row[1] for row in result]

    if "prompt_tokens" not in columns:
        conn.execute(text("ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER"))
    if "completion_tokens" not in columns:
        conn.execute(text("ALTER TABLE messages ADD COLUMN completion_tokens INTEGER"))
    if "total_tokens" not in columns:
        conn.execute(text("ALTER TABLE messages ADD COLUMN total_tokens INTEGER"))


@migration(10, "Add embedding_model column to memories")
def migration_010(conn: Connection) -> None:
    """Track which embedding model was used for each memory."""
    result = conn.execute(text("PRAGMA table_info(memories)")).fetchall()
    columns = [row[1] for row in result]

    if "embedding_model" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN embedding_model VARCHAR(100)"))


@migration(11, "Create jobs table for background task tracking")
def migration_011(conn: Connection) -> None:
    """Create jobs table for tracking background tasks like re-embedding."""
    result = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
    )).fetchone()

    if not result:
        conn.execute(text("""
            CREATE TABLE jobs (
                id VARCHAR(36) PRIMARY KEY,
                type VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                params TEXT,
                result TEXT,
                error TEXT,
                progress INTEGER DEFAULT 0,
                processed INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0,
                total INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP
            )
        """))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status)"
        ))


@migration(12, "Add pinned column to conversations")
def migration_012(conn: Connection) -> None:
    """Add pinned boolean to conversations for pinning feature."""
    result = conn.execute(text("PRAGMA table_info(conversations)")).fetchall()
    columns = [row[1] for row in result]

    if "pinned" not in columns:
        conn.execute(text("ALTER TABLE conversations ADD COLUMN pinned INTEGER DEFAULT 0"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(pinned)"))


# --- Migration runner ---

def run_migrations(conn: Connection) -> list[tuple[int, str]]:
    """
    Run all pending migrations.

    Returns list of (version, description) for migrations that were applied.
    """
    # Ensure schema_version table exists
    conn.execute(text(SCHEMA_VERSION_TABLE))
    conn.commit()

    current_version = get_current_version(conn)
    applied = []

    # Sort migrations by version
    sorted_migrations = sorted(MIGRATIONS, key=lambda m: m[0])

    for version, description, func in sorted_migrations:
        if version > current_version:
            func(conn)
            record_migration(conn, version, description)
            conn.commit()
            applied.append((version, description))

    return applied
