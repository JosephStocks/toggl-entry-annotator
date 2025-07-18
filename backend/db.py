import os
import sqlite3
from pathlib import Path

# This default will now be overridden by fly.toml in production
# or by fixtures during testing.
DB_PATH = os.environ.get("DB_PATH")

# In a test environment, DB_PATH can be None initially, as fixtures will provide it.
# In a non-test environment, we enforce that it must be set.
if not DB_PATH and os.environ.get("PYTEST_RUNNING") != "true":
    raise ValueError("FATAL: DB_PATH environment variable is not set. Application cannot start.")


def create_connection() -> sqlite3.Connection:
    """Creates a database connection with foreign keys enabled."""
    # The DB_PATH is now expected to be valid when this function is called.
    if not DB_PATH:
        raise RuntimeError("DB_PATH was not set. Ensure a test fixture or environment provides it.")

    db_file = Path(DB_PATH)
    # This line ensures the parent directory exists.
    db_file.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")

    # --- THIS IS THE FIX ---
    # Switch from WAL to the classic, more direct DELETE journal mode.
    # This ensures commits are written directly to the main DB file,
    # removing the dependency on a shutdown checkpoint.
    conn.execute("PRAGMA journal_mode = DELETE")

    return conn


def get_db():
    """
    FastAPI dependency that yields a db connection.
    """
    conn = create_connection()
    try:
        yield conn
    finally:
        conn.close()
