FROM python:3.14-slim AS pybuilder


RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

RUN pip uninstall -y xgboost nvidia-nccl-cu12 && \
    pip install --no-cache-dir --force-reinstall --no-deps xgboost-cpu==2.1.4

RUN find /opt/venv -depth -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true && \
    find /opt/venv -depth -name tests -type d -exec rm -rf {} + 2>/dev/null || true && \
    find /opt/venv -depth -name "*.pyc" -delete && \
    find /opt/venv -depth -name "*.pyo" -delete

FROM python:3.14-slim
WORKDIR /code

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=pybuilder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY app.py schemas.py flask_logs.py ./

CMD ["gunicorn", "-w", "2", "-k", "gthread", "--threads", "8", "--timeout", "120", "--preload", "-b", "0.0.0.0:7000", "app:app"]