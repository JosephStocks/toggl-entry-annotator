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
COPY . ./code/

# Install Python dependencies
COPY pyproject.toml .
RUN uv pip compile pyproject.toml -o requirements.txt && \
    uv pip install --system --no-cache-dir -r requirements.txt

# Add execute permissions for our scripts
RUN chmod +x /app/code/entrypoint.sh
RUN chmod +x /app/code/backup.sh

# Copy crontab file into image
COPY crontab /etc/crontab
RUN chmod 0644 /etc/crontab

# Use tini to properly manage container processes
CMD ["/app/code/entrypoint.sh"]