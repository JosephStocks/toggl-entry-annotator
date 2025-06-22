FROM python:3.13-slim

# -- tools ---------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

# -- deps ---------------------------------------------------------------
COPY pyproject.toml .
RUN uv pip compile pyproject.toml -o requirements.txt && \
    uv pip install --system --no-cache-dir -r requirements.txt
# -- code ---------------------------------------------------------------
COPY . .

ENV DB_PATH=/data/time_tracking.sqlite
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
