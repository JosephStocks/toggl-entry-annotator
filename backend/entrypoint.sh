#!/usr/bin/env bash
set -euo pipefail          # fail-fast & catch unset vars

### 1.  Materialise rclone.conf from the secret text
if [[ -n "${RCLONE_CONF:-}" ]]; then
  mkdir -p /root/.config/rclone
  printf '%s\n' "$RCLONE_CONF" > /root/.config/rclone/rclone.conf
  export RCLONE_CONFIG=/root/.config/rclone/rclone.conf   # rclone needs a *path*
fi

### 2.  Snapshot the final environment for cron shells
printenv > /etc/environment      # done *after* the export so cron sees the path

### 3.  Start Supercronic in the background
supercronic /etc/crontab &       # inherits all ENV automatically

### 4.  Launch the web server in the foreground (PID 1)
# Set the PYTHONPATH to the directory *containing* our 'code' package
# Then, run uvicorn targeting the module `code.main:app`
export PYTHONPATH=/app
exec uvicorn code.main:app --host 0.0.0.0 --port 8080