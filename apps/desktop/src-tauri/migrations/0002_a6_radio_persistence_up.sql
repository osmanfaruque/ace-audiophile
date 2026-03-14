PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS radio_stations (
  stationuuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  bitrate INTEGER NOT NULL DEFAULT 0,
  favicon TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  url_resolved TEXT NOT NULL DEFAULT '',
  homepage TEXT NOT NULL DEFAULT '',
  codec TEXT NOT NULL DEFAULT '',
  votes INTEGER NOT NULL DEFAULT 0,
  clickcount INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER,
  last_clicked_at INTEGER,
  last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_radio_stations_favorite ON radio_stations(is_favorite, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_stations_recent ON radio_stations(last_played_at DESC, last_clicked_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_stations_name ON radio_stations(name);
CREATE INDEX IF NOT EXISTS idx_radio_stations_country ON radio_stations(country);
CREATE INDEX IF NOT EXISTS idx_radio_stations_tags ON radio_stations(tags);

INSERT OR IGNORE INTO schema_versions(version, description)
VALUES (2, 'a6_3_radio_stations_persistence');
