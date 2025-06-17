import pytest
from fastapi.testclient import TestClient
from main import app, _epoch_from_dt
from datetime import datetime, timezone
import sqlite3
import os

client = TestClient(app)

# --- Mocks for Toggl API calls ---
@pytest.fixture
def mock_sync_time_entries(mocker):
    """Mocks the toggl.sync_time_entries function."""
    return mocker.patch("main.toggl.sync_time_entries", return_value=5)

@pytest.fixture
def mock_get_current_entry(mocker):
    """Mocks the toggl.get_current_running_entry function."""
    mock_data = {
        "id": 12345,
        "description": "Testing the current entry",
        "start": "2025-01-01T10:00:00Z",
        "duration": -1735725600,
        "project_id": 987,
        "project_name": "API Testing",
    }
    return mocker.patch("main.toggl.get_current_running_entry", return_value=mock_data)

@pytest.fixture
def mock_get_no_current_entry(mocker):
    """Mocks the toggl.get_current_running_entry to return None."""
    return mocker.patch("main.toggl.get_current_running_entry", return_value=None)

# Use a test DB for isolation
test_db_path = "test_time_tracking.sqlite"

def setup_module(module):
    # Create tables in the test DB
    schema = """
    CREATE TABLE IF NOT EXISTS time_entries (
        entry_id    INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        project_id  INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        seconds     INTEGER NOT NULL,
        start       TEXT NOT NULL,
        stop        TEXT,
        at          TEXT NOT NULL,
        start_ts    INTEGER NOT NULL,
        stop_ts     INTEGER,
        at_ts       INTEGER NOT NULL,
        tag_ids     TEXT,
        tag_names   TEXT
    );
    CREATE TABLE IF NOT EXISTS entry_notes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id    INTEGER NOT NULL,
        note_text   TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (entry_id) REFERENCES time_entries(entry_id) ON DELETE CASCADE
    );
    """
    with sqlite3.connect(test_db_path) as db:
        db.executescript(schema)
        db.commit()
    # Patch the DB_PATH in main.py
    import main
    main.DB_PATH = test_db_path

def teardown_module(module):
    if os.path.exists(test_db_path):
        os.remove(test_db_path)

def test_get_time_entries_empty():
    resp = client.get("/time_entries?start_iso=2025-01-01T00:00:00Z&end_iso=2025-01-02T00:00:00Z")
    assert resp.status_code == 200
    assert resp.json() == []

def test_get_time_entries_invalid_range():
    resp = client.get("/time_entries?start_iso=2025-01-02T00:00:00Z&end_iso=2025-01-01T00:00:00Z")
    assert resp.status_code == 400

def test_create_and_delete_note():
    # Insert a time entry to attach a note to
    with sqlite3.connect(test_db_path) as db:
        db.execute("INSERT INTO time_entries (entry_id, description, project_id, project_name, seconds, start, at, start_ts, at_ts, tag_ids, tag_names) VALUES (1, 'desc', 1, 'proj', 60, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 1, 1, '[]', '[]')")
        db.commit()
    # Add a note
    resp = client.post("/notes", json={"entry_id": 1, "note_text": "Test note"})
    assert resp.status_code == 201
    # Check note exists
    with sqlite3.connect(test_db_path) as db:
        cur = db.execute("SELECT * FROM entry_notes WHERE entry_id=1")
        notes = cur.fetchall()
        assert len(notes) == 1
    # Delete the note
    note_id = notes[0][0]
    resp = client.delete(f"/notes/{note_id}")
    assert resp.status_code == 200
    # Delete again (should 404)
    resp = client.delete(f"/notes/{note_id}")
    assert resp.status_code == 404

def test_create_note_missing_fields():
    resp = client.post("/notes", json={"entry_id": 1})
    assert resp.status_code == 422

def test_epoch_from_dt_correct():
    aware = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert _epoch_from_dt(aware) == int(aware.timestamp())

def test_epoch_from_dt_naive():
    from datetime import datetime
    naive = datetime(2025, 1, 1, 0, 0, 0)
    with pytest.raises(ValueError):
        _epoch_from_dt(naive)

def test_time_entries_date_range_edges():
    # Clear tables
    with sqlite3.connect(test_db_path) as db:
        db.execute("DELETE FROM entry_notes")
        db.execute("DELETE FROM time_entries")
        db.commit()
    # Insert entries at various edges
    entries = [
        # entry_id, start_iso, start_ts
        (10, '2025-01-01T00:00:00Z', 1735689600),  # exactly at start
        (11, '2025-01-01T12:00:00Z', 1735732800),  # middle
        (12, '2025-01-02T00:00:00Z', 1735776000),  # exactly at end (should be excluded)
        (13, '2024-12-31T23:59:59Z', 1735689599),  # just before start (should be excluded)
        (14, '2025-01-01T23:59:59Z', 1735775999),  # just before end (should be included)
    ]
    for eid, start_iso, start_ts in entries:
        with sqlite3.connect(test_db_path) as db:
            db.execute(
                "INSERT INTO time_entries (entry_id, description, project_id, project_name, seconds, start, at, start_ts, at_ts, tag_ids, tag_names) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (eid, f"desc{eid}", 1, "proj", 60, start_iso, start_iso, start_ts, start_ts, "[]", "[]")
            )
            db.commit()
    # Query for window: 2025-01-01T00:00:00Z (1735689600) <= start_ts < 2025-01-02T00:00:00Z (1735776000)
    resp = client.get("/time_entries?start_iso=2025-01-01T00:00:00Z&end_iso=2025-01-02T00:00:00Z")
    assert resp.status_code == 200
    ids = [e["entry_id"] for e in resp.json()]
    # Should include 10 (at start), 11 (middle), 14 (just before end), but not 12 (at end) or 13 (before start)
    assert set(ids) == {10, 11, 14}

# --- Tests for Sync Endpoints ---

def test_sync_recent_endpoint(mock_sync_time_entries):
    """Tests the /sync/recent endpoint."""
    response = client.post("/sync/recent")
    assert response.status_code == 200
    json = response.json()
    assert json["ok"] is True
    assert json["records_synced"] == 5
    # Check that our mock was called
    mock_sync_time_entries.assert_called_once()

def test_get_current_entry_endpoint(mock_get_current_entry):
    """Tests the /sync/current endpoint when an entry is running."""
    response = client.get("/sync/current")
    assert response.status_code == 200
    json = response.json()
    assert json["id"] == 12345
    assert json["project_name"] == "API Testing"
    mock_get_current_entry.assert_called_once()

def test_get_current_entry_none(mock_get_no_current_entry):
    """Tests the /sync/current endpoint when no entry is running."""
    response = client.get("/sync/current")
    assert response.status_code == 200
    assert response.json() is None
    mock_get_no_current_entry.assert_called_once() 