-- Players are shared between Cash Game and Sit and Go.
-- in_cash marks whether the player appears in the Cash Game ranking.
ALTER TABLE players ADD COLUMN in_cash BOOLEAN NOT NULL DEFAULT TRUE;

-- One row per Sit and Go tournament
CREATE TABLE sng_games (
  id SERIAL PRIMARY KEY,
  title TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sng_games_created_idx ON sng_games (created_at DESC);

-- Top 3 finishers of each tournament
CREATE TABLE sng_results (
  game_id INTEGER NOT NULL REFERENCES sng_games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  place SMALLINT NOT NULL CHECK (place BETWEEN 1 AND 3),
  PRIMARY KEY (game_id, place),
  UNIQUE (game_id, player_id)
);
CREATE INDEX sng_results_player_idx ON sng_results (player_id);

-- Which scoreboard a log entry belongs to ('cash', 'sng', or NULL for account actions)
ALTER TABLE activity_logs ADD COLUMN board TEXT;
UPDATE activity_logs SET board = 'cash' WHERE action IN ('create', 'adjust', 'edit', 'delete', 'import');
