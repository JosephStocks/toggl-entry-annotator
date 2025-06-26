# %%
# ruff: noqa
import sys
from pathlib import Path

# Add project root to path so `db` module can be imported
project_root = Path(__file__).resolve().parents[2]
sys.path.append(str(project_root))

import polars as pl
from backend.db import create_connection

pl.Config.set_tbl_rows(100)

df = pl.read_database(
    query="SELECT * FROM time_entries",
    connection=create_connection(),
)
print(df.tail(10).write_csv(line_terminator="\\n"))

# %%
import polars as pl
from backend.db import create_connection

pl.Config.set_tbl_rows(100)

df = pl.read_database(
    query="SELECT * FROM entry_notes WHERE note_text = 'test note'",
    connection=create_connection(),
)
# print(df.tail(10).write_csv(line_terminator="\\n"))
df

# %%
from backend.db import create_connection

with create_connection() as conn:
    cursor = conn.cursor()
    cursor.execute("DELETE FROM entry_notes WHERE note_text = 'test note'")
    conn.commit()
