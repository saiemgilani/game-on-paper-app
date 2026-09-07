-- Admin action audit log: every privileged POST (purge, preview toggle,
-- preview-link mint) with who/what/when/result. Rendered on /admin.
-- Apply as the postgres superuser:  sudo -u sdv psql -d sportsdataverse -f <this file>

CREATE TABLE IF NOT EXISTS gop.admin_audit (
    id      bigserial PRIMARY KEY,
    ts      timestamptz NOT NULL DEFAULT now(),
    actor   text,           -- basic-auth username, or 'admin-cookie'
    action  text NOT NULL,  -- purge-game | preview-toggle | preview-link
    detail  text,           -- ids/tags purged, minted path, on/off
    ok      boolean
);
CREATE INDEX IF NOT EXISTS admin_audit_ts_idx ON gop.admin_audit (ts DESC);

GRANT INSERT ON gop.admin_audit TO gop_writer;
GRANT USAGE ON SEQUENCE gop.admin_audit_id_seq TO gop_writer;
GRANT SELECT ON gop.admin_audit TO gop_reader;
