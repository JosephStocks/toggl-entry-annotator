# backend/conftest.py
import os
from pathlib import Path

import pytest


@pytest.fixture(autouse=True, scope="session")
def set_test_environment():
    """
    Set environment variables and ensure the project root is on the path.
    This runs once per test session.
    """
    # 1. Set the PYTEST_RUNNING flag for db.py
    os.environ["PYTEST_RUNNING"] = "true"

    # 2. Add project root to PYTHONPATH for subprocess calls
    # This is more robust than relying on the current working directory.
    project_root = Path(__file__).resolve().parent.parent
    original_pythonpath = os.environ.get("PYTHONPATH", "")
    os.environ["PYTHONPATH"] = f"{project_root}:{original_pythonpath}"

    yield

    # Clean up environment variables
    del os.environ["PYTEST_RUNNING"]
    os.environ["PYTHONPATH"] = original_pythonpath


@pytest.fixture
def test_db():
    """
    A fixture that creates a temporary, isolated database for a test function.
    - It overrides the DB_PATH for the duration of the test.
    - It ensures the database schema is initialized.
    - It cleans up the database file after the test is complete.
    """
    db_path = "test_db_for_function.sqlite"
    original_db_path = os.environ.get("DB_PATH")
    os.environ["DB_PATH"] = db_path

    # We need to re-import the db module to pick up the new path
    # and re-import schema to use the new db connection.
    import importlib

    from backend import db, schema

    importlib.reload(db)
    importlib.reload(schema)

    # Ensure the parent directory exists
    Path(db.DB_PATH).parent.mkdir(parents=True, exist_ok=True)

    # Initialize the schema for this specific test DB
    schema.init_database()

    yield db.create_connection()  # The test runs here

    # --- Teardown ---
    # Restore the original DB_PATH
    if original_db_path:
        os.environ["DB_PATH"] = original_db_path
    else:
        del os.environ["DB_PATH"]

    # Cleanup the test database file
    if os.path.exists(db_path):
        os.remove(db_path)
