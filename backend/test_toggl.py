import json
from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from httpx import HTTPStatusError, Request, Response

from backend import toggl

# A mock response from the Toggl v3 Detailed Reports API
MOCK_REPORTS_RESPONSE = [
    {
        "project_id": 201,
        "project_name": "API Refactor",
        "description": "Writing tests",
        "tag_ids": [301],
        "tag_names": ["testing"],
        "time_entries": [
            {
                "id": 1001,
                "start": "2025-07-21T14:00:00+00:00",
                "stop": "2025-07-21T15:00:00+00:00",
                "seconds": 3600,
                "at": "2025-07-21T15:00:00+00:00",
            }
        ],
    },
    {
        "project_id": 202,
        "project_name": "Documentation",
        "description": "Updating README",
        "tag_ids": [],
        "tag_names": [],
        "time_entries": [
            {
                "id": 1002,
                "start": "2025-07-21T16:30:00-05:00",  # A non-UTC timezone
                "stop": None,  # A running timer
                "seconds": -1,  # duration is negative
                "at": "2025-07-21T16:30:00-05:00",
            }
        ],
    },
]


@pytest.fixture
def mock_env_vars():
    """Set the necessary environment variables for toggl functions."""
    with patch.dict("os.environ", {"TOGGL_TOKEN": "fake-token", "WORKSPACE_ID": "fake-workspace"}):
        yield


@pytest.fixture
def mock_create_connection():
    """Mocks the database connection to avoid actual DB writes."""
    with patch("backend.toggl.create_connection") as mock:
        # Create a mock connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_conn.__enter__.return_value = mock_conn  # For `with` statement
        mock.return_value = mock_conn
        yield mock_conn


@pytest.mark.parametrize(
    "input_iso, expected_utc_iso, expected_ts",
    [
        ("2025-01-01T12:00:00Z", "2025-01-01T12:00:00Z", 1735732800),
        ("2025-01-01T12:00:00+00:00", "2025-01-01T12:00:00Z", 1735732800),
        ("2025-01-01T07:00:00-05:00", "2025-01-01T12:00:00Z", 1735732800),  # EST to UTC
    ],
)
def test_to_utc_iso_and_ts(input_iso, expected_utc_iso, expected_ts):
    """
    Test the timezone conversion helper with various formats.
    """
    iso_utc, ts = toggl._to_utc_iso_and_ts(input_iso)
    assert iso_utc == expected_utc_iso
    assert ts == expected_ts


def test_upsert_sqlite(mock_create_connection):
    """
    Test that _upsert_sqlite builds and executes the correct SQL query.
    """
    entry = {
        "entry_id": 1001,
        "description": "Test Entry",
        "project_id": 201,
        "project_name": "Test Project",
        "seconds": 3600,
        "start_iso": "2025-01-01T12:00:00Z",
        "stop_iso": "2025-01-01T13:00:00Z",
        "at_iso": "2025-01-01T13:00:00Z",
        "start_ts": 1735732800,
        "stop_ts": 1735736400,
        "at_ts": 1735736400,
        "tag_ids": [301],
        "tag_names": ["testing"],
    }

    toggl._upsert_sqlite(entry)

    mock_db = mock_create_connection
    # Check that a connection was made and a query was executed
    assert mock_db.execute.call_count == 1

    # Check the arguments passed to execute
    args = mock_db.execute.call_args[0]
    sql_query = " ".join(str(args[0]).split())  # Normalize whitespace for comparison
    params = args[1]

    assert "INSERT INTO time_entries" in sql_query
    assert "ON CONFLICT(entry_id) DO UPDATE" in sql_query
    assert params[0] == entry["entry_id"]
    assert params[1] == entry["description"]
    assert params[11] == json.dumps(entry["tag_ids"])
    assert params[12] == json.dumps(entry["tag_names"])


@patch("httpx.Client")
def test_sync_time_entries_single_page(mock_httpx_class, mock_env_vars, mock_create_connection):
    """
    Test a successful sync with a single page of results.
    """
    # Configure the mock httpx client
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    request = Request("POST", "http://fake-url")
    mock_client.post.return_value = Response(200, json=MOCK_REPORTS_RESPONSE, request=request)
    mock_httpx_class.return_value = mock_client

    # Act
    count = toggl.sync_time_entries(date(2025, 7, 21), date(2025, 7, 21))

    # Assert
    assert count == 2  # Two time entries were in the mock response
    # Verify that the DB upsert function was called for each entry
    assert mock_create_connection.execute.call_count == 2


@patch("httpx.Client")
def test_sync_time_entries_pagination(mock_httpx_class, mock_env_vars, mock_create_connection):
    """
    Test that the sync function correctly handles pagination via the X-Next-ID header.
    """
    # Configure two responses for pagination
    request = Request("POST", "http://fake-url")
    response1 = Response(
        200, json=MOCK_REPORTS_RESPONSE, headers={"X-Next-ID": "1003"}, request=request
    )
    response2 = Response(200, json=[MOCK_REPORTS_RESPONSE[0]], request=request)

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.side_effect = [response1, response2]
    mock_httpx_class.return_value = mock_client

    # Act
    count = toggl.sync_time_entries(date(2025, 7, 21), date(2025, 7, 21))

    # Assert
    assert count == 3  # 2 from first page, 1 from second
    assert mock_client.post.call_count == 2

    # Check that the second call included the `first_id` parameter
    second_call_payload = mock_client.post.call_args_list[1].kwargs["json"]
    assert second_call_payload["first_id"] == 1003


@patch("httpx.Client")
def test_sync_time_entries_api_error(mock_httpx_class, mock_env_vars):
    """
    Test that an HTTP error from the Toggl API is correctly raised.
    """
    # Configure a mock error response
    mock_response = Response(
        status_code=403, request=Request("POST", "http://fake-url"), text="Invalid API token"
    )

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.return_value = mock_response
    mock_httpx_class.return_value = mock_client

    with pytest.raises(HTTPStatusError):
        toggl.sync_time_entries(date(2025, 7, 21), date(2025, 7, 21))


@patch("backend.cache.get_project_name", return_value="Cached Project Name")
@patch("httpx.Client")
def test_get_current_running_entry(mock_httpx_class, mock_get_project_name, mock_env_vars):
    """
    Test fetching a currently running entry.
    """
    mock_current_entry = {"id": 123, "project_id": 987, "description": "Doing work"}
    mock_response = Response(
        200, json=mock_current_entry, request=Request("GET", "http://fake-url")
    )

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.get.return_value = mock_response
    mock_httpx_class.return_value = mock_client

    entry = toggl.get_current_running_entry()

    assert entry is not None
    assert entry["id"] == 123
    # Verify that the project name was fetched from the cache
    mock_get_project_name.assert_called_once_with(987)
    assert entry["project_name"] == "Cached Project Name"


@patch("httpx.Client")
def test_get_current_running_entry_none(mock_httpx_class, mock_env_vars):
    """
    Test the case where no time entry is currently running.
    """
    mock_response = Response(
        200, content="null", request=Request("GET", "http://fake-url")
    )  # Toggl API returns null

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.get.return_value = mock_response
    mock_httpx_class.return_value = mock_client

    entry = toggl.get_current_running_entry()

    assert entry is None


@patch("httpx.Client")
def test_sync_time_entries_no_results(mock_httpx_class, mock_env_vars, mock_create_connection):
    """
    Test a successful sync where the Toggl API returns an empty list.
    """
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    request = Request("POST", "http://fake-url")
    # The API returns an empty JSON array
    mock_client.post.return_value = Response(200, json=[], request=request)
    mock_httpx_class.return_value = mock_client

    count = toggl.sync_time_entries(date(2025, 7, 21), date(2025, 7, 21))

    assert count == 0  # Should sync 0 records
    mock_client.post.assert_called_once()  # Should only make one API call
    mock_create_connection.execute.assert_not_called()  # Should not touch the DB


@patch("backend.cache.get_project_name")  # We don't expect this to be called
@patch("httpx.Client")
def test_get_current_running_entry_no_project(
    mock_httpx_class, mock_get_project_name, mock_env_vars
):
    """
    Test fetching a currently running entry that has no project_id.
    """
    # This entry is missing the 'project_id' key
    mock_current_entry = {"id": 456, "description": "Thinking about lunch"}
    mock_response = Response(
        200, json=mock_current_entry, request=Request("GET", "http://fake-url")
    )

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.get.return_value = mock_response
    mock_httpx_class.return_value = mock_client

    entry = toggl.get_current_running_entry()

    assert entry is not None
    assert entry["id"] == 456
    assert entry["project_name"] == "No Project"
    # Ensure the cache was NOT used
    mock_get_project_name.assert_not_called()
