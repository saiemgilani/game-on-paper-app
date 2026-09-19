-- V3 live data-quality signal: the qa verdict rides on the request row, so
-- every /process request is a sample (python/qa.py -> telemetry.py
-- request_log -> /admin/qa). Applied manually on the droplet (the gop schema
-- has no migration runner); kept here as the documented DDL. Owner: sdv.
-- Apply as:  sudo -u sdv psql -d sportsdataverse -f <this file>

ALTER TABLE gop.request_log
    ADD COLUMN IF NOT EXISTS qa_ok       boolean,  -- gate + live rules both clean
    ADD COLUMN IF NOT EXISTS qa_errors   integer,  -- null when the pin has no gate
    ADD COLUMN IF NOT EXISTS qa_warnings integer,
    ADD COLUMN IF NOT EXISTS qa_source   text,     -- the feed the game was served from
    ADD COLUMN IF NOT EXISTS qa_fallback boolean,  -- ...and whether that was a failover
    -- the response's top gate findings AND its live-rule findings under one
    -- rule-id vocabulary, so the per-rule histogram is one unnest over this
    -- column rather than a second table
    ADD COLUMN IF NOT EXISTS qa_rules    text[];

-- Every /admin/qa view filters on "rows carrying a qa verdict, recently".
-- CONCURRENTLY: request_log is the hottest write path in the schema (705k rows
-- / 146MB as of 2026-09-19) and a plain CREATE INDEX holds a write lock for the
-- whole build. psql -f runs in autocommit, so this is legal here; it cannot run
-- inside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS request_log_qa_ts_idx
    ON gop.request_log (ts DESC) WHERE qa_ok IS NOT NULL;

-- Applying this is not a deploy gate: telemetry.py probes the live column set
-- on each connection and inserts only the columns that exist, so the app writes
-- its pre-migration rows before this runs and picks the qa columns up on its
-- next reconnect afterwards. Running it is what makes /admin/qa show anything.
