#!/bin/sh
set -e

# This script is run by a daily scheduled machine on Fly.io
# It backs up the SQLite database to a Google Drive folder.

# Configure rclone from the secret environment variable
# This creates the config file in the default location (~/.config/rclone/rclone.conf)
# Using printf is more robust for multiline secrets than echo.
RCLONE_CONFIG_PATH=$(rclone config file | tail -n 1)
mkdir -p "$(dirname "$RCLONE_CONFIG_PATH")"
printf "%s" "$RCLONE_CONFIG" > "$RCLONE_CONFIG_PATH"

BACKUP_DIR=/tmp/backups
DB_FILE=time_tracking.sqlite
SOURCE_DB_PATH=/data/$DB_FILE
DEST_PATH="gdrive:TogglNotesBackups" # "gdrive" is the name of the rclone remote, "TogglNotesBackups" is the folder

# Create a timestamped backup file
TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S")
BACKUP_FILE="$DB_FILE.$TIMESTAMP.bak"
mkdir -p $BACKUP_DIR
sqlite3 $SOURCE_DB_PATH ".backup '$BACKUP_DIR/$BACKUP_FILE'"

echo "Creating backup: $BACKUP_FILE"

# Upload the backup file to Google Drive
rclone copyto $BACKUP_DIR/$BACKUP_FILE "$DEST_PATH/$BACKUP_FILE"

echo "Backup uploaded to $DEST_PATH"

# Clean up old local backups
rm $BACKUP_DIR/$BACKUP_FILE

# Clean up old remote backups (older than 7 days)
rclone delete --min-age 7d "$DEST_PATH"

echo "Old backups (older than 7 days) have been removed from remote."

echo "Backup complete." 