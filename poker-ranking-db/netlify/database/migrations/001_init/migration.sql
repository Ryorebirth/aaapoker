-- Admin accounts
CREATE TABLE admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Login sessions (only a SHA-256 hash of the token is stored)
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_admin_idx ON sessions (admin_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Players and their current points
CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL UNIQUE,
  points NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX players_points_idx ON players (points DESC);

-- Every change made by an admin (kept even if the player is deleted)
CREATE TABLE activity_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  player_id INTEGER,
  player_name TEXT,
  player_phone TEXT,
  delta NUMERIC(14, 2),
  points_before NUMERIC(14, 2),
  points_after NUMERIC(14, 2),
  detail TEXT,
  admin_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX activity_logs_created_idx ON activity_logs (created_at DESC);
CREATE INDEX activity_logs_player_idx ON activity_logs (player_id);

-- Simple key/value settings (e.g. leaderboard title)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('title', '撲克積分排行榜');
