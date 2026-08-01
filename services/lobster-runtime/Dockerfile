FROM python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
COPY entrypoint.sh /usr/local/bin/planner-entrypoint
RUN python -m pip install --no-cache-dir --upgrade pip==26.2 setuptools==83.0.0 && \
    pip install --no-cache-dir . && \
    addgroup --system planner && adduser --system --ingroup planner planner && \
    chmod 0755 /usr/local/bin/planner-entrypoint

ENTRYPOINT ["/usr/local/bin/planner-entrypoint"]
