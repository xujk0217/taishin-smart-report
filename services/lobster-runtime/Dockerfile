FROM python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY pyproject.toml ./
RUN python -m pip install --no-cache-dir --upgrade pip==26.2 setuptools==83.0.0 && \
    pip install --no-cache-dir \
      boto3==1.37.38 openpyxl==3.1.5 pydantic==2.12.5 strands-agents==1.47.0 && \
    addgroup --system planner && adduser --system --ingroup planner planner

# Keep the expensive dependency layer independent from application source. A
# normal planner change now uploads only this small final layer to ECR.
COPY src ./src
COPY entrypoint.sh /usr/local/bin/planner-entrypoint
RUN pip install --no-cache-dir --no-deps . && \
    chmod 0755 /usr/local/bin/planner-entrypoint

ENTRYPOINT ["/usr/local/bin/planner-entrypoint"]
