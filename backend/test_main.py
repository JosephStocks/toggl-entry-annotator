import os
from datetime import UTC, date, datetime
from unittest.mock import call, patch

import pytest
from fastapi.testclient import TestClient

# Mock environment variables for middleware before it's imported
# These are only needed for the middleware tests
os.environ["CF_ACCESS_CLIENT_ID"] = "test_id"
os.environ["CF_ACCESS_CLIENT_SECRET"] = "test_secret"
os.environ["CF_CHECK"] = "false"

# The app can now be imported safely
from backend.main import app, get_db

# This client is for tests that DON'T touch the database. It is fast and simple.
simple_client = TestClient(app)


@pytest.fixture
def client(test_db):
    """
    Provides a TestClient with the database dependency overridden.
    All API calls in a test using this fixture will use the same, single,
    managed test database connection from the `test_db` fixture.
    """

    # This override function will be used by FastAPI instead of the real `get_db`.
    def override_get_db():
        try:
            # Yield the connection from our managed `test_db` fixture
            yield test_db
        finally:
            # The test_db fixture is responsible for closing the connection.
            pass

    # Apply the override. This is the magic of FastAPI testing.
    app.dependency_overrides[get_db] = override_get_db

    # Yield the pre-configured TestClient for the test to use
    yield TestClient(app)

    # Clean up the override after the test is done
    app.dependency_overrides.clear()


# --- Mocks for Toggl API calls ---
@pytest.fixture
def mock_sync_time_entries(mocker):
    """Mocks the toggl.sync_time_entries function."""
    return mocker.patch("backend.main.toggl.sync_time_entries", return_value=5)


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
    return mocker.patch("backend.main.toggl.get_current_running_entry", return_value=mock_data)


@pytest.fixture
def mock_get_no_current_entry(mocker):
    """Mocks the toggl.get_current_running_entry to return None."""
    return mocker.patch("backend.main.toggl.get_current_running_entry", return_value=None)


# ===================================================================
# SECTION 1: Tests that DO NOT require a database connection
# (Pure logic or fully mocked endpoints)
# ===================================================================


def test_epoch_from_dt_correct():
    # This test is moved out of the main test file because it doesn't need the app
    from backend.main import _epoch_from_dt

    aware = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
    assert _epoch_from_dt(aware) == int(aware.timestamp())


def test_epoch_from_dt_naive():
    # This test is moved out of the main test file because it doesn't need the app
    from backend.main import _epoch_from_dt

    naive = datetime(2025, 1, 1, 0, 0, 0)
    with pytest.raises(ValueError):
        _epoch_from_dt(naive)


def test_sync_recent_endpoint(mock_sync_time_entries):
    response = simple_client.post("/sync/recent")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_get_current_entry_endpoint(mock_get_current_entry):
    response = simple_client.get("/sync/current")
    assert response.status_code == 200
    assert response.json()["id"] == 12345


def test_get_current_entry_none(mock_get_no_current_entry):
    response = simple_client.get("/sync/current")
    assert response.status_code == 200
    assert response.json() is None


@patch("backend.main.date")
def test_sync_full_endpoint_chunks_requests(mock_date, mock_sync_time_entries):
    mock_date.today.return_value = date(2025, 6, 17)
    with patch.dict(os.environ, {"SYNC_START_DATE": "2023-01-15"}):
        response = simple_client.post("/sync/full")
    assert response.status_code == 200
    expected_calls = [
        call(date(2023, 1, 15), date(2024, 1, 14)),
        call(date(2024, 1, 15), date(2025, 1, 13)),
        call(date(2025, 1, 14), date(2025, 6, 17)),
    ]
    mock_sync_time_entries.assert_has_calls(expected_calls)


# ===================================================================
# SECTION 2: Tests that DO require an isolated database
# (These all use the overridden `client` fixture)
# ===================================================================


def test_get_time_entries_invalid_range(client):
    resp = client.get("/time_entries?start_iso=2025-01-02T00:00:00Z&end_iso=2025-01-01T00:00:00Z")
    assert resp.status_code == 400


def test_create_note_missing_fields(client):
    resp = client.post("/notes", json={"entry_id": 1})
    assert resp.status_code == 422


def test_get_time_entries_empty(client):
    resp = client.get("/time_entries?start_iso=2025-01-01T00:00:00Z&end_iso=2025-01-02T00:00:00Z")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_and_delete_note(client, test_db):
    # Use `test_db` to directly set up the database state
    conn = test_db
    conn.execute(
        "INSERT INTO time_entries (entry_id, description, project_id, project_name, seconds, start, at, start_ts, at_ts) VALUES (1, 'desc', 1, 'proj', 60, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 1, 1)"
    )
    conn.commit()

    # Use `client` to test the API endpoint
    resp_create = client.post("/notes", json={"entry_id": 1, "note_text": "Test note"})
    assert resp_create.status_code == 201

    # Verify the result in the database directly
    cur = conn.execute("SELECT id FROM entry_notes WHERE entry_id=1")
    note_id = cur.fetchone()[0]
    assert note_id is not None

    # Test the delete endpoint
    resp_delete = client.delete(f"/notes/{note_id}")
    assert resp_delete.status_code == 200

    # Test deleting a non-existent note
    resp_delete_again = client.delete(f"/notes/{note_id}")
    assert resp_delete_again.status_code == 404


def test_time_entries_date_range_edges(client, test_db):
    conn = test_db
    entries = [
        (10, "2025-01-01T00:00:00Z", 1735689600),
        (11, "2025-01-01T12:00:00Z", 1735732800),
        (12, "2025-01-02T00:00:00Z", 1735776000),
        (13, "2024-12-31T23:59:59Z", 1735689599),
        (14, "2025-01-01T23:59:59Z", 1735775999),
    ]
    for eid, start_iso, start_ts in entries:
        conn.execute(
            "INSERT INTO time_entries (entry_id, description, project_id, project_name, seconds, start, at, start_ts, at_ts, tag_ids, tag_names) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                eid,
                f"desc{eid}",
                1,
                "proj",
                60,
                start_iso,
                start_iso,
                start_ts,
                start_ts,
                "[]",
                "[]",
            ),
        )
    conn.commit()
    resp = client.get("/time_entries?start_iso=2025-01-01T00:00:00Z&end_iso=2025-01-02T00:00:00Z")
    assert resp.status_code == 200
    ids = {e["entry_id"] for e in resp.json()}
    assert ids == {10, 11, 14}


def test_get_daily_note_not_found(client):
    resp = client.get("/daily_notes/2025-01-15")
    assert resp.status_code == 200
    assert resp.json() is None


def test_create_daily_note(client):
    note_content = "# Daily Notes\n\nThis is my first daily note."
    resp = client.put("/daily_notes/2025-01-15", json={"note_content": note_content})
    assert resp.status_code == 200
    data = resp.json()
    assert data["date"] == "2025-01-15"
    assert data["note_content"] == note_content


def test_get_existing_daily_note(client):
    note_content = "# Test Note\n\nSome content here."
    client.put("/daily_notes/2025-01-16", json={"note_content": note_content})
    resp = client.get("/daily_notes/2025-01-16")
    assert resp.status_code == 200
    data = resp.json()
    assert data["date"] == "2025-01-16"
    assert data["note_content"] == note_content


def test_update_daily_note(client):
    resp1 = client.put("/daily_notes/2025-01-17", json={"note_content": "Initial content"})
    data1 = resp1.json()
    updated_content = "Updated content\n\nWith more details."
    resp2 = client.put("/daily_notes/2025-01-17", json={"note_content": updated_content})
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["note_content"] == updated_content
    assert data2["id"] == data1["id"]
    assert data2["created_at"] == data1["created_at"]
    assert data2["updated_at"] != data1["updated_at"]


def test_daily_note_empty_content(client):
    resp = client.put("/daily_notes/2025-01-18", json={"note_content": ""})
    assert resp.status_code == 200
    assert resp.json()["note_content"] == ""


def test_daily_note_large_content(client):
    large_content = "# Large Document\n\n" + ("This is a paragraph. " * 100 + "\n\n") * 10
    resp = client.put("/daily_notes/2025-01-19", json={"note_content": large_content})
    assert resp.status_code == 200
    assert resp.json()["note_content"] == large_content


def test_daily_note_special_characters(client):
    special_content = """# Special *Characters* Test\n\n- **Bold text**"""
    resp = client.put("/daily_notes/2025-01-20", json={"note_content": special_content})
    assert resp.status_code == 200
    assert resp.json()["note_content"] == special_content


def test_daily_note_date_formats(client):
    resp = client.put("/daily_notes/2025-12-31", json={"note_content": "End of year"})
    assert resp.status_code == 200


def test_multiple_daily_notes(client):
    notes = {
        "2025-02-01": "February 1st notes",
        "2025-02-02": "February 2nd notes",
    }
    for date_str, content in notes.items():
        resp = client.put(f"/daily_notes/{date_str}", json={"note_content": content})
        assert resp.status_code == 200
    for date_str, expected_content in notes.items():
        resp = client.get(f"/daily_notes/{date_str}")
        assert resp.json()["note_content"] == expected_content


def test_daily_note_concurrent_updates(client):
    date_str = "2025-03-01"
    client.put(f"/daily_notes/{date_str}", json={"note_content": "Version 1"})
    for i in range(2, 5):
        client.put(f"/daily_notes/{date_str}", json={"note_content": f"Version {i}"})
    resp = client.get(f"/daily_notes/{date_str}")
    assert resp.json()["note_content"] == "Version 4"


def test_daily_note_isolation_between_dates(client):
    client.put("/daily_notes/2025-04-01", json={"note_content": "April 1st"})
    client.put("/daily_notes/2025-04-02", json={"note_content": "April 2nd"})
    client.put("/daily_notes/2025-04-01", json={"note_content": "April 1st UPDATED"})
    resp = client.get("/daily_notes/2025-04-02")
    assert resp.json()["note_content"] == "April 2nd"


# --- Middleware tests (no DB access, they are mocked) ---


@pytest.fixture
def cf_check_enabled():
    with patch.dict(os.environ, {"CF_CHECK": "true"}):
        yield


@pytest.mark.skip(reason="Temporarily disabled until Cloudflare secrets are configured in prod/CI")
def test_middleware_blocks_unauthenticated(cf_check_enabled):
    # Assume "/sync/full" is a protected path in your middleware config for this test
    # 1. Test with no headers
    response = simple_client.post("/sync/full")
    assert response.status_code == 401
    assert "Missing CF service-token headers" in response.json()["detail"]

    # 2. Test with invalid headers
    headers = {
        "Cf-Access-Client-Id": "wrong_id",
        "Cf-Access-Client-Secret": "wrong_secret",
    }
    response = simple_client.post("/sync/full", headers=headers)
    assert response.status_code == 403
    assert "Invalid service token" in response.json()["detail"]


def test_middleware_allows_authenticated(cf_check_enabled, mock_sync_time_entries):
    headers = {
        "Cf-Access-Client-Id": "test_id",
        "Cf-Access-Client-Secret": "test_secret",
    }
    response = simple_client.post("/sync/full", headers=headers)
    assert response.status_code == 200
