import httpx
import os
from typing import Dict, List, Any, Optional

from dotenv import load_dotenv

load_dotenv()

TOGGL_TOKEN = os.environ.get("TOGGL_TOKEN")
WORKSPACE_ID = os.environ.get("WORKSPACE_ID")

# Simple in-memory cache for projects
_project_cache: Optional[Dict[int, str]] = None


def _fetch_all_projects() -> Dict[int, str]:
    """
    Fetches all projects for the workspace and returns a mapping of
    project_id -> project_name.
    """
    if not TOGGL_TOKEN or not WORKSPACE_ID:
        raise ValueError("TOGGL_TOKEN and WORKSPACE_ID must be set.")

    # v9/me?with_related_data=true is the most efficient way to get all projects
    url = "https://api.track.toggl.com/api/v9/me?with_related_data=true"
    auth = (TOGGL_TOKEN, "api_token")
    
    with httpx.Client(auth=auth, timeout=10) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()

    # The projects are in the 'projects' key of the response
    projects: List[Dict[str, Any]] = data.get("projects", [])
    
    # Create a simple {id: name} mapping
    return {p["id"]: p["name"] for p in projects if "id" in p and "name" in p}


def get_project_name(project_id: int) -> str:
    """
    Gets a project name from the cache. If the cache is cold, it populates it first.
    """
    global _project_cache
    if _project_cache is None:
        _project_cache = _fetch_all_projects()

    return _project_cache.get(project_id, "Unknown Project") 