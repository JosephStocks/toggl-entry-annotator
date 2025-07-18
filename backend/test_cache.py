from unittest.mock import MagicMock, patch

import pytest
from httpx import Request, Response

from backend import cache

# A mock response from the Toggl v9 /me endpoint
MOCK_ME_RESPONSE = {
    "projects": [
        {"id": 101, "name": "Project Alpha"},
        {"id": 102, "name": "Project Beta"},
        # A project with missing keys to test resilience
        {"id": 103},
        {"name": "Project Gamma"},
    ],
    "workspaces": [{"id": 12345, "name": "My Workspace"}],
    # other /me data...
}


@pytest.fixture(autouse=True)
def mock_httpx_client():
    """Auto-mock httpx.Client for all tests in this file."""
    with patch("httpx.Client") as mock_client_class:
        # Create a mock instance
        mock_client_instance = MagicMock()

        # Mock the __enter__ and __exit__ methods for the `with` statement
        mock_client_instance.__enter__.return_value = mock_client_instance
        mock_client_instance.__exit__.return_value = None

        # Configure the GET request to return a mock response
        mock_response = Response(
            200, json=MOCK_ME_RESPONSE, request=Request("GET", "http://fake-url")
        )
        mock_client_instance.get.return_value = mock_response

        # Make the class return our configured instance
        mock_client_class.return_value = mock_client_instance
        yield mock_client_class


@pytest.fixture
def mock_env_vars():
    """Set the necessary environment variables for the cache functions."""
    with patch.dict("os.environ", {"TOGGL_TOKEN": "fake-token", "WORKSPACE_ID": "fake-workspace"}):
        yield


@pytest.fixture(autouse=True)
def clear_cache():
    """Ensure the in-memory cache is cleared before each test."""
    cache._project_cache = None


def test_fetch_all_projects(mock_env_vars, mock_httpx_client):
    """
    Test that _fetch_all_projects correctly calls the Toggl API and parses the response.
    """
    # Act
    projects = cache._fetch_all_projects()

    # Assert
    # 1. Check that the HTTP client was used correctly
    mock_httpx_client.return_value.get.assert_called_once_with(
        "https://api.track.toggl.com/api/v9/me?with_related_data=true"
    )

    # 2. Check that the parsing is correct and resilient to malformed data
    assert projects == {101: "Project Alpha", 102: "Project Beta"}


def test_fetch_all_projects_missing_env_vars():
    """
    Test that _fetch_all_projects raises a ValueError if credentials are not set.
    """
    # Combine all context managers into a single `with` statement.
    with (
        patch("backend.cache.TOGGL_TOKEN", None),
        patch("backend.cache.WORKSPACE_ID", None),
        pytest.raises(ValueError, match="TOGGL_TOKEN and WORKSPACE_ID must be set."),
    ):
        cache._fetch_all_projects()


def test_get_project_name_cold_cache(mock_env_vars, mock_httpx_client):
    """
    Test that get_project_name populates the cache on the first call.
    """
    assert cache._project_cache is None  # Verify cache is initially cold

    # Act
    project_name = cache.get_project_name(101)

    # Assert
    assert project_name == "Project Alpha"
    assert cache._project_cache is not None  # Cache should now be warm
    # Verify the API was called
    mock_httpx_client.return_value.get.assert_called_once()


def test_get_project_name_warm_cache(mock_env_vars, mock_httpx_client):
    """
    Test that get_project_name uses the existing cache and does not make a network call.
    """
    # Pre-populate the cache to simulate a "warm" state
    cache._project_cache = {101: "Cached Project Alpha", 202: "Cached Project Beta"}

    # Act
    project_name = cache.get_project_name(202)

    # Assert
    assert project_name == "Cached Project Beta"
    # Verify the API was NOT called
    mock_httpx_client.return_value.get.assert_not_called()


def test_get_project_name_unknown_project(mock_env_vars):
    """
    Test that get_project_name returns a default value for an unknown project ID.
    """
    # Pre-populate the cache
    cache._project_cache = {101: "Project Alpha"}

    # Act
    project_name = cache.get_project_name(999)  # An ID not in the cache

    # Assert
    assert project_name == "Unknown Project"
