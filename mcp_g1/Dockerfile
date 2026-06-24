FROM python:3.12-slim

WORKDIR /app

# Install dependencies first to leverage layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source.
COPY server.py .

# Default runtime configuration. Override any of these via
# `docker run -e VAR=...` or docker-compose `environment:`.
ENV POLICY_REGISTRY_PATH=/app/policies.yaml \
    REDIS_URL=redis://redis:6379/0 \
    REDIS_QUEUE_NAME=policy_queue \
    MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

EXPOSE 8000

CMD ["python", "server.py"]
