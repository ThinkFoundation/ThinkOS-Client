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

    if result:
        return  # Already exists

    # Check if FTS5 module is available (not compiled into all SQLite builds,
    # e.g., rotki-pysqlcipher3 on Windows doesn't include FTS5)
    try:
        conn.execute(text("CREATE VIRTUAL TABLE _fts5_test USING fts5(test)"))
        conn.execute(text("DROP TABLE _fts5_test"))
    except Exception:
        print("WARNING: FTS5 module not available - full-text search will be disabled", flush=True)
        return

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


@migration(13, "Add embedding_summary column to memories")
def migration_013(conn: Connection) -> None:
    """Add embedding_summary for structured semantic search summaries."""
    result = conn.execute(text("PRAGMA table_info(memories)")).fetchall()
    columns = [row[1] for row in result]

    if "embedding_summary" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN embedding_summary TEXT"))


@migration(14, "Add processing_attempts column to memories")
def migration_014(conn: Connection) -> None:
    """Track failed processing attempts to prevent infinite retry loops."""
    result = conn.execute(text("PRAGMA table_info(memories)")).fetchall()
    columns = [row[1] for row in result]

    if "processing_attempts" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN processing_attempts INTEGER DEFAULT 0"))


@migration(15, "Handle FTS5 unavailability gracefully")
def migration_015(conn: Connection) -> None:
    """Drop FTS5 triggers if FTS5 module is no longer available."""
    # Check if FTS5 triggers exist
    triggers = conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memories_fts%'"
    )).fetchall()

    if not triggers:
        return  # No FTS triggers, nothing to do

    # Test if FTS5 is available
    try:
        conn.execute(text("CREATE VIRTUAL TABLE _fts5_test USING fts5(test)"))
        conn.execute(text("DROP TABLE _fts5_test"))
        return  # FTS5 works, keep triggers
    except Exception:
        pass  # FTS5 not available

    # Drop triggers that reference FTS5
    print("FTS5 unavailable - removing FTS5 triggers for graceful fallback", flush=True)
    for trigger in ['memories_fts_ai', 'memories_fts_ad', 'memories_fts_au']:
        conn.execute(text(f"DROP TRIGGER IF EXISTS {trigger}"))

    # Drop the FTS table
    conn.execute(text("DROP TABLE IF EXISTS memories_fts"))


@migration(16, "Migrate openai provider to specific cloud providers")
def migration_016(conn: Connection) -> None:
    """Migrate users from generic 'openai' provider to specific providers.

    Also migrates legacy openai_base_url settings even if ai_provider is not 'openai',
    since users may have configured cloud providers in the old format.
    """
    from ..models_info import CLOUD_PROVIDERS

    # Check current ai_provider setting
    result = conn.execute(text(
        "SELECT value FROM settings WHERE key = 'ai_provider'"
    )).fetchone()
    ai_provider = result[0] if result else None

    # Get the base URL to determine which provider to migrate to
    base_url_result = conn.execute(text(
        "SELECT value FROM settings WHERE key = 'openai_base_url'"
    )).fetchone()
    base_url = base_url_result[0] if base_url_result else ""

    # Determine if we have legacy cloud provider settings to migrate
    cloud_providers_in_url = ["openrouter", "venice"]
    is_cloud_url = any(p in base_url.lower() for p in cloud_providers_in_url)

    # Skip if no legacy data to migrate:
    # - ai_provider is not 'openai' AND
    # - openai_base_url doesn't contain a known cloud provider
    if ai_provider != "openai" and not is_cloud_url:
        return

    # Determine new provider based on base URL
    new_provider = None
    if "openrouter" in base_url.lower():
        new_provider = "openrouter"
    elif "venice" in base_url.lower():
        new_provider = "venice"

    # If we can't determine the provider, skip migration with a warning
    if not new_provider:
        if ai_provider == "openai":
            print(
                f"WARNING: Cannot determine cloud provider from base URL '{base_url}'. "
                "Skipping migration - please configure your provider manually in Settings.",
                flush=True
            )
        return

    print(f"Migrating legacy openai settings to '{new_provider}' provider", flush=True)

    # Get old model settings
    old_model_result = conn.execute(text(
        "SELECT value FROM settings WHERE key = 'openai_model'"
    )).fetchone()
    old_model = old_model_result[0] if old_model_result else None

    old_embedding_result = conn.execute(text(
        "SELECT value FROM settings WHERE key = 'openai_embedding_model'"
    )).fetchone()
    old_embedding = old_embedding_result[0] if old_embedding_result else None

    # Check if target settings already exist (don't overwrite)
    existing_model_result = conn.execute(text(
        "SELECT value FROM settings WHERE key = :key"
    ), {"key": f"{new_provider}_model"}).fetchone()

    existing_embedding_result = conn.execute(text(
        "SELECT value FROM settings WHERE key = :key"
    ), {"key": f"{new_provider}_embedding_model"}).fetchone()

    # Only update ai_provider if it was 'openai' (don't change from ollama)
    if ai_provider == "openai":
        conn.execute(text(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_provider', :provider)"
        ), {"provider": new_provider})

        # Update embedding_provider - but Venice doesn't support embeddings,
        # so fall back to openrouter for embeddings if chat provider is Venice
        embedding_provider = new_provider if new_provider != "venice" else "openrouter"
        conn.execute(text(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('embedding_provider', :provider)"
        ), {"provider": embedding_provider})

    # Migrate model setting to new provider-specific key (only if not already set)
    if not existing_model_result:
        if old_model:
            conn.execute(text(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (:key, :value)"
            ), {"key": f"{new_provider}_model", "value": old_model})
        else:
            # Use default from provider config
            provider_config = CLOUD_PROVIDERS.get(new_provider, {})
            default_model = provider_config.get("default_chat_model")
            if default_model:
                conn.execute(text(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (:key, :value)"
                ), {"key": f"{new_provider}_model", "value": default_model})

    # Migrate embedding model setting (only if not already set)
    if not existing_embedding_result:
        if old_embedding:
            conn.execute(text(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (:key, :value)"
            ), {"key": f"{new_provider}_embedding_model", "value": old_embedding})
        else:
            provider_config = CLOUD_PROVIDERS.get(new_provider, {})
            default_embedding = provider_config.get("default_embedding_model")
            if default_embedding:
                conn.execute(text(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (:key, :value)"
                ), {"key": f"{new_provider}_embedding_model", "value": default_embedding})

    # Copy API key to new provider key name (only if not already set)
    # The API key is stored as 'api_key_openai', copy to 'api_key_{new_provider}'
    existing_key_result = conn.execute(text(
        "SELECT value FROM settings WHERE key = :key"
    ), {"key": f"api_key_{new_provider}"}).fetchone()

    if not existing_key_result:
        old_key_result = conn.execute(text(
            "SELECT value FROM settings WHERE key = 'api_key_openai'"
        )).fetchone()

        if old_key_result:
            conn.execute(text(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (:key, :value)"
            ), {"key": f"api_key_{new_provider}", "value": old_key_result[0]})


@migration(17, "Add media memory columns for voice, audio, and video")
def migration_017(conn: Connection) -> None:
    """Add all columns for media memory support (voice memos, audio uploads, video).

    Columns added:
    - Audio: audio_path, audio_format, audio_duration, transcript, transcription_status,
             transcript_segments, media_source
    - Video: video_path, video_format, video_duration, thumbnail_path, video_width,
             video_height, video_processing_status
    """
    result = conn.execute(text("PRAGMA table_info(memories)")).fetchall()
    columns = [row[1] for row in result]

    # Audio/voice columns
    if "audio_path" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN audio_path VARCHAR(500)"))
    if "audio_format" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN audio_format VARCHAR(20)"))
    if "audio_duration" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN audio_duration REAL"))
    if "transcript" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN transcript TEXT"))
    if "transcription_status" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN transcription_status VARCHAR(20)"))
    if "transcript_segments" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN transcript_segments TEXT"))
    if "media_source" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN media_source VARCHAR(20)"))

    # Video columns
    if "video_path" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN video_path VARCHAR(500)"))
    if "video_format" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN video_format VARCHAR(20)"))
    if "video_duration" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN video_duration REAL"))
    if "thumbnail_path" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN thumbnail_path VARCHAR(500)"))
    if "video_width" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN video_width INTEGER"))
    if "video_height" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN video_height INTEGER"))
    if "video_processing_status" not in columns:
        conn.execute(text("ALTER TABLE memories ADD COLUMN video_processing_status VARCHAR(20)"))


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
