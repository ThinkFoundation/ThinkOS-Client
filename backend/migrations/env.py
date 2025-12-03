"""Alembic environment for SQLCipher encrypted database."""
import os
from logging.config import fileConfig

from sqlalchemy import pool
from alembic import context

from app.models import Base
from app.db import get_db_path

# Register the dialect
from sqlalchemy.dialects import registry
registry.register("sqlcipher", "app.db", "SQLCipherDialect")

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url():
    return f"sqlcipher:///{get_db_path()}"


def run_migrations_offline():
    """Run migrations in 'offline' mode (generates SQL script)."""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode with SQLCipher encryption."""
    from pysqlcipher3 import dbapi2 as sqlcipher
    import sqlite_vec

    # Get encryption key from environment
    db_key = os.environ.get("THINK_DB_KEY")
    if not db_key:
        raise RuntimeError("THINK_DB_KEY environment variable required for migrations")

    def connect():
        conn = sqlcipher.connect(str(get_db_path()))
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA key = '{db_key}'")
        cursor.close()
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        return conn

    connectable = context.config.attributes.get("connection", None)

    if connectable is None:
        from sqlalchemy import create_engine
        connectable = create_engine(
            get_url(),
            creator=connect,
            poolclass=pool.NullPool,
        )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
