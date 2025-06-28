# ---------- Build image ----------
FROM python:3.13-slim

# Install system deps
RUN apt-get update && apt-get install -y curl sqlite3 unzip && rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Install rclone (official script)
RUN curl -fsSL https://rclone.org/install.sh | bash

# Install supercronic (static Go binary, tiny)
RUN curl -fsSL https://github.com/aptible/supercronic/releases/latest/download/supercronic-linux-amd64 \
    -o /usr/local/bin/supercronic && chmod +x /usr/local/bin/supercronic

# Copy project
WORKDIR /app
COPY . .

# Install Python dependencies
COPY pyproject.toml .
RUN uv pip compile pyproject.toml -o requirements.txt && \
    uv pip install --system --no-cache-dir -r requirements.txt

# Copy crontab file into image
COPY crontab /etc/crontab
RUN chmod 0644 /etc/crontab

# Entrypoint:
#  1. Dump env so cron can reload it later
#  2. Materialise the rclone config file from the secret text
#  3. Start supercronic in the background
#  4. Exec the web server (so the container only has one PID 1)
ENTRYPOINT ["/bin/bash", "-c", "\
    printenv > /etc/environment && \
    mkdir -p /root/.config/rclone && \
    printf '%s\n' \"$RCLONE_CONF\" > /root/.config/rclone/rclone.conf && \
    export RCLONE_CONFIG=/root/.config/rclone/rclone.conf && \
    supercronic /etc/crontab & \
    exec uvicorn main:app --host 0.0.0.0 --port 8080 \
    "]
