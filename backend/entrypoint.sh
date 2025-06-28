#!/bin/sh
set -e

# Materialise the rclone config file from the secret text
# This ensures rclone can find its configuration in the default location.
if [ -n "$RCLONE_CONF" ]; then
  mkdir -p /root/.config/rclone
  printf '%s\n' "$RCLONE_CONF" > /root/.config/rclone/rclone.conf
fi

# Start supercronic in the background to run scheduled tasks.
# It automatically has access to all environment variables.
supercronic /etc/crontab &

# Run the uvicorn server in the foreground.
# 'exec' replaces the shell process, making uvicorn the main process.
exec uvicorn main:app --host 0.0.0.0 --port 8080 