# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""Seed local GOP telemetry via POST /gop/ingest so every admin tab has data.

Usage:  GOP_INGEST_KEY=devkey uv run scripts/seed_gop.py
Note: ts is server-assigned, so all rows land "now" — charts show a current
spike, which is fine for layout/endpoint verification.
"""

import os
import random

import requests

BASE = os.environ.get("PYTHON_HTTP_URL", "http://localhost:7000")
KEY = os.environ.get("GOP_INGEST_KEY", "devkey")
GAMES = ["401628599", "401628477", "401635525"]

events = []
for i in range(300):
    game = GAMES[i % 3]
    degraded, failed = i % 17 == 0, i % 41 == 0
    events.append(
        {
            "table": "request_log",
            "row": {
                "service": "astro",
                "method": "GET",
                "path": f"/cfb/game/{game}",
                "route_pattern": "/cfb/game/[id]",
                "status": 500 if failed else 200,
                "duration_ms": 60 + random.random() * 900,
                "ip": f"98.144.20.{i % 250}",
                "ua": "Googlebot/2.1" if i % 5 == 0 else "Mozilla/5.0",
                "game_id": game,
                "cache_status": "miss" if i % 3 == 0 else "hit",
                "render_outcome": "failed"
                if failed
                else ("degraded" if degraded else "ok"),
                "missing_datasets": ["winprobability", "pickcenter"]
                if degraded
                else None,
            },
        }
    )
    if i % 4 == 0:
        events.append(
            {
                "table": "upstream_log",
                "row": {
                    "service": "astro",
                    "target": [
                        "espn_pbp",
                        "espn_scoreboard",
                        "flask_process",
                        "summary",
                    ][i % 4],
                    "status": 502 if i % 37 == 0 else 200,
                    "duration_ms": 40 + random.random() * 1200,
                    "ok": i % 37 != 0,
                    "game_id": game,
                    "error": "Bad Gateway" if i % 37 == 0 else None,
                },
            }
        )
for i in range(8):
    events.append(
        {
            "table": "error_log",
            "row": {
                "service": "python" if i % 2 else "client",
                "level": "error",
                "message": "ESPN pbp 502 Bad Gateway"
                if i % 2
                else "TypeError: null is not an object",
                "stack": "at GamePage.astro:31",
                "path": "/cfb/game/401628599",
                "game_id": "401628599",
            },
        }
    )
    events.append(
        {
            "table": "client_event",
            "row": {
                "type": "web_vital",
                "name": ["LCP", "CLS", "INP"][i % 3],
                "value": [2100, 0.04, 140][i % 3],
                "path": "/cfb/game/401628599",
                "game_id": "401628599",
                "ua": "Mozilla/5.0",
                "ip": "98.144.20.1",
            },
        }
    )
for i in range(6):
    events.append(
        {
            "table": "system_stat",
            "row": {"service": "python", "rss_mb": 900 + i * 10, "cpu_pct": 30.0},
        }
    )

for chunk in range(0, len(events), 150):
    r = requests.post(
        f"{BASE}/gop/ingest",
        json={"events": events[chunk : chunk + 150]},
        headers={"X-GOP-Key": KEY},
        timeout=10,
    )
    print(chunk, r.status_code, r.json())
print(f"seeded {len(events)} events (python flushes to PG within ~5s)")
