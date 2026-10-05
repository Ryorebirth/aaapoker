-- Monthly settlement for the Cash Game (常规赛).
-- Closing a month archives the final table, then resets everyone's points to zero.

CREATE TABLE cash_periods (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,                -- e.g. 2026-09
  started_on DATE,                    -- when this period started counting
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by TEXT NOT NULL,
  player_count INTEGER NOT NULL DEFAULT 0,
  total_points NUMERIC(14, 2) NOT NULL DEFAULT 0
);
CREATE INDEX cash_periods_closed_idx ON cash_periods (closed_at DESC);

CREATE TABLE cash_period_results (
  id BIGSERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES cash_periods(id) ON DELETE CASCADE,
  player_id INTEGER,                  -- kept loose so deleting a player never erases history
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  points NUMERIC(14, 2) NOT NULL,
  rank INTEGER NOT NULL
);
CREATE INDEX cash_period_results_period_idx ON cash_period_results (period_id, rank);

-- The date the current Cash Game period started counting
INSERT INTO settings (key, value)
VALUES ('cash_period_start', to_char(NOW() AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM-01'))
ON CONFLICT (key) DO NOTHING;
