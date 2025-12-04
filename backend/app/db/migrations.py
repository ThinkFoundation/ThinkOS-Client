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
