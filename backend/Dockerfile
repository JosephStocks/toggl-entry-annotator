FROM python:3.13-slim

# -- tools ---------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates unzip cron tini && \
    curl https://rclone.org/install.sh | bash

RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

# -- deps ---------------------------------------------------------------
COPY pyproject.toml .
RUN uv pip compile pyproject.toml -o requirements.txt && \
    uv pip install --system --no-cache-dir -r requirements.txt
# -- code ---------------------------------------------------------------
COPY . .
RUN chmod +x /app/backup.sh
RUN chmod +x /app/entrypoint.sh

# Add crontab file to the cron directory
COPY crontab /etc/cron.d/backup-cron
# Give execution rights on the cron job
RUN chmod 0644 /etc/cron.d/backup-cron

ENV DB_PATH=/data/time_tracking.sqlite
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]
