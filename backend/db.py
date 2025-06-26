import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "data/time_tracking.sqlite")


def create_connection() -> sqlite3.Connection:
    """Creates a database connection with foreign keys and WAL mode enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
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
