-- Monthly customer prizes: SNG tickets, MTT tickets, or anything else the club hands out.

-- The kinds of prize that can be given out. Kept as a table so staff can add new ones.
CREATE TABLE prize_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO prize_types (name, sort_order) VALUES ('SNG 门票', 1), ('MTT 门票', 2);

/*
 * Every movement is a row: a positive quantity is a prize given to the player,
 * a negative one is the player taking it away. The stock is the sum of the rows,
 * so nothing is ever overwritten and the full history stays available.
 */
CREATE TABLE prize_entries (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  prize_type_id INTEGER NOT NULL REFERENCES prize_types(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  period TEXT,                      -- YYYY-MM, which month's prizes these are
  note TEXT,
  admin_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX prize_entries_player_idx ON prize_entries (player_id);
CREATE INDEX prize_entries_type_idx ON prize_entries (prize_type_id);
CREATE INDEX prize_entries_created_idx ON prize_entries (created_at DESC);
CREATE INDEX prize_entries_period_idx ON prize_entries (period);
