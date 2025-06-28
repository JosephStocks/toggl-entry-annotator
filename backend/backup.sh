#!/usr/bin/env bash
set -euo pipefail

DB=/data/time_tracking.sqlite      # volume lives at /data per fly.toml  :contentReference[oaicite:6]{index=6}
DEST="gdrive:TogglNotesBackups"
STAMP=$(date +"%Y-%m-%dT%H-%M-%S")
TMP=/tmp/backups
mkdir -p "$TMP"

echo "Starting backup $STAMP"

sqlite3 "$DB" ".backup '$TMP/$STAMP.bak'"
rclone copyto "$TMP/$STAMP.bak" "$DEST/$STAMP.bak"
rclone delete --min-age 7d "$DEST"          # keep last 7 days only
rm "$TMP/$STAMP.bak"

echo "Backup complete"
