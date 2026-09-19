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

-- every /admin/qa view filters on "rows carrying a qa verdict, recently"
CREATE INDEX IF NOT EXISTS request_log_qa_ts_idx
    ON gop.request_log (ts DESC) WHERE qa_ok IS NOT NULL;
