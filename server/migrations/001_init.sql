-- PulseCheck initial schema
-- Users own monitors. Every scheduled run of a monitor produces one row in
-- `checks`. Consecutive failures are grouped into a single row in
-- `incidents` (opened on the up->down transition, closed on down->up).

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitors (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    url                 TEXT NOT NULL,
    method              TEXT NOT NULL DEFAULT 'GET',
    interval_seconds    INTEGER NOT NULL DEFAULT 60,
    timeout_ms          INTEGER NOT NULL DEFAULT 5000,
    expected_status_min INTEGER NOT NULL DEFAULT 200,
    expected_status_max INTEGER NOT NULL DEFAULT 399,
    webhook_url         TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_checked_at     TIMESTAMPTZ,
    current_status      TEXT NOT NULL DEFAULT 'unknown',  -- 'up' | 'down' | 'unknown'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitors_user_id ON monitors(user_id);
CREATE INDEX IF NOT EXISTS idx_monitors_due ON monitors(is_active, last_checked_at);

CREATE TABLE IF NOT EXISTS checks (
    id          SERIAL PRIMARY KEY,
    monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok          BOOLEAN NOT NULL,
    status_code INTEGER,
    latency_ms  INTEGER,
    error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
    id          SERIAL PRIMARY KEY,
    monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    cause       TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, started_at DESC);
-- At most one open incident per monitor, enforced at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_one_open
    ON incidents(monitor_id) WHERE resolved_at IS NULL;
