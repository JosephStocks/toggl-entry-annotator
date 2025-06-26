# %%
# ruff: noqa
import json
import os
import sys
from pathlib import Path

# Add project root to path so `db` module can be imported
project_root = Path(__file__).resolve().parents[2]
sys.path.append(str(project_root))

import httpx
from backend.db import create_connection
from backend.schema import init_database
from dotenv import load_dotenv

load_dotenv()

# Uncomment project_color & project_hex to include them in each time entry

init_database()

# %%

from datetime import UTC, date, datetime, timedelta


def to_utc_iso_and_ts(iso_str: str) -> tuple[str, int]:
    """Return (ISO-8601-UTC, epoch-seconds) from any Toggl ISO string."""
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    dt_utc = dt.astimezone(UTC)
    iso_utc = dt_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return iso_utc, int(dt_utc.timestamp())


def upsert_sqlite(entry):
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
                entry["start_iso"],  # already UTC
                entry.get("stop_iso"),
                entry["at_iso"],
                entry["start_ts"],
                entry.get("stop_ts"),
                entry["at_ts"],
                json.dumps(entry.get("tag_ids", [])),
                json.dumps(entry.get("tag_names", [])),
            ),
        )


# %%
url = f"https://api.track.toggl.com/reports/api/v3/workspace/{os.environ['WORKSPACE_ID']}/search/time_entries"
auth = (os.environ["TOGGL_TOKEN"], "api_token")

tomorrow = date.today() + timedelta(days=1)
payload = {
    "start_date": "2025-01-01",
    "end_date": tomorrow.strftime("%Y-%m-%d"),
    "page_size": 100,
    "enrich_response": True,
    "grouped": True,
}
data = httpx.post(url, json=payload, auth=auth).json()

records = 0
while True:
    resp = httpx.post(url, json=payload, auth=auth, timeout=30)
    resp.raise_for_status()  # fail fast on errors
    rows = resp.json()

    for row in rows:
        meta = {
            "project_id": row["project_id"],
            "project_name": row.get("project_name"),
            # "project_color": row["project_color"],
            # "project_hex":   row["project_hex"],
            "description": row["description"],
            "tag_ids": row.get("tag_ids", []),
            "tag_names": row.get("tag_names", []),
        }

        # time_entries now holds 1-N actual entries for this meta combo
        for time_entry in row["time_entries"]:
            records += 1

            # during the loop …
            start_iso, start_ts = to_utc_iso_and_ts(time_entry["start"])
            stop_iso, stop_ts = (None, None)
            if time_entry["stop"]:
                stop_iso, stop_ts = to_utc_iso_and_ts(time_entry["stop"])
            at_iso, at_ts = to_utc_iso_and_ts(time_entry["at"])

            flat = {
                **meta,
                "entry_id": time_entry["id"],
                "start_iso": start_iso,
                "stop_iso": stop_iso,
                "seconds": time_entry["seconds"],
                "at_iso": at_iso,
                "start_ts": start_ts,
                "stop_ts": stop_ts,
                "at_ts": at_ts,
            }
            upsert_sqlite(flat)

    # pagination – move to next page if the header is present
    nxt = resp.headers.get("X-Next-ID")
    if not nxt:
        break
    payload["first_id"] = nxt

print(f"{records=}")
print(f"{tomorrow=}")
