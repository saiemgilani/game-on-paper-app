"""ESPN fetch relay for the Astro worker.

ESPN's CDN (Akamai) intermittently denies Cloudflare Workers' shared egress IPs
with a 403 "Access Denied" -- in episodes of 7-10 minutes, one refresh after
another -- while the same URLs from this host succeed every time. The worker
tries ESPN directly and, on a 403, asks this endpoint to fetch on its behalf.

Only https URLs on ESPN hosts are relayed (no open proxy); auth is the same
base64 bearer token as the rest of the API.
"""

import base64
import logging
import os
from urllib.parse import urlparse

import requests
from flask import Blueprint, Response, jsonify, request

bp = Blueprint("espn_proxy", __name__)
log = logging.getLogger("root")

ESPN_HOSTS = frozenset({"cdn.espn.com", "site.api.espn.com", "site.web.api.espn.com"})
ESPN_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/26.5.2 Safari/605.1.15"
)
TIMEOUT_S = 15


def espn_url_allowed(url: str) -> bool:
    p = urlparse(url)
    return p.scheme == "https" and (p.hostname or "").lower() in ESPN_HOSTS


def _authorized() -> bool:
    expected = os.getenv("PYTHON_HTTP_TOKEN")
    bearer = request.headers.get("Authorization", "")
    parts = bearer.split()
    if not expected or len(parts) != 2:
        return False
    try:
        return base64.b64decode(parts[1]).decode("ascii") == expected
    except Exception:
        return False


@bp.get("/espn/proxy")
def espn_proxy():
    if not _authorized():
        return jsonify({"status": "bad", "message": "Access denied"}), 401
    url = request.args.get("url", "")
    if not espn_url_allowed(url):
        return jsonify({"status": "bad", "message": "url not allowed"}), 400
    try:
        r = requests.get(url, headers={"User-Agent": ESPN_UA}, timeout=TIMEOUT_S)
    except requests.RequestException as e:
        log.error(f"espn proxy: {url} failed: {e}")
        return jsonify({"status": "bad", "message": "upstream fetch failed"}), 502
    log.info(f"espn proxy: {r.status_code} {url}")
    return Response(
        r.content,
        status=r.status_code,
        content_type=r.headers.get("Content-Type", "application/json"),
        headers={"X-Espn-Proxy": "1"},
    )
