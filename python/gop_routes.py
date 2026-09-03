"""GOP telemetry ingest + admin query endpoints. Guarded by X-GOP-Key.

These endpoints may be internet-reachable when Astro runs on Cloudflare
Workers — the shared key is the gate; unauthenticated requests get 401 and
nothing is buffered.
"""

import hmac
import ipaddress
import logging
import os
import threading

from flask import Blueprint, jsonify, request

from telemetry import TEL, _TABLES

log = logging.getLogger("app.gop_admin")

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
            ip = row.get("ip")
            if ip is not None:
                try:
                    ipaddress.ip_address(str(ip))
                except ValueError:
                    row["ip"] = None
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
        except Exception as exc:  # fail-open, but never silently
            log.warning("gop admin query failed: %s", exc)
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
        "slowest": _q("""SELECT u.ts, u.target, u.game_id, u.duration_ms, u.status,
                gm.away_abbr || ' @ ' || gm.home_abbr AS matchup FROM gop.upstream_log u LEFT JOIN gop.game_meta gm ON gm.game_id::text = u.game_id
            WHERE ts > now() - interval '1 hour' ORDER BY duration_ms DESC NULLS LAST LIMIT 10"""),
    }


def _errors(args):
    return {
        "groups": _q("""SELECT e.service, left(e.message, 120) AS signature, count(*)::int AS n,
                max(e.ts) AS last_seen,
                -- game_id and matchup must come from the SAME row (the latest
                -- error), or a multi-game signature links one game while
                -- naming another; both arrays share one deterministic order
                (array_agg(e.game_id ORDER BY e.ts DESC, e.game_id DESC))[1] AS game_id,
                (array_agg(gm.away_abbr || ' @ ' || gm.home_abbr
                           ORDER BY e.ts DESC, e.game_id DESC))[1] AS matchup
            FROM gop.error_log e
            LEFT JOIN gop.game_meta gm ON gm.game_id::text = e.game_id
            WHERE e.ts > now() - interval '24 hours'
            GROUP BY 1, 2 ORDER BY last_seen DESC LIMIT 50"""),
        "recent": _q("""SELECT e.ts, e.service, e.level, e.message, e.stack, e.path, e.game_id,
                gm.away_abbr || ' @ ' || gm.home_abbr AS matchup
            FROM gop.error_log e
            LEFT JOIN gop.game_meta gm ON gm.game_id::text = e.game_id
            ORDER BY e.ts DESC LIMIT 20"""),
    }


def _dq(args):
    """Box-vs-official deltas and lints. Stability across sdv_py_sha is the
    signal; a version-aligned shift in a stat's delta distribution is a parser
    regression."""
    days = min(int(args.get("days", 14)), 90)
    return {
        "scorecard": _q(
            """SELECT stat,
                count(*)::int AS n,
                count(*) FILTER (WHERE delta = 0)::int AS exact,
                count(*) FILTER (WHERE abs(delta) <= 2)::int AS close,
                round(avg(delta)::numeric, 2)::float AS mean_delta,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY delta)::numeric, 2)::float AS median_delta,
                round(max(abs(delta))::numeric, 1)::float AS worst
            FROM gop.dq_boxscore
            WHERE ts > now() - make_interval(days => %s) AND delta IS NOT NULL
            GROUP BY 1 ORDER BY 1""",
            (days,),
        ),
        "by_version": _q(
            """SELECT sdv_py_version, sdv_py_sha, stat,
                count(*)::int AS n, round(avg(delta)::numeric, 2)::float AS mean_delta
            FROM gop.dq_boxscore
            WHERE ts > now() - make_interval(days => %s) AND delta IS NOT NULL
                AND stat NOT LIKE 'lint:%%'
            GROUP BY 1, 2, 3 ORDER BY max(ts) DESC, 3 LIMIT 60""",
            (days,),
        ),
        "worst_games": _q(
            """SELECT d.game_id,
                gm.away_abbr || ' @ ' || gm.home_abbr AS matchup,
                max(d.ts) AS checked_at, max(d.sdv_py_sha) AS sdv_py_sha,
                round(sum(abs(d.delta))::numeric, 1)::float AS total_abs_delta,
                count(*) FILTER (WHERE d.delta <> 0)::int AS stats_off
            FROM gop.dq_boxscore d
            LEFT JOIN gop.game_meta gm ON gm.game_id = d.game_id
            WHERE d.ts > now() - make_interval(days => %s)
                AND d.delta IS NOT NULL AND d.stat NOT LIKE 'lint:%%'
            GROUP BY 1, 2 ORDER BY total_abs_delta DESC LIMIT 25""",
            (days,),
        ),
        "lints": _q(
            """SELECT stat, count(*) FILTER (WHERE delta > 0)::int AS games_flagged,
                sum(delta)::int AS total, max(ts) AS last_seen
            FROM gop.dq_boxscore
            WHERE ts > now() - make_interval(days => %s) AND stat LIKE 'lint:%%'
            GROUP BY 1 ORDER BY 1""",
            (days,),
        ),
        "game": _q(
            """SELECT d.stat, d.team_id, d.ours, d.espn, d.delta
            FROM gop.dq_boxscore d WHERE d.game_id = %s
                AND d.ts = (SELECT max(ts) FROM gop.dq_boxscore WHERE game_id = %s)
            ORDER BY d.team_id NULLS LAST, d.stat""",
            (args.get("game_id", 0), args.get("game_id", 0)),
        )
        if args.get("game_id")
        else [],
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
    "dq": _dq,
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
