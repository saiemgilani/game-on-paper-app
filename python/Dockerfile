FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim AS pybuilder


RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /code
# Copy the project into the image
ENV PATH="/code/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
ENV UV_NO_DEV=1
RUN uv sync --locked --all-extras --all-groups

# RUN uv pip uninstall -y xgboost nvidia-nccl-cu12 && \
#     uv pip install --no-cache-dir --force-reinstall --no-deps xgboost-cpu==2.1.4

RUN find /code/.venv -depth -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true && \
    find /code/.venv -depth -name tests -type d -exec rm -rf {} + 2>/dev/null || true && \
    find /code/.venv -depth -name "*.pyc" -delete && \
    find /code/.venv -depth -name "*.pyo" -delete

FROM python:3.14-slim
WORKDIR /code

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=pybuilder /code/.venv ./.venv
ENV PATH="/code/.venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY app.py gunicorn.conf.py ./
CMD ["gunicorn", "app:app"]