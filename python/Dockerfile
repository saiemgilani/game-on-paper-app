FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim AS pybuilder


RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /code
# Copy the project into the image
ENV PATH="/code/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
ENV UV_NO_DEV=1
# Track sportsdataverse-py MAIN at build time. pyproject says branch=main, but
# `uv sync --locked` installs the SHA the lock recorded, so the image only ever
# advanced when someone ran `uv lock --upgrade-package` by hand -- the site sat on
# v0.1.3 for a day after PR #408 merged. Re-resolving that one package here (and
# only that one: everything else stays pinned by the lock) makes every build a
# subscription to main. The resolved SHA is written into the image so
# /healthcheck can report exactly what is running.
RUN uv lock --upgrade-package sportsdataverse && \
    uv sync --locked --all-extras --all-groups && \
    grep -A2 'name = "sportsdataverse"' uv.lock | grep -oE 'sportsdataverse-py\?branch=main#[0-9a-f]+' | sed 's/.*#//' > /code/sdv_py_sha.txt && \
    echo "sportsdataverse-py @ $(cat /code/sdv_py_sha.txt)"

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
COPY --from=pybuilder /code/sdv_py_sha.txt ./sdv_py_sha.txt
ENV PATH="/code/.venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY app.py gunicorn.conf.py telemetry.py gop_routes.py ./
CMD ["gunicorn", "app:app"]