import os
from datetime import UTC, date, datetime
from unittest.mock import call, patch

import pytest
from fastapi.testclient import TestClient

import db
from main import _epoch_from_dt, app
from schema import init_database

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
    # Use a test-specific DB path
    db.DB_PATH = test_db_path
    # Create tables in the test DB using the centralized schema
    init_database()

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
    with db.create_connection() as conn:
        conn.execute("INSERT INTO time_entries (entry_id, description, project_id, project_name, seconds, start, at, start_ts, at_ts, tag_ids, tag_names) VALUES (1, 'desc', 1, 'proj', 60, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 1, 1, '[]', '[]')")
        conn.commit()
    # Add a note
    resp = client.post("/notes", json={"entry_id": 1, "note_text": "Test note"})
    assert resp.status_code == 201
    # Check note exists
    with db.create_connection() as conn:
        cur = conn.execute("SELECT * FROM entry_notes WHERE entry_id=1")
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
    aware = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
    assert _epoch_from_dt(aware) == int(aware.timestamp())

def test_epoch_from_dt_naive():
    from datetime import datetime
    naive = datetime(2025, 1, 1, 0, 0, 0)
    with pytest.raises(ValueError):
        _epoch_from_dt(naive)

def test_time_entries_date_range_edges():
    # Clear tables
    with db.create_connection() as conn:
        conn.execute("DELETE FROM entry_notes")
        conn.execute("DELETE FROM time_entries")
        conn.commit()
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
        with db.create_connection() as conn:
            conn.execute(
                "INSERT INTO time_entries (entry_id, description, project_id, project_name, seconds, start, at, start_ts, at_ts, tag_ids, tag_names) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (eid, f"desc{eid}", 1, "proj", 60, start_iso, start_iso, start_ts, start_ts, "[]", "[]")
            )
            conn.commit()
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

@patch("main.date")
def test_sync_full_endpoint_chunks_requests(mock_date, mock_sync_time_entries):
    """
    Tests that the /sync/full endpoint correctly chunks requests by year.
    """
    # Freeze time to a known date
    mock_date.today.return_value = date(2025, 6, 17)

    # Mock the environment variable for start date
    with patch.dict(os.environ, {"SYNC_START_DATE": "2023-01-15"}):
        response = client.post("/sync/full")

    assert response.status_code == 200
    json_data = response.json()
    assert json_data["ok"] is True
    # mock returns 5, so 3 calls should be 15
    assert json_data["records_synced"] == 15

    # Check that our mock was called with the correct date ranges
    expected_calls = [
        # 1. From start date to +364 days (2023 is not a leap year)
        call(date(2023, 1, 15), date(2024, 1, 14)),
        # 2. From the next day to +364 days (2024 IS a leap year)
        call(date(2024, 1, 15), date(2025, 1, 13)),
        # 3. From the next day to the mocked "today"
        call(date(2025, 1, 14), date(2025, 6, 17)),
    ]
    mock_sync_time_entries.assert_has_calls(expected_calls)
    assert mock_sync_time_entries.call_count == len(expected_calls)
