"""GOP telemetry ingest + admin query endpoints. Guarded by X-GOP-Key.

These endpoints may be internet-reachable when Astro runs on Cloudflare
Workers — the shared key is the gate; unauthenticated requests get 401 and
nothing is buffered.
"""

import hmac
import os
import threading

from flask import Blueprint, jsonify, request

from telemetry import TEL, _TABLES

bp = Blueprint("gop", __name__)

_ro_conn = None
# ponytail: one global lock serializes all admin reads (psycopg3 conns are not
# thread-safe for concurrent cursors); per-thread conns if dashboards pile up
_ro_lock = threading.Lock()


def _authed():
    key = os.environ.get("GOP_INGEST_KEY")
    return bool(key) and hmac.compare_digest(
        request.headers.get("X-GOP-Key") or "", key
    )


@bp.route("/gop/ingest", methods=["POST"])
def ingest():
    if not _authed():
        return jsonify({"ok": False}), 401
    body = request.get_json(force=True, silent=True) or {}
    events = body.get("events") or []
    accepted = 0
    for e in events[:200]:
        if not isinstance(e, dict):
            continue
        table, row = e.get("table"), e.get("row")
        if table in _TABLES and isinstance(row, dict):
            row.pop("ts", None)  # server assigns ts; client clocks drift
            TEL.push(table, row)
            accepted += 1
    return jsonify({"ok": True, "accepted": accepted}), 202


def _q(sql, params=None):
    """Read-only query via gop_reader. Fail-open: [] on any error."""
    global _ro_conn
    dsn = os.environ.get("GOP_PG_DSN_RO")
    if not dsn:
        return []
    with _ro_lock:
        try:
            import psycopg

            if _ro_conn is None or _ro_conn.closed:
                _ro_conn = psycopg.connect(dsn, connect_timeout=5, autocommit=True)
            with _ro_conn.cursor() as cur:
                cur.execute(sql, params or {})
                cols = [d.name for d in cur.description]
                return [dict(zip(cols, r)) for r in cur.fetchall()]
        except Exception:
            try:
                if _ro_conn is not None:
                    _ro_conn.close()
            except Exception:
                pass
            _ro_conn = None
            return []


def _overview(args):
    return {
        "reqPerMin": _q("""SELECT date_trunc('minute', ts) AS m, count(*)::int AS n
            FROM gop.request_log WHERE ts > now() - interval '60 minutes' AND service = 'astro'
            GROUP BY 1 ORDER BY 1"""),
        "pct": _q("""SELECT to_timestamp(floor(extract(epoch FROM ts)/300)*300) AS b,
                percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
            FROM gop.request_log WHERE ts > now() - interval '60 minutes' AND service = 'astro'
            GROUP BY 1 ORDER BY 1"""),
        "statusMix": _q("""SELECT (status/100)::int AS klass, count(*)::int AS n
            FROM gop.request_log WHERE ts > now() - interval '1 hour' GROUP BY 1 ORDER BY 1"""),
        "services": _q("""SELECT DISTINCT ON (service) service, ts, rss_mb, cpu_pct
            FROM gop.system_stat ORDER BY service, ts DESC"""),
        "espn": (
            _q("""SELECT count(*) FILTER (WHERE ok)::int AS oks, count(*)::int AS total
            FROM gop.upstream_log WHERE ts > now() - interval '1 hour' AND target LIKE 'espn%%'""")
            or [{}]
        )[0],
        "telemetry": TEL.stats(),
    }


def _games(args):
    return {
        "gamesAgg": _q("""SELECT game_id, count(*)::int AS req_30m,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
                max(ts) AS last_req,
                (count(*) FILTER (WHERE cache_status = 'hit'))::float
                  / nullif(count(*) FILTER (WHERE cache_status IS NOT NULL), 0) AS cache_hit,
                count(*) FILTER (WHERE render_outcome = 'degraded')::int AS degraded,
                count(*) FILTER (WHERE render_outcome = 'failed')::int AS failed
            FROM gop.request_log
            WHERE ts > now() - interval '30 minutes' AND game_id IS NOT NULL
            GROUP BY game_id ORDER BY req_30m DESC LIMIT 25"""),
        "lastFetch": _q("""SELECT DISTINCT ON (game_id) game_id, ts, status, duration_ms, ok
            FROM gop.upstream_log WHERE target = 'espn_pbp' AND ts > now() - interval '2 hours'
            ORDER BY game_id, ts DESC"""),
    }


def _upstream(args):
    return {
        "targets": _q("""SELECT target,
                percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                (count(*) FILTER (WHERE ok))::float / nullif(count(*), 0) AS success,
                count(*)::int AS total
            FROM gop.upstream_log WHERE ts > now() - interval '24 hours'
            GROUP BY target ORDER BY target"""),
        "failures": _q("""SELECT date_trunc('hour', ts) AS h,
                count(*) FILTER (WHERE status >= 500)::int AS s5xx,
                count(*) FILTER (WHERE status IS NULL AND ok = false)::int AS timeouts
            FROM gop.upstream_log WHERE ts > now() - interval '24 hours' GROUP BY 1 ORDER BY 1"""),
        "slowest": _q("""SELECT ts, target, game_id, duration_ms, status FROM gop.upstream_log
            WHERE ts > now() - interval '1 hour' ORDER BY duration_ms DESC NULLS LAST LIMIT 10"""),
    }


def _errors(args):
    return {
        "groups": _q("""SELECT service, left(message, 120) AS signature, count(*)::int AS n,
                max(ts) AS last_seen, max(game_id) AS game_id
            FROM gop.error_log WHERE ts > now() - interval '24 hours'
            GROUP BY 1, 2 ORDER BY last_seen DESC LIMIT 50"""),
        "recent": _q("""SELECT ts, service, level, message, stack, path, game_id
            FROM gop.error_log ORDER BY ts DESC LIMIT 20"""),
    }


def _traffic(args):
    return {
        "routes": _q("""SELECT route_pattern, count(*)::int AS n,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
            FROM gop.request_log WHERE ts > now() - interval '1 hour' AND service = 'astro'
            GROUP BY 1 ORDER BY n DESC LIMIT 15"""),
        "ips": _q("""SELECT ip::text AS ip, count(*)::int AS n,
                count(*) FILTER (WHERE status BETWEEN 400 AND 499)::int AS c4xx, max(ua) AS ua
            FROM gop.request_log WHERE ts > now() - interval '1 hour' AND ip IS NOT NULL
            GROUP BY ip ORDER BY n DESC LIMIT 15"""),
        "vitals": _q("""SELECT name, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
            FROM gop.client_event WHERE type = 'web_vital' AND ts > now() - interval '24 hours'
            GROUP BY name"""),
    }


def _system(args):
    return {
        "series": _q("""SELECT date_trunc('minute', ts) AS m, service,
            avg(rss_mb) AS rss_mb, avg(cpu_pct) AS cpu_pct
        FROM gop.system_stat WHERE ts > now() - interval '6 hours'
        GROUP BY 1, 2 ORDER BY 1""")
    }


def _page(args):
    p = {"gid": args.get("game_id") or None, "route": args.get("route") or None}
    return {
        "outcomes": _q(
            """SELECT coalesce(render_outcome, 'ok') AS outcome, count(*)::int AS n
            FROM gop.request_log WHERE ts > now() - interval '1 hour'
              AND (%(gid)s::text IS NULL OR game_id = %(gid)s)
              AND (%(route)s::text IS NULL OR route_pattern = %(route)s)
            GROUP BY 1""",
            p,
        ),
        "missing": _q(
            """SELECT unnest(missing_datasets) AS dataset, count(*)::int AS n
            FROM gop.request_log
            WHERE ts > now() - interval '24 hours' AND missing_datasets IS NOT NULL
              AND (%(gid)s::text IS NULL OR game_id = %(gid)s)
              AND (%(route)s::text IS NULL OR route_pattern = %(route)s)
            GROUP BY 1 ORDER BY 2 DESC""",
            p,
        ),
        "errors": _q(
            """SELECT ts, service, message FROM gop.error_log
            WHERE ts > now() - interval '24 hours' AND (%(gid)s::text IS NULL OR game_id = %(gid)s)
            ORDER BY ts DESC LIMIT 10""",
            p,
        ),
        "latest": (
            _q(
                """SELECT ts, render_outcome, missing_datasets FROM gop.request_log
            WHERE (%(gid)s::text IS NULL OR game_id = %(gid)s)
              AND render_outcome IN ('degraded', 'failed')
            ORDER BY ts DESC LIMIT 1""",
                p,
            )
            or [None]
        )[0],
    }


_ADMIN = {
    "overview": _overview,
    "games": _games,
    "upstream": _upstream,
    "errors": _errors,
    "traffic": _traffic,
    "system": _system,
    "page": _page,
}


@bp.route("/gop/admin/<name>", methods=["GET"])
def admin(name):
    if not _authed():
        return jsonify({"ok": False}), 401
    fn = _ADMIN.get(name)
    if fn is None:
        return jsonify({"error": "unknown endpoint"}), 404
    return jsonify(fn(request.args))
