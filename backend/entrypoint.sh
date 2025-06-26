#!/bin/sh
set -e

# Start the cron daemon in the background
cron

# Run the uvicorn server in the foreground, replacing the shell process
exec uvicorn main:app --host 0.0.0.0 --port 8080 