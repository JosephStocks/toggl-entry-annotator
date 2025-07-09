import os
import subprocess
import time

import httpx
import pytest

# --- Test Configuration ---
HOST = "127.0.0.1"
PORT = 8765  # Use a unique port for testing to avoid conflicts
BASE_URL = f"http://{HOST}:{PORT}"
TEST_DB_FILENAME = "test_persistence.sqlite"


# --- Helper to wait for server readiness ---
def wait_for_server(timeout=10):
    """Polls the health check endpoint until the server is up."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with httpx.Client() as client:
                response = client.get(BASE_URL + "/")
                if response.status_code == 200:
                    print("Server is up!")
                    return True
        except httpx.ConnectError:
            time.sleep(0.1)  # Wait before retrying
    raise TimeoutError("Server did not start in time.")


# --- Pytest Fixture for a clean test database ---
@pytest.fixture
def test_db_path(tmp_path):
    """
    Creates a temporary, isolated database for the test run.
    Yields the path to the database file.
    Cleans up the db, wal, and shm files afterwards.
    """
    db_path = tmp_path / TEST_DB_FILENAME
    # Manually import and run schema init for the temp DB
    from backend.db import DB_PATH
    from backend.schema import init_database

    # Temporarily override the global DB_PATH for schema creation
    original_path = DB_PATH
    try:
        # Point db.py's DB_PATH to our temporary file
        os.environ["DB_PATH"] = str(db_path)
        # Re-import to pick up the new env var might be needed in some setups,
        # but direct manipulation for init should be fine.
        # Let's create a temp `db` module scope override.
        import backend.db as test_db_module

        test_db_module.DB_PATH = str(db_path)

        init_database()
        print(f"Test database created at: {db_path}")
        yield str(db_path)

    finally:
        # Restore original path and clean up temp files
        os.environ["DB_PATH"] = original_path
        files_to_remove = [
            db_path,
            db_path.with_suffix(".sqlite-wal"),
            db_path.with_suffix(".sqlite-shm"),
        ]
        for f in files_to_remove:
            if f.exists():
                f.unlink()
        print("Test database cleaned up.")


def test_daily_note_persists_across_unclean_shutdown(test_db_path):
    """
    This test simulates the exact failure mode:
    1. Start the server process.
    2. Write a daily note to the database (which goes to the -wal file).
    3. Force-kill the server process (no graceful shutdown, no checkpoint).
    4. Start a NEW server process using the same DB file.
    5. Read the daily note back. It should exist if the shutdown hook is working.
    """
    server_process = None
    env = os.environ.copy()
    env["DB_PATH"] = test_db_path

    # The middleware requires these to be set, otherwise the server crashes on start.
    env["CF_ACCESS_CLIENT_ID"] = "dummy-test-id"
    env["CF_ACCESS_CLIENT_SECRET"] = "dummy-test-secret"

    try:
        # --- 1. Start the server for the first time ---
        print("\nStarting server process (first run)...")
        cmd = ["uvicorn", "backend.main:app", "--host", HOST, "--port", str(PORT)]

        # Use Popen to run in the background. Redirect output to avoid clutter.
        # server_process = subprocess.Popen(
        #     cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        # )
        server_process = subprocess.Popen(cmd, env=env)
        wait_for_server()

        # --- 2. Write a daily note ---
        note_date = "2025-07-25"
        note_content = "This note must persist!"
        with httpx.Client(base_url=BASE_URL) as client:
            print(f"Writing note for date: {note_date}")
            resp = client.put(f"/daily_notes/{note_date}", json={"note_content": note_content})
            assert resp.status_code == 200, "Failed to write the initial note."
            print("Note written successfully.")

        # --- 3. Force-kill the server (the crucial step) ---
        print("Force-killing server process (simulating unclean shutdown)...")
        server_process.kill()  # SIGKILL, no chance for graceful shutdown
        server_process.wait()  # Wait for the process to terminate
        print("Server killed.")

        # --- 4. Start the server again ---
        print("\nStarting server process (second run)...")
        server_process = subprocess.Popen(
            cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        wait_for_server()

        # --- 5. Try to read the note back ---
        with httpx.Client(base_url=BASE_URL) as client:
            print(f"Reading note for date: {note_date}")
            resp = client.get(f"/daily_notes/{note_date}")

            # --- 6. Assert persistence ---
            assert resp.status_code == 200

            # This is the key assertion.
            # WITHOUT your fix, resp.json() will be `None`.
            # WITH your fix, it will contain the note data.
            data = resp.json()
            assert data is not None, "Data was lost! The returned value is None."
            assert data["note_content"] == note_content, "Data was lost! Content does not match."
            print("SUCCESS: Daily note persisted across unclean shutdown.")

    finally:
        # Ensure the server process is always cleaned up
        if server_process and server_process.poll() is None:
            server_process.kill()
            server_process.wait()
