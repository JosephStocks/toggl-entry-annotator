import json
import logging
import os
from datetime import UTC, date, datetime
from typing import Any

import httpx
from dotenv import load_dotenv

import cache
from db import create_connection

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TOGGL_TOKEN = os.environ.get("TOGGL_TOKEN")
WORKSPACE_ID = os.environ.get("WORKSPACE_ID")


def _to_utc_iso_and_ts(iso_str: str) -> tuple[str, int]:
    """Return (ISO-8601-UTC, epoch-seconds) from any Toggl ISO string."""
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    dt_utc = dt.astimezone(UTC)
    iso_utc = dt_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return iso_utc, int(dt_utc.timestamp())


def _upsert_sqlite(entry: dict[str, Any]):
    """Insert or update a time entry in the SQLite database."""
    with create_connection() as db:
        db.execute(
            """
            INSERT INTO time_entries (
                entry_id, description, project_id, project_name,
                seconds, start, stop, at,
                start_ts, stop_ts, at_ts,
                tag_ids, tag_names
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(entry_id) DO UPDATE SET
                description = excluded.description,
                project_id  = excluded.project_id,
                project_name= excluded.project_name,
                seconds     = excluded.seconds,
                start       = excluded.start,
                stop        = excluded.stop,
                at          = excluded.at,
                start_ts    = excluded.start_ts,
                stop_ts     = excluded.stop_ts,
                at_ts       = excluded.at_ts,
                tag_ids     = excluded.tag_ids,
                tag_names   = excluded.tag_names;
            """,
            (
                entry["entry_id"],
                entry["description"],
                entry["project_id"],
                entry["project_name"],
                entry["seconds"],
                entry["start_iso"],
                entry.get("stop_iso"),
                entry["at_iso"],
                entry["start_ts"],
                entry.get("stop_ts"),
                entry["at_ts"],
                json.dumps(entry.get("tag_ids", [])),
                json.dumps(entry.get("tag_names", [])),
            ),
        )


def sync_time_entries(start_date: date, end_date: date) -> int:
    """
    Fetches time entries from Toggl detailed report and upserts them into the local DB.

    Args:
        start_date: The inclusive start date for the report.
        end_date: The inclusive end date for the report.

    Returns:
        The number of records synced.
    """
    if not TOGGL_TOKEN or not WORKSPACE_ID:
        raise ValueError("TOGGL_TOKEN and WORKSPACE_ID must be set in .env file")

    url = f"https://api.track.toggl.com/reports/api/v3/workspace/{WORKSPACE_ID}/search/time_entries"
    auth = (TOGGL_TOKEN, "api_token")
    payload = {
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "page_size": 100,
        "enrich_response": True,
        "grouped": True,
    }

    records_synced = 0
    with httpx.Client(auth=auth, timeout=30) as client:
        while True:
            logger.info(
                f"Requesting Toggl data with payload: {json.dumps(payload, indent=2)}"
            )
            resp = client.post(url, json=payload)
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                logger.error(f"Toggl API request failed: {exc}")
                logger.error(f"Response text: {exc.response.text}")
                raise exc

            rows = resp.json()

            if not rows:
                break

            for row in rows:
                # time_entries now holds 1-N actual entries for this meta combo
                for time_entry in row["time_entries"]:
                    records_synced += 1

                    start_iso, start_ts = _to_utc_iso_and_ts(time_entry["start"])
                    stop_iso, stop_ts = (None, None)
                    if time_entry["stop"]:
                        stop_iso, stop_ts = _to_utc_iso_and_ts(time_entry["stop"])
                    at_iso, at_ts = _to_utc_iso_and_ts(time_entry["at"])

                    flat_entry = {
                        "project_id": row["project_id"],
                        "project_name": row.get("project_name"),
                        "description": row["description"],
                        "tag_ids": row.get("tag_ids", []),
                        "tag_names": row.get("tag_names", []),
                        "entry_id": time_entry["id"],
                        "start_iso": start_iso,
                        "stop_iso": stop_iso,
                        "seconds": time_entry["seconds"],
                        "at_iso": at_iso,
                        "start_ts": start_ts,
                        "stop_ts": stop_ts,
                        "at_ts": at_ts,
                    }
                    _upsert_sqlite(flat_entry)

            # Pagination
            nxt = resp.headers.get("X-Next-ID")
            if not nxt:
                break
            payload["first_id"] = int(nxt)
    return records_synced


def get_current_running_entry() -> dict[str, Any] | None:
    """
    Fetches the currently running time entry from Toggl API v9.
    """
    if not TOGGL_TOKEN:
        raise ValueError("TOGGL_TOKEN must be set in .env file")

    url = "https://api.track.toggl.com/api/v9/me/time_entries/current"
    auth = (TOGGL_TOKEN, "api_token")

    with httpx.Client(auth=auth, timeout=10) as client:
        resp = client.get(url)
        resp.raise_for_status()
        entry = resp.json()

        if not entry:
            return None

        # The 'current' endpoint only returns a project_id, not a name.
        # We use our cache to look up the name.
        if "project_id" in entry and entry["project_id"] is not None:
            entry["project_name"] = cache.get_project_name(entry["project_id"])
        else:
            entry["project_name"] = "No Project"

        return entry
