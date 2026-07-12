# Game on Paper
---

## Development

Make sure you have Docker installed. Once you do, `cd` into the repo and run the following commands:

```Shell
$ docker compose pull && docker compose up --build
```

This will setup the containers just like how they are run on DigitalOcean.

Test API requests using Postman -- Send a POST request to `localhost:8000/cfb/<ESPN gameId>`.

Test the frontend using a browser -- load up `localhost:8000/cfb`.

See Issues tab for more details on things in flight.

## Admin observability

`/admin` (basic auth: `ADMIN_USER`/`ADMIN_PASS`, enforced in Astro middleware)
shows request latency, live-game processing health, ESPN upstream status, errors
(server + client), traffic, and system stats, with a per-page drill-down of
missing datasets (degraded vs failed renders). Telemetry flows: Astro middleware
and the client beacon POST events to python `/gop/ingest` (shared
`GOP_INGEST_KEY`); python batches everything into the `gop` schema on the
sdv-data Postgres (`GOP_PG_DSN` / `GOP_PG_DSN_RO`). All paths are fail-open —
if python or Postgres is down the site is unaffected. `TELEMETRY_ENABLED=0`
disables. Setup runbook: sdv-db `docs/gop-telemetry-runbook.md`. Local dev:
`astro/.env.example` + `scripts/seed_gop.py`. Visitor analytics: Plausible
Cloud (tag in `GenericPage.astro`).
`astro/wrangler.jsonc` sets `global_fetch_strictly_public`, so on Workers the
`http://python:7000` fallback is refused by the runtime — `PYTHON_HTTP_URL`
must be set as a wrangler secret to python's public URL.
