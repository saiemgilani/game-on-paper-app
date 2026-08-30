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
#
# SDV_PY_MAIN_SHA is the cache-buster. The re-resolve layer's inputs are only
# pyproject.toml, uv.lock and the command, so a warm Docker cache would reuse it
# and keep the old SHA no matter what main did. The workflow resolves main's SHA
# (git ls-remote) and passes it in; a new value changes the layer and forces the
# re-resolve. It is informational otherwise -- uv still resolves main itself.
ARG SDV_PY_MAIN_SHA=unpinned
RUN echo "requested sportsdataverse-py main @ ${SDV_PY_MAIN_SHA}" && \
    uv lock --upgrade-package sportsdataverse && \
    uv sync --locked --all-extras --all-groups && \
    sha="$(grep -A2 'name = "sportsdataverse"' uv.lock | grep -oE 'sportsdataverse-py\?branch=main#[0-9a-f]+' | sed 's/.*#//')" && \
    echo "$sha" | grep -qE '^[0-9a-f]{40}$' || { echo "could not extract a 40-hex sportsdataverse SHA from uv.lock (got: '$sha')" >&2; exit 1; } && \
    printf '%s' "$sha" > /code/sdv_py_sha.txt && \
    echo "sportsdataverse-py @ $sha"

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

COPY *.py ./
CMD ["gunicorn", "app:app"]