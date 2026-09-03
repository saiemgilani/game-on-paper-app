-- Admin data-quality slice: matchup dimension + box-vs-official deltas.
-- Applied manually on the droplet (gop schema has no migration runner);
-- kept here as the documented DDL. Owner: sdv. 2026-09-02.

CREATE TABLE IF NOT EXISTS gop.game_meta (
    game_id     bigint PRIMARY KEY,
    season      int,
    week        int,
    away_abbr   text,
    home_abbr   text,
    away_score  real,
    home_score  real,
    status      text,
    kickoff_ts  timestamptz,
    last_seen   timestamptz
);

CREATE TABLE IF NOT EXISTS gop.dq_boxscore (
    ts              timestamptz NOT NULL,
    game_id         bigint NOT NULL,
    team_id         bigint,
    stat            text NOT NULL,
    ours            double precision,
    espn            double precision,
    delta           double precision,
    sdv_py_version  text,
    sdv_py_sha      text
);
CREATE INDEX IF NOT EXISTS dq_boxscore_game_idx ON gop.dq_boxscore (game_id);
CREATE INDEX IF NOT EXISTS dq_boxscore_stat_ts_idx ON gop.dq_boxscore (stat, ts);

GRANT SELECT ON gop.game_meta, gop.dq_boxscore TO gop_reader;
GRANT INSERT ON gop.dq_boxscore TO gop_writer;
-- game_meta is written as an upsert; ON CONFLICT DO UPDATE needs UPDATE, and the
-- COALESCE(EXCLUDED.c, gop.game_meta.c) expressions read the existing row (SELECT).
GRANT SELECT, INSERT, UPDATE ON gop.game_meta TO gop_writer;
