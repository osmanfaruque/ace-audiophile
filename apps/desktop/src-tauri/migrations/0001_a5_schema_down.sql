PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS play_count;
DROP TABLE IF EXISTS listening_events;
DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS playlist_tracks;
DROP TABLE IF EXISTS playlists;
DROP TABLE IF EXISTS tracks_fts;
DROP TABLE IF EXISTS tracks;
DROP TABLE IF EXISTS albums;
DROP TABLE IF EXISTS genres;
DROP TABLE IF EXISTS artists;

DELETE FROM schema_versions WHERE version = 1;
