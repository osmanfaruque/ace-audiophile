PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  musicbrainz_artist_id TEXT,
  album_count INTEGER NOT NULL DEFAULT 0,
  track_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS genres (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist_id TEXT,
  year INTEGER,
  artwork_uri TEXT,
  musicbrainz_release_id TEXT,
  replay_gain_album REAL,
  track_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_identity
  ON albums(title, IFNULL(artist_id, ''), IFNULL(year, 0));

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,

  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album_artist TEXT NOT NULL,
  album TEXT NOT NULL,
  genre TEXT NOT NULL,
  year INTEGER,
  track_number INTEGER,
  total_tracks INTEGER,
  disc_number INTEGER,
  total_discs INTEGER,
  comment TEXT NOT NULL DEFAULT '',

  duration_ms INTEGER NOT NULL,
  sample_rate INTEGER NOT NULL,
  bit_depth INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  codec TEXT NOT NULL,
  bitrate_kbps INTEGER NOT NULL,
  file_size_bytes INTEGER NOT NULL,

  effective_bit_depth INTEGER,
  dynamic_range REAL,
  lufs REAL,
  true_peak REAL,
  is_lossy_transcode INTEGER,
  lossy_confidence INTEGER,

  replay_gain_track REAL,
  replay_gain_album REAL,

  musicbrainz_id TEXT,
  acoust_id TEXT,
  album_id TEXT NOT NULL,

  date_added INTEGER NOT NULL,
  date_modified INTEGER NOT NULL,
  last_played INTEGER,
  play_count INTEGER NOT NULL DEFAULT 0,

  artist_id TEXT,
  album_artist_id TEXT,
  genre_id TEXT,

  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL,
  FOREIGN KEY (album_artist_id) REFERENCES artists(id) ON DELETE SET NULL,
  FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_album_artist ON tracks(album_artist);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
CREATE INDEX IF NOT EXISTS idx_tracks_year ON tracks(year);
CREATE INDEX IF NOT EXISTS idx_tracks_track_number ON tracks(track_number);
CREATE INDEX IF NOT EXISTS idx_tracks_total_tracks ON tracks(total_tracks);
CREATE INDEX IF NOT EXISTS idx_tracks_disc_number ON tracks(disc_number);
CREATE INDEX IF NOT EXISTS idx_tracks_total_discs ON tracks(total_discs);
CREATE INDEX IF NOT EXISTS idx_tracks_comment ON tracks(comment);
CREATE INDEX IF NOT EXISTS idx_tracks_duration_ms ON tracks(duration_ms);
CREATE INDEX IF NOT EXISTS idx_tracks_sample_rate ON tracks(sample_rate);
CREATE INDEX IF NOT EXISTS idx_tracks_bit_depth ON tracks(bit_depth);
CREATE INDEX IF NOT EXISTS idx_tracks_channels ON tracks(channels);
CREATE INDEX IF NOT EXISTS idx_tracks_codec ON tracks(codec);
CREATE INDEX IF NOT EXISTS idx_tracks_bitrate_kbps ON tracks(bitrate_kbps);
CREATE INDEX IF NOT EXISTS idx_tracks_file_size_bytes ON tracks(file_size_bytes);
CREATE INDEX IF NOT EXISTS idx_tracks_effective_bit_depth ON tracks(effective_bit_depth);
CREATE INDEX IF NOT EXISTS idx_tracks_dynamic_range ON tracks(dynamic_range);
CREATE INDEX IF NOT EXISTS idx_tracks_lufs ON tracks(lufs);
CREATE INDEX IF NOT EXISTS idx_tracks_true_peak ON tracks(true_peak);
CREATE INDEX IF NOT EXISTS idx_tracks_is_lossy_transcode ON tracks(is_lossy_transcode);
CREATE INDEX IF NOT EXISTS idx_tracks_lossy_confidence ON tracks(lossy_confidence);
CREATE INDEX IF NOT EXISTS idx_tracks_replay_gain_track ON tracks(replay_gain_track);
CREATE INDEX IF NOT EXISTS idx_tracks_replay_gain_album ON tracks(replay_gain_album);
CREATE INDEX IF NOT EXISTS idx_tracks_musicbrainz_id ON tracks(musicbrainz_id);
CREATE INDEX IF NOT EXISTS idx_tracks_acoust_id ON tracks(acoust_id);
CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(date_added);
CREATE INDEX IF NOT EXISTS idx_tracks_date_modified ON tracks(date_modified);
CREATE INDEX IF NOT EXISTS idx_tracks_last_played ON tracks(last_played);
CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_album_artist_id ON tracks(album_artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_genre_id ON tracks(genre_id);

CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
  track_id UNINDEXED,
  title,
  artist,
  album,
  album_artist,
  genre,
  comment,
  content = '',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  track_count INTEGER NOT NULL DEFAULT 0,
  is_smart_playlist INTEGER NOT NULL DEFAULT 0,
  rules_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_playlists_name ON playlists(name);
CREATE INDEX IF NOT EXISTS idx_playlists_modified_at ON playlists(modified_at);
CREATE INDEX IF NOT EXISTS idx_playlists_is_smart ON playlists(is_smart_playlist);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  PRIMARY KEY (playlist_id, track_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_tracks_position
  ON playlist_tracks(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_id ON playlist_tracks(track_id);

CREATE TABLE IF NOT EXISTS ratings (
  track_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 5),
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (track_id),
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ratings_stars ON ratings(stars);
CREATE INDEX IF NOT EXISTS idx_ratings_timestamp ON ratings(timestamp);

CREATE TABLE IF NOT EXISTS listening_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_listening_events_track_id ON listening_events(track_id);
CREATE INDEX IF NOT EXISTS idx_listening_events_started_at ON listening_events(started_at);
CREATE INDEX IF NOT EXISTS idx_listening_events_completed ON listening_events(completed);

CREATE TABLE IF NOT EXISTS play_count (
  track_id TEXT PRIMARY KEY,
  play_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_play_count_value ON play_count(play_count);
CREATE INDEX IF NOT EXISTS idx_play_count_updated_at ON play_count(updated_at);

INSERT OR IGNORE INTO schema_versions(version, description)
VALUES (1, 'a5_1_base_schema');
