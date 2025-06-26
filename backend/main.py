import json
import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import toggl
from db import get_db
from middleware import CloudflareServiceTokenMiddleware
from schema import init_database

# -------------------------------------------------
# Config
# -------------------------------------------------
# DB_PATH is now in db.py

# Read CORS origins from environment variable
# The env var should be a comma-separated string of URLs
# e.g., "http://localhost:5173,https://your-frontend-domain.netlify.app"
origins_str = os.environ.get("CORS_ORIGINS", "http://localhost:5173")
allowed_origins = [origin.strip() for origin in origins_str.split(",")]

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run database initialization on startup."""
    logger.info("Running startup tasks...")
    init_database()
    logger.info("Startup tasks complete.")
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(CloudflareServiceTokenMiddleware)


# -------------------------------------------------
# Pydantic models
# -------------------------------------------------
class Note(BaseModel):
    id: int
    note_text: str
    created_at: str


class TimeEntryWithNotes(BaseModel):
    entry_id: int
    description: str
    project_id: int
    project_name: str
    seconds: int
    start: str  # ISO-8601 Z
    stop: str | None
    start_ts: int  # epoch UTC
    stop_ts: int | None
    tag_ids: str
    tag_names: str
    at: str
    at_ts: int
    notes: list[Note] = []


class NoteCreate(BaseModel):
    entry_id: int
    note_text: str


class SyncResult(BaseModel):
    ok: bool
    records_synced: int
    message: str


# -------------------------------------------------
# Helpers
# -------------------------------------------------


def _epoch_from_dt(dt: datetime) -> int:
    """
    Snap any timezone-aware datetime to an *integer* Unix epoch (floor to second).
    Raises if dt is naive.
    """
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError("Datetime must be timezone-aware (RFC3339/ISO-8601)")
    return int(dt.timestamp())  # floor => second precision


# -------------------------------------------------
# Sync Routes
# -------------------------------------------------


@app.post("/sync/full", response_model=SyncResult, summary="Run a full sync from Toggl")
def sync_full():
    """
    Fetches all time entries from the Toggl Detailed Reports API from the beginning
    of time until today and upserts them into the local database.

    Data is fetched in yearly chunks to respect the Toggl API's 366-day limit.
    The start date can be configured with the SYNC_START_DATE env var (YYYY-MM-DD).
    """
    try:
        total_synced_count = 0
        start_date_str = os.environ.get("SYNC_START_DATE", "2006-01-01")
        try:
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        except ValueError:
            logger.warning(
                f"Invalid SYNC_START_DATE format: '{start_date_str}'. "
                "Please use YYYY-MM-DD. Defaulting to 2006-01-01."
            )
            start_date = date(2006, 1, 1)

        end_date_of_sync = date.today()

        current_start = start_date
        while current_start <= end_date_of_sync:
            current_end = current_start + timedelta(days=364)  # 365 days inclusive
            if current_end > end_date_of_sync:
                current_end = end_date_of_sync

            logger.info(f"Syncing Toggl data from {current_start} to {current_end}")
            count = toggl.sync_time_entries(current_start, current_end)
            total_synced_count += count

            # Move to the next chunk
            current_start = current_end + timedelta(days=1)

        return {
            "ok": True,
            "records_synced": total_synced_count,
            "message": f"Full sync completed. Synced {total_synced_count} records.",
        }
    except Exception as e:
        logger.error(f"Full sync failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/sync/recent", response_model=SyncResult, summary="Run a sync for recent entries")
def sync_recent():
    """
    Fetches time entries from the last 2 days to capture recent changes and
    additions. This is much faster than a full sync.
    """
    try:
        end_date = date.today()
        start_date = end_date - timedelta(days=2)
        count = toggl.sync_time_entries(start_date, end_date)
        return {
            "ok": True,
            "records_synced": count,
            "message": f"Recent sync completed. Synced {count} records.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get(
    "/sync/current",
    summary="Get the current running time entry",
    description="Fetches the single currently running time entry from Toggl, if one exists.",
)
def get_current_entry():
    """
    Note: The detailed report *excludes* the current entry. This endpoint is the
    only way to get it. The result is returned directly from the Toggl API v9
    and is not stored in the database. Returns null if no entry is running.
    """
    try:
        entry = toggl.get_current_running_entry()
        return entry
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# -------------------------------------------------
# Routes
# -------------------------------------------------


@app.get("/projects", response_model=list[str], summary="Get all unique project names")
def get_projects(conn: sqlite3.Connection = Depends(get_db)):  # noqa: B008
    """
    Returns a list of all unique project names from the time_entries table.
    """
    conn.row_factory = lambda cursor, row: row[0]  # Return just the first column
    cur = conn.cursor()
    projects = cur.execute(
        "SELECT DISTINCT project_name FROM time_entries WHERE project_name IS NOT NULL ORDER BY project_name"
    ).fetchall()
    return projects


@app.get(
    "/time_entries",
    response_model=list[TimeEntryWithNotes],
    summary="Get time entries within a UTC datetime window",
    description="""
Returns all time entries whose `start_ts` falls within the given UTC time window.

- `start_iso` (inclusive) and `end_iso` (exclusive) must be full ISO 8601 datetimes **with timezone** (e.g., `'Z'` for UTC or `'-05:00'`).
- The API filters entries where:

  ```
  start_ts >= start_iso AND start_ts < end_iso
  ```

- This follows the standard inclusive-exclusive time range pattern to prevent overlap between adjacent windows.

**Timezones:**
- You must provide timezone-aware datetimes.
- Clients should convert local boundaries (e.g., days that start at 4 AM) to UTC before calling this endpoint.
- Use the `'Z'` suffix when possible (e.g., `2025-06-12T04:00:00Z`).

**Example:**
To fetch all entries that start on June 12, 2025, with a 4 AM local day start in `America/Chicago`:

```
start_iso=2025-06-12T09:00:00Z
end_iso=2025-06-13T09:00:00Z
```

This captures entries with:
```
start_ts >= 2025-06-12T09:00:00Z
start_ts <  2025-06-13T09:00:00Z
```

The response includes entry metadata, UTC timestamps (ISO and epoch), and associated notes.
""",
)
def get_time_entries(
    start_iso: datetime = Query(  # noqa: B008
        ..., description="Inclusive ISO 8601 UTC datetime (e.g. 2025-06-12T04:00:00Z)"
    ),
    end_iso: datetime = Query(  # noqa: B008
        ..., description="Exclusive ISO 8601 UTC datetime (e.g. 2025-06-13T04:00:00Z)"
    ),
    conn: sqlite3.Connection = Depends(get_db),  # noqa: B008
) -> list[TimeEntryWithNotes]:
    if start_iso >= end_iso:
        raise HTTPException(400, "start_iso must be < end_iso")

    start_ts = _epoch_from_dt(start_iso)
    end_ts = _epoch_from_dt(end_iso)

    sql = """
    SELECT t.*, COALESCE(
             json_group_array(
                 CASE WHEN n.id IS NOT NULL THEN
                      json_object('id', n.id,
                                  'note_text', n.note_text,
                                  'created_at', n.created_at)
                 END
             ), '[]') AS notes
    FROM   time_entries t
    LEFT JOIN entry_notes n USING (entry_id)
    WHERE  t.start_ts >= ?   -- inclusive
      AND  t.start_ts <  ?   -- exclusive
    GROUP  BY t.entry_id
    ORDER  BY t.start_ts;
    """
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    rows = cur.execute(sql, (start_ts, end_ts)).fetchall()

    results = []
    for row in rows:
        item = dict(row)
        # Parse JSON → list & drop null placeholders if any slipped through
        item_notes = [n for n in json.loads(item["notes"]) if n]
        item["notes"] = item_notes
        results.append(item)

    return results


# ---------------- create / delete notes ----------------


@app.post("/notes", status_code=201)
def create_note(
    note: NoteCreate, conn: sqlite3.Connection = Depends(get_db)  # noqa: B008
) -> dict[str, str]:
    """Adds a note to a time entry."""
    conn.execute(
        "INSERT INTO entry_notes (entry_id, note_text) VALUES (?, ?)",
        (note.entry_id, note.note_text),
    )
    conn.commit()
    return {"message": "Note added"}


@app.delete("/notes/{note_id}")
def delete_note(
    note_id: int, conn: sqlite3.Connection = Depends(get_db)  # noqa: B008
) -> dict[str, str]:
    """Deletes a note by its ID."""
    cur = conn.execute("DELETE FROM entry_notes WHERE id = ?", (note_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    conn.commit()
    return {"message": "Note deleted"}


# -------------------------------------------------
# Run directly (dev only)
# -------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=4545, reload=True)
