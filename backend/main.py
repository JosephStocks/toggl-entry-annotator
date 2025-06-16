from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import sqlite3
import json

# -------------------------------------------------
# Config
# -------------------------------------------------
DB_PATH = "time_tracking.sqlite"  # keep one truth‑source name

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    start: str  # ISO‑8601 Z
    stop: Optional[str]
    start_ts: int  # epoch UTC
    stop_ts: Optional[int]
    tag_ids: str
    tag_names: str
    at: str
    at_ts: int
    notes: List[Note] = []


class NoteCreate(BaseModel):
    entry_id: int
    note_text: str


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
# Routes
# -------------------------------------------------


@app.get(
    "/time_entries",
    response_model=List[TimeEntryWithNotes],
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
- Clients should convert local boundaries (e.g., days that start at 4 AM) to UTC before calling this endpoint.
- Use the `'Z'` suffix when possible (e.g., `2025-06-12T04:00:00Z`).

**Example:**
To fetch all entries that start on June 12, 2025, with a 4 AM local day start in `America/Chicago`:

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
    start_iso: datetime = Query(
        ..., description="Inclusive ISO 8601 UTC datetime (e.g. 2025-06-12T04:00:00Z)"
    ),
    end_iso: datetime = Query(
        ..., description="Exclusive ISO 8601 UTC datetime (e.g. 2025-06-13T04:00:00Z)"
    ),
) -> List[TimeEntryWithNotes]:
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
    with sqlite3.connect(DB_PATH) as conn:
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

    conn.close()
    return results


# ---------------- create / delete notes ----------------


@app.post("/notes", status_code=201)
def create_note(note: NoteCreate) -> dict[str, str]:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO entry_notes (entry_id, note_text) VALUES (?, ?)",
        (note.entry_id, note.note_text),
    )
    conn.commit()
    conn.close()
    return {"message": "Note added"}


@app.delete("/notes/{note_id}")
def delete_note(note_id: int) -> dict[str, str]:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM entry_notes WHERE id = ?", (note_id,))
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")
    conn.commit()
    conn.close()
    return {"message": "Note deleted"}


# -------------------------------------------------
# Run directly (dev only)
# -------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=4545, reload=True)
