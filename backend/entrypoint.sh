#!/bin/sh
set -e

# Start the cron daemon
service cron start

# Run the uvicorn server in the foreground
exec uvicorn main:app --host 0.0.0.0 --port 8080 