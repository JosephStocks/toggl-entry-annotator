import sqlite3
from collections.abc import Generator
from pathlib import Path

import pytest

from backend.schema import SCHEMA


@pytest.fixture
def test_db(tmp_path: Path) -> Generator[sqlite3.Connection]:
    """
    A fixture that creates a temporary, isolated database for a single test function.
    - It uses pytest's `tmp_path` fixture to create a DB in a temporary directory.
    - It initializes the schema directly.
    - It yields a connection.
    - It guarantees the connection is closed and the temporary file is cleaned up.
    """
    db_path = tmp_path / "test_function.sqlite"

    # 1. Create a connection to the temporary database file
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = DELETE")  # Important for test isolation

    # 2. Manually initialize the schema
    conn.executescript(SCHEMA)
    conn.commit()

    try:
        # 3. Yield the connection for the test to use
        yield conn
    finally:
        # 4. Teardown: close the connection. `tmp_path` handles file deletion.
        conn.close()
