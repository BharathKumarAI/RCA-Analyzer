FROM node:22-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8000

WORKDIR /app
RUN pip install --no-cache-dir uv==0.12.13
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Dependency installation is independent of source/template/documentation changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/data /app/blob_local/projects /app/blob_local/agent-configurations /app/blob_local/optimizations \
    && chown appuser:appuser /app/data /app/blob_local/projects /app/blob_local/agent-configurations /app/blob_local/optimizations
COPY README.md ./
COPY app ./app
COPY --from=frontend-build /frontend/dist ./frontend/dist
COPY blob_local/platform ./blob_local/platform
COPY scripts ./scripts
COPY migrations ./migrations
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.fast_api_app:app", "--host", "0.0.0.0", "--port", "8000"]
