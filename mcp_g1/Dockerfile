FROM python:3.12-slim
WORKDIR /app

# Install C build toolchain before pip install.
# cffi (and cryptography, etc.) have no prebuilt wheels for linux/arm/v7,
# so pip must compile them from source — which needs gcc + libffi-dev.
# --no-install-recommends keeps the layer small.
# The apt cache is cleaned in the same RUN to avoid bloating the image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libffi-dev \
    libssl-dev \
    python3-dev \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies first to leverage layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source.
COPY server.py .

# Default runtime configuration. Override any of these via
# `docker run -e VAR=...` or docker-compose `environment:`.
ENV POLICY_REGISTRY_PATH=/app/policies.yaml \
    REDIS_URL=redis://redis:6379/0 \
    REDIS_QUEUE_NAME=policy:command \
    REDIS_EVENTS_QUEUE_NAME=policy:events \
    POLICY_MIMIC_INDEX=6 \
    MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

EXPOSE 8000
CMD ["python", "server.py"]