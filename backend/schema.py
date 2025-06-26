"""
Centralized database schema and initialization.
"""
from db import create_connection

SCHEMA = """
CREATE TABLE IF NOT EXISTS time_entries (
    entry_id    INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    project_id  INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    seconds     INTEGER NOT NULL,

    start       TEXT NOT NULL,          -- ISO-8601 in UTC (…Z)
    stop        TEXT,                   -- ISO-8601 in UTC
    at          TEXT NOT NULL,          -- ISO-8601 in UTC

    start_ts    INTEGER NOT NULL,       -- epoch-seconds UTC
    stop_ts     INTEGER,                -- epoch-seconds UTC
    at_ts       INTEGER NOT NULL,       -- epoch-seconds UTC

    tag_ids     TEXT,
    tag_names   TEXT
);

CREATE INDEX IF NOT EXISTS idx_start_ts ON time_entries(start_ts);

CREATE TABLE IF NOT EXISTS entry_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id    INTEGER NOT NULL,
    note_text   TEXT NOT NULL,
    created_at  TEXT NOT NULL
                 DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (entry_id) REFERENCES time_entries(entry_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_entry_id ON entry_notes(entry_id);
"""


def init_database():
    """Initializes the database using the centralized schema."""
    with create_connection() as conn:
        conn.executescript(SCHEMA)
        conn.commit()
