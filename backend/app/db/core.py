from pathlib import Path
import platform
import os
import struct
from sqlalchemy import create_engine, event, text
from sqlalchemy.dialects import registry
from sqlalchemy.dialects.sqlite.pysqlite import SQLiteDialect_pysqlite
from sqlalchemy.orm import sessionmaker
from concurrent.futures import ThreadPoolExecutor
import asyncio

from pysqlcipher3 import dbapi2 as sqlcipher
import sqlite_vec



def serialize_embedding(embedding: list[float]) -> bytes:
    """Serialize embedding list to bytes for storage."""
    return struct.pack(f"{len(embedding)}f", *embedding)


class SQLCipherDialect(SQLiteDialect_pysqlite):
    """Custom dialect for pysqlcipher3 that skips REGEXP registration."""
    name = "sqlcipher"
    driver = "pysqlcipher3"

    @classmethod
    def import_dbapi(cls): # pyright: ignore[reportIncompatibleMethodOverride]
        return sqlcipher

    def on_connect(self): # pyright: ignore[reportIncompatibleMethodOverride]
        return None


registry.register("sqlcipher", "app.db.core", "SQLCipherDialect")


def get_db_path() -> Path:
    system = platform.system()
    if system == "Darwin":
        data_dir = Path.home() / "Library" / "Application Support" / "Think"
    elif system == "Windows":
        data_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Think"
    else:
        data_dir = Path.home() / ".local" / "share" / "Think"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "think.db"


DB_PATH = get_db_path()

# Global state
_engine = None
_session_maker = None
_executor = ThreadPoolExecutor(max_workers=1)
_db_key: str | None = None


def _on_connect(dbapi_conn, connection_record) -> None:
    """Set the encryption key and load sqlite-vec when connection is created."""
    if _db_key:
        cursor = dbapi_conn.cursor()
        # Escape single quotes to prevent SQL injection
        escaped_key = _db_key.replace("'", "''")
        cursor.execute(f"PRAGMA key = '{escaped_key}'")
        cursor.close()
    dbapi_conn.enable_load_extension(True)
    sqlite_vec.load(dbapi_conn)
    dbapi_conn.enable_load_extension(False)


def init_engine(db_key: str):
    """Initialize the database engine with encryption key."""
    global _engine, _session_maker, _db_key

    _db_key = db_key

    _engine = create_engine(
        f"sqlcipher:///{DB_PATH}",
        echo=False,
    )

    event.listen(_engine, "connect", _on_connect)
    _session_maker = sessionmaker(bind=_engine)


def get_session_maker() -> sessionmaker:
    """Get the session maker instance."""
    if _session_maker is None:
        raise RuntimeError("Database not initialized")
    return _session_maker


def get_executor():
    """Get the thread pool executor."""
    return _executor


def run_sync(func):
    """Run a synchronous function in the thread pool."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_executor, func)


async def init_db(db_key: str):
    """Initialize database with encryption and run migrations."""
    init_engine(db_key)

    def setup_database():
        if not _engine:
            return

        from .migrations import run_migrations

        with _engine.connect() as connection:
            applied = run_migrations(connection)
            for version, desc in applied:
                print(f"Applied migration {version}: {desc}")

    await run_sync(setup_database)


def is_db_initialized() -> bool:
    """Check if the database engine has been initialized."""
    return _engine is not None


def db_exists() -> bool:
    """Check if the database file exists (password was set)."""
    return DB_PATH.exists()


def reset_db_connection():
    """Reset the database connection (logout/lock)."""
    global _engine, _session_maker, _db_key
    
    if _engine:
        _engine.dispose()
    
    _engine = None
    _session_maker = None
    _db_key = None
