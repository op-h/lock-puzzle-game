-- One private save per (name, code) and one public leaderboard row per account. Idempotent: safe to run twice.
CREATE TABLE IF NOT EXISTS players (
  id   TEXT PRIMARY KEY CHECK (length(id) = 64),
  v    INTEGER NOT NULL CHECK (v = 1),
  save TEXT NOT NULL,
  rev  INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS board (
  bid       TEXT PRIMARY KEY CHECK (length(bid) = 64),
  name      TEXT NOT NULL,
  total     INTEGER NOT NULL,
  blood     INTEGER NOT NULL,
  solved    INTEGER NOT NULL,
  bestRun   INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS board_total   ON board (total DESC, bid);
CREATE INDEX IF NOT EXISTS board_bestrun ON board (bestRun DESC, bid);
