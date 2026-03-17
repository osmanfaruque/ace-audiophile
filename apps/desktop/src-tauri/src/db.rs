use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rusqlite::params;
use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:ace.db";
const DB_FILE_NAME: &str = "ace.db";
static DB_SCHEMA_INIT: OnceLock<Result<(), String>> = OnceLock::new();

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "a5_1_base_schema_up",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/0001_a5_schema_up.sql"),
        },
        Migration {
            version: 1,
            description: "a5_1_base_schema_down",
            kind: MigrationKind::Down,
            sql: include_str!("../migrations/0001_a5_schema_down.sql"),
        },
        Migration {
            version: 2,
            description: "a6_3_radio_persistence_up",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/0002_a6_radio_persistence_up.sql"),
        },
        Migration {
            version: 2,
            description: "a6_3_radio_persistence_down",
            kind: MigrationKind::Down,
            sql: include_str!("../migrations/0002_a6_radio_persistence_down.sql"),
        },
    ]
}

pub fn export_db_json(app: &AppHandle, output_path: Option<String>) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(&db_path)?;

    let mut tables_stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;

    let table_names: Vec<String> = tables_stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;

    let mut tables = BTreeMap::<String, Value>::new();
    for table in table_names {
        let rows = export_table_rows(&conn, &table)?;
        tables.insert(table, Value::Array(rows));
    }

    let version_rows = export_schema_versions(&conn)?;
    let payload = json!({
        "exported_at": chrono_like_now_ms(),
        "db_path": db_path.to_string_lossy(),
        "schema_versions": version_rows,
        "tables": tables,
    });

    let pretty = serde_json::to_string_pretty(&payload)?;
    if let Some(path) = output_path {
        fs::write(path, &pretty)?;
    }

    Ok(pretty)
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let mut base = app.path().app_data_dir()?;
    fs::create_dir_all(&base)?;
    base.push(DB_FILE_NAME);

    let init = DB_SCHEMA_INIT.get_or_init(|| {
        init_schema(&base).map_err(|e| e.to_string())
    });
    if let Err(msg) = init {
        return Err(std::io::Error::other(msg.clone()).into());
    }

    Ok(base)
}

fn init_schema(db_path: &Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    // Keep migrations aligned with SQL plugin schema on first access.
    conn.execute_batch(include_str!("../migrations/0001_a5_schema_up.sql"))?;
    conn.execute_batch(include_str!("../migrations/0002_a6_radio_persistence_up.sql"))?;

    Ok(())
}

fn export_table_rows(conn: &Connection, table: &str) -> Result<Vec<Value>, Box<dyn std::error::Error + Send + Sync>> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM \"{}\"", table.replace('"', "\"\"")))?;
    let columns: Vec<String> = stmt.column_names().iter().map(|n| (*n).to_string()).collect();

    let mut rows = stmt.query([])?;
    let mut out = Vec::new();

    while let Some(row) = rows.next()? {
        let mut obj = Map::new();
        for (idx, col_name) in columns.iter().enumerate() {
            let v = row.get_ref(idx)?;
            obj.insert(col_name.clone(), sqlite_value_to_json(v));
        }
        out.push(Value::Object(obj));
    }

    Ok(out)
}

fn export_schema_versions(conn: &Connection) -> Result<Vec<Value>, Box<dyn std::error::Error + Send + Sync>> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at INTEGER NOT NULL)",
        [],
    )?;

    let mut stmt = conn.prepare("SELECT version, description, applied_at FROM schema_versions ORDER BY version")?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();

    while let Some(row) = rows.next()? {
        out.push(json!({
            "version": row.get::<_, i64>(0)?,
            "description": row.get::<_, String>(1)?,
            "applied_at": row.get::<_, i64>(2)?,
        }));
    }

    Ok(out)
}

fn sqlite_value_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(v) => json!(v),
        ValueRef::Real(v) => json!(v),
        ValueRef::Text(v) => Value::String(String::from_utf8_lossy(v).to_string()),
        ValueRef::Blob(v) => Value::Array(v.iter().map(|b| json!(*b)).collect()),
    }
}

fn chrono_like_now_ms() -> i64 {
    let now = std::time::SystemTime::now();
    let Ok(dur) = now.duration_since(std::time::UNIX_EPOCH) else {
        return 0;
    };
    dur.as_millis() as i64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryQuery {
    pub search: Option<String>,
    pub mode: Option<String>,
    pub active_filter: Option<String>,
    pub sort_key: Option<String>,
    pub sort_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbTrack {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub genre: String,
    pub year: Option<i64>,
    pub track_number: Option<i64>,
    pub total_tracks: Option<i64>,
    pub disc_number: Option<i64>,
    pub total_discs: Option<i64>,
    pub comment: String,
    pub duration_ms: i64,
    pub sample_rate: i64,
    pub bit_depth: i64,
    pub channels: i64,
    pub codec: String,
    pub bitrate_kbps: i64,
    pub file_size_bytes: i64,
    pub play_count: i64,
    pub album_art_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistPayload {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: i64,
    pub modified_at: i64,
    pub track_count: i64,
    pub is_smart_playlist: bool,
    pub rules_json: Option<String>,
    pub track_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatingPayload {
    pub track_id: String,
    pub stars: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioStationRecord {
    pub stationuuid: String,
    pub name: String,
    pub country: String,
    pub language: String,
    pub tags: String,
    pub bitrate: i64,
    pub favicon: String,
    pub url: String,
    pub url_resolved: String,
    pub homepage: String,
    pub codec: String,
    pub votes: i64,
    pub clickcount: i64,
    pub is_favorite: bool,
    pub last_played_at: Option<i64>,
    pub last_clicked_at: Option<i64>,
}

pub fn scan_and_index_folder(app: &AppHandle, folder_path: &str) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
    let files = crate::bridge::collect_audio_files(Some(app), folder_path)?;
    index_file_paths(app, &files)?;
    Ok(files.len() as u32)
}

pub fn index_file_paths(app: &AppHandle, file_paths: &[String]) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let mut conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    let tx = conn.transaction()?;
    let now = chrono_like_now_ms();
    let mut indexed = 0u32;

    for path in file_paths {
        let meta = match crate::bridge::extract_metadata_json(path) {
            Ok(v) => v,
            Err(_) => json!({}),
        };

        let title = meta.get("title").and_then(|v| v.as_str()).unwrap_or_else(|| file_stem(path));
        let artist = meta.get("artist").and_then(|v| v.as_str()).unwrap_or("Unknown Artist");
        let album = meta.get("album").and_then(|v| v.as_str()).unwrap_or("Unknown Album");
        let genre = meta.get("genre").and_then(|v| v.as_str()).unwrap_or("");
        let comment = meta.get("comment").and_then(|v| v.as_str()).unwrap_or("");
        let year = meta.get("year").and_then(|v| v.as_i64()).unwrap_or(0);
        let track_number = meta.get("track").and_then(|v| v.as_i64()).unwrap_or(0);
        let disc_number = meta.get("disc").and_then(|v| v.as_i64()).unwrap_or(0);
        let album_art_path = meta
            .get("album_art_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let album_artist = artist;
        let artist_id = stable_id("artist", artist);
        let album_artist_id = stable_id("artist", album_artist);
        let album_id = stable_id("album", &format!("{}::{}", album_artist, album));
        let genre_id = if genre.is_empty() { None } else { Some(stable_id("genre", genre)) };

        tx.execute(
            "INSERT INTO artists(id,name,updated_at) VALUES(?1,?2,?3)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at",
            params![artist_id, artist, now],
        )?;

        if artist_id != album_artist_id {
            tx.execute(
                "INSERT INTO artists(id,name,updated_at) VALUES(?1,?2,?3)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at",
                params![album_artist_id, album_artist, now],
            )?;
        }

        if let Some(ref gid) = genre_id {
            tx.execute(
                "INSERT INTO genres(id,name,updated_at) VALUES(?1,?2,?3)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at",
                params![gid, genre, now],
            )?;
        }

        tx.execute(
            "INSERT INTO albums(id,title,artist_id,year,artwork_uri,track_count,updated_at)
             VALUES(?1,?2,?3,NULLIF(?4,0),NULLIF(?5,''),0,?6)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, artist_id=excluded.artist_id,
               year=excluded.year, artwork_uri=COALESCE(NULLIF(excluded.artwork_uri,''), albums.artwork_uri),
               updated_at=excluded.updated_at",
            params![album_id, album, album_artist_id, year, album_art_path, now],
        )?;

        let file_md = fs::metadata(path).ok();
        let file_size = file_md
            .as_ref()
            .map(|m| m.len() as i64)
            .unwrap_or(0);
        let date_modified = file_md
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(now);

        let codec = file_ext(path);
        let track_id = path.clone();
        tx.execute(
            "INSERT INTO tracks(
                id,file_path,title,artist,album_artist,album,genre,year,track_number,total_tracks,
                disc_number,total_discs,comment,duration_ms,sample_rate,bit_depth,channels,codec,
                bitrate_kbps,file_size_bytes,musicbrainz_id,acoust_id,album_id,date_added,date_modified,
                last_played,play_count,artist_id,album_artist_id,genre_id
             ) VALUES(
                ?1,?2,?3,?4,?5,?6,?7,NULLIF(?8,0),NULLIF(?9,0),NULL,
                NULLIF(?10,0),NULL,?11,0,0,0,2,?12,
                0,?13,NULL,NULL,?14,?15,?16,
                NULL,COALESCE((SELECT play_count FROM tracks WHERE id=?1),0),?17,?18,?19
             )
             ON CONFLICT(id) DO UPDATE SET
                file_path=excluded.file_path,title=excluded.title,artist=excluded.artist,
                album_artist=excluded.album_artist,album=excluded.album,genre=excluded.genre,
                year=excluded.year,track_number=excluded.track_number,disc_number=excluded.disc_number,
                comment=excluded.comment,codec=excluded.codec,file_size_bytes=excluded.file_size_bytes,
                album_id=excluded.album_id,date_modified=excluded.date_modified,
                artist_id=excluded.artist_id,album_artist_id=excluded.album_artist_id,genre_id=excluded.genre_id",
            params![
                track_id,
                path,
                title,
                artist,
                album_artist,
                album,
                genre,
                year,
                track_number,
                disc_number,
                comment,
                codec,
                file_size,
                album_id,
                now,
                date_modified,
                artist_id,
                album_artist_id,
                genre_id,
            ],
        )?;

        tx.execute(
            "INSERT INTO tracks_fts(track_id,title,artist,album,album_artist,genre,comment)
             VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(track_id) DO NOTHING",
            params![path, title, artist, album, album_artist, genre, comment],
        )
        .ok();

        tx.execute(
            "INSERT INTO play_count(track_id,play_count,updated_at) VALUES(?1,0,?2)
             ON CONFLICT(track_id) DO NOTHING",
            params![path, now],
        )?;

        indexed += 1;
    }

    tx.execute(
        "UPDATE albums SET track_count=(SELECT COUNT(*) FROM tracks WHERE tracks.album_id=albums.id)",
        [],
    )?;
    tx.execute(
        "UPDATE artists SET album_count=(SELECT COUNT(DISTINCT id) FROM albums WHERE albums.artist_id=artists.id),
                           track_count=(SELECT COUNT(*) FROM tracks WHERE tracks.artist_id=artists.id)",
        [],
    )?;

    tx.commit()?;
    Ok(indexed)
}

pub fn query_library_tracks(app: &AppHandle, query: LibraryQuery) -> Result<Vec<DbTrack>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;

    let search = query.search.unwrap_or_default().to_lowercase();
    let mode = query.mode.unwrap_or_else(|| "library".to_string());
    let active_filter = query.active_filter.unwrap_or_default();
    let sort_key = match query.sort_key.as_deref().unwrap_or("title") {
        "artist" => "t.artist",
        "album" => "t.album",
        "year" => "t.year",
        "codec" => "t.codec",
        "sampleRate" => "t.sample_rate",
        "durationMs" => "t.duration_ms",
        "playCount" => "t.play_count",
        _ => "t.title",
    };
    let sort_dir = if query.sort_dir.as_deref().unwrap_or("asc").eq_ignore_ascii_case("desc") {
        "DESC"
    } else {
        "ASC"
    };

    let mut sql = String::from(
        "SELECT t.id,t.file_path,t.title,t.artist,t.album_artist,t.album,t.genre,t.year,
                t.track_number,t.total_tracks,t.disc_number,t.total_discs,t.comment,t.duration_ms,
                t.sample_rate,t.bit_depth,t.channels,t.codec,t.bitrate_kbps,t.file_size_bytes,
                t.play_count,a.artwork_uri
         FROM tracks t
         LEFT JOIN albums a ON a.id = t.album_id
         WHERE 1=1",
    );

    if !search.is_empty() {
        sql.push_str(" AND (lower(t.title) LIKE ?1 OR lower(t.artist) LIKE ?1 OR lower(t.album) LIKE ?1 OR lower(t.genre) LIKE ?1)");
    }

    if !active_filter.is_empty() {
        match mode.as_str() {
            "genres" => sql.push_str(" AND IFNULL(t.genre,'Unknown Genre') = ?2"),
            "albums" => sql.push_str(" AND t.album = ?2"),
            _ => sql.push_str(" AND t.artist = ?2"),
        }
    }

    sql.push_str(&format!(" ORDER BY {} {}", sort_key, sort_dir));

    let like = format!("%{}%", search);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = if search.is_empty() && active_filter.is_empty() {
        stmt.query([])?
    } else if active_filter.is_empty() {
        stmt.query([like.as_str()])?
    } else if search.is_empty() {
        stmt.query([active_filter.as_str()])?
    } else {
        stmt.query(params![like, active_filter])?
    };

    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        out.push(DbTrack {
            id: r.get(0)?,
            file_path: r.get(1)?,
            title: r.get(2)?,
            artist: r.get(3)?,
            album_artist: r.get(4)?,
            album: r.get(5)?,
            genre: r.get(6)?,
            year: r.get(7)?,
            track_number: r.get(8)?,
            total_tracks: r.get(9)?,
            disc_number: r.get(10)?,
            total_discs: r.get(11)?,
            comment: r.get(12)?,
            duration_ms: r.get(13)?,
            sample_rate: r.get(14)?,
            bit_depth: r.get(15)?,
            channels: r.get(16)?,
            codec: r.get(17)?,
            bitrate_kbps: r.get(18)?,
            file_size_bytes: r.get(19)?,
            play_count: r.get(20)?,
            album_art_path: r.get(21).ok(),
        });
    }
    Ok(out)
}

pub fn save_playlists(app: &AppHandle, entries: &[PlaylistPayload]) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let mut conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let tx = conn.transaction()?;

    tx.execute("DELETE FROM playlist_tracks", [])?;
    tx.execute("DELETE FROM playlists", [])?;

    for p in entries {
        tx.execute(
            "INSERT INTO playlists(id,name,description,created_at,modified_at,track_count,is_smart_playlist,rules_json)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                p.id,
                p.name,
                p.description,
                p.created_at,
                p.modified_at,
                p.track_count,
                if p.is_smart_playlist { 1 } else { 0 },
                p.rules_json,
            ],
        )?;

        for (idx, track_path) in p.track_paths.iter().enumerate() {
            tx.execute(
                "INSERT INTO playlist_tracks(playlist_id,track_id,position) VALUES(?1,?2,?3)",
                params![p.id, track_path, idx as i64],
            )
            .ok();
        }
    }

    tx.commit()?;
    Ok(())
}

pub fn load_playlists(app: &AppHandle) -> Result<Vec<PlaylistPayload>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;

    let mut stmt = conn.prepare(
        "SELECT id,name,description,created_at,modified_at,track_count,is_smart_playlist,rules_json
         FROM playlists ORDER BY modified_at DESC",
    )?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();

    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let mut track_stmt = conn.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id=?1 ORDER BY position")?;
        let track_paths = track_stmt
            .query_map([id.as_str()], |rr| rr.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        out.push(PlaylistPayload {
            id,
            name: r.get(1)?,
            description: r.get(2)?,
            created_at: r.get(3)?,
            modified_at: r.get(4)?,
            track_count: r.get(5)?,
            is_smart_playlist: r.get::<_, i64>(6)? != 0,
            rules_json: r.get(7).ok(),
            track_paths,
        });
    }

    Ok(out)
}

pub fn set_rating(app: &AppHandle, track_id: &str, stars: i64) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    let now = chrono_like_now_ms();

    conn.execute(
        "INSERT INTO ratings(track_id,stars,timestamp) VALUES(?1,?2,?3)
         ON CONFLICT(track_id) DO UPDATE SET stars=excluded.stars, timestamp=excluded.timestamp",
        params![track_id, stars.clamp(0, 5), now],
    )?;
    Ok(())
}

pub fn get_ratings(app: &AppHandle) -> Result<Vec<RatingPayload>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT track_id,stars FROM ratings ORDER BY timestamp DESC")?;
    let out = stmt
        .query_map([], |r| {
            Ok(RatingPayload {
                track_id: r.get(0)?,
                stars: r.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(out)
}

pub fn upsert_radio_stations(
    app: &AppHandle,
    stations: &[RadioStationRecord],
) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
    if stations.is_empty() {
        return Ok(0);
    }

    let db_path = resolve_db_path(app)?;
    let mut conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let tx = conn.transaction()?;
    let now = chrono_like_now_ms();

    let mut count = 0u32;
    for s in stations {
        tx.execute(
            "INSERT INTO radio_stations(
                stationuuid,name,country,language,tags,bitrate,favicon,url,url_resolved,homepage,
                codec,votes,clickcount,is_favorite,last_played_at,last_clicked_at,last_seen_at,created_at,updated_at
             ) VALUES(
                ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,
                ?11,?12,?13,COALESCE(?14,0),?15,?16,?17,?17,?17
             )
             ON CONFLICT(stationuuid) DO UPDATE SET
                name=excluded.name,
                country=excluded.country,
                language=excluded.language,
                tags=excluded.tags,
                bitrate=excluded.bitrate,
                favicon=excluded.favicon,
                url=excluded.url,
                url_resolved=excluded.url_resolved,
                homepage=excluded.homepage,
                codec=excluded.codec,
                votes=excluded.votes,
                clickcount=excluded.clickcount,
                last_seen_at=excluded.last_seen_at,
                updated_at=excluded.updated_at",
            params![
                s.stationuuid,
                s.name,
                s.country,
                s.language,
                s.tags,
                s.bitrate,
                s.favicon,
                s.url,
                s.url_resolved,
                s.homepage,
                s.codec,
                s.votes,
                s.clickcount,
                if s.is_favorite { 1 } else { 0 },
                s.last_played_at,
                s.last_clicked_at,
                now,
            ],
        )?;
        count += 1;
    }

    tx.commit()?;
    Ok(count)
}

pub fn set_radio_station_favorite(
    app: &AppHandle,
    station: &RadioStationRecord,
    is_favorite: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    upsert_radio_stations(app, std::slice::from_ref(station))?;

    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    conn.execute(
        "UPDATE radio_stations SET is_favorite=?2, updated_at=?3 WHERE stationuuid=?1",
        params![
            station.stationuuid,
            if is_favorite { 1 } else { 0 },
            chrono_like_now_ms(),
        ],
    )?;
    Ok(())
}

pub fn mark_radio_station_recent(
    app: &AppHandle,
    station: &RadioStationRecord,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    upsert_radio_stations(app, std::slice::from_ref(station))?;

    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    let now = chrono_like_now_ms();
    conn.execute(
        "UPDATE radio_stations SET last_played_at=?2, updated_at=?2 WHERE stationuuid=?1",
        params![station.stationuuid, now],
    )?;
    Ok(())
}

pub fn mark_radio_station_clicked(
    app: &AppHandle,
    stationuuid: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    let now = chrono_like_now_ms();
    conn.execute(
        "UPDATE radio_stations SET last_clicked_at=?2, updated_at=?2 WHERE stationuuid=?1",
        params![stationuuid, now],
    )?;
    Ok(())
}

pub fn load_favorite_radio_stations(
    app: &AppHandle,
) -> Result<Vec<RadioStationRecord>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT stationuuid,name,country,language,tags,bitrate,favicon,url,url_resolved,homepage,
                codec,votes,clickcount,is_favorite,last_played_at,last_clicked_at
         FROM radio_stations
         WHERE is_favorite=1
         ORDER BY updated_at DESC, name COLLATE NOCASE ASC",
    )?;
    map_radio_station_rows(&mut stmt)
}

pub fn load_recent_radio_stations(
    app: &AppHandle,
    limit: u32,
) -> Result<Vec<RadioStationRecord>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT stationuuid,name,country,language,tags,bitrate,favicon,url,url_resolved,homepage,
                codec,votes,clickcount,is_favorite,last_played_at,last_clicked_at
         FROM radio_stations
         WHERE last_played_at IS NOT NULL OR last_clicked_at IS NOT NULL
         ORDER BY COALESCE(last_played_at, last_clicked_at, updated_at) DESC, updated_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit.max(1) as i64], |r| {
            Ok(RadioStationRecord {
                stationuuid: r.get(0)?,
                name: r.get(1)?,
                country: r.get(2)?,
                language: r.get(3)?,
                tags: r.get(4)?,
                bitrate: r.get(5)?,
                favicon: r.get(6)?,
                url: r.get(7)?,
                url_resolved: r.get(8)?,
                homepage: r.get(9)?,
                codec: r.get(10)?,
                votes: r.get(11)?,
                clickcount: r.get(12)?,
                is_favorite: r.get::<_, i64>(13)? != 0,
                last_played_at: r.get(14).ok(),
                last_clicked_at: r.get(15).ok(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn map_radio_station_rows(
    stmt: &mut rusqlite::Statement<'_>,
) -> Result<Vec<RadioStationRecord>, Box<dyn std::error::Error + Send + Sync>> {
    let rows = stmt
        .query_map([], |r| {
            Ok(RadioStationRecord {
                stationuuid: r.get(0)?,
                name: r.get(1)?,
                country: r.get(2)?,
                language: r.get(3)?,
                tags: r.get(4)?,
                bitrate: r.get(5)?,
                favicon: r.get(6)?,
                url: r.get(7)?,
                url_resolved: r.get(8)?,
                homepage: r.get(9)?,
                codec: r.get(10)?,
                votes: r.get(11)?,
                clickcount: r.get(12)?,
                is_favorite: r.get::<_, i64>(13)? != 0,
                last_played_at: r.get(14).ok(),
                last_clicked_at: r.get(15).ok(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn log_listening_event(
    app: &AppHandle,
    track_id: &str,
    started_at: i64,
    ended_at: Option<i64>,
    completed: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO listening_events(track_id,started_at,ended_at,completed) VALUES(?1,?2,?3,?4)",
        params![track_id, started_at, ended_at, if completed { 1 } else { 0 }],
    )?;

    if completed {
        conn.execute(
            "UPDATE tracks SET play_count = play_count + 1, last_played = ?2 WHERE id = ?1",
            params![track_id, ended_at.unwrap_or_else(chrono_like_now_ms)],
        )?;
        conn.execute(
            "INSERT INTO play_count(track_id,play_count,updated_at) VALUES(?1,1,?2)
             ON CONFLICT(track_id) DO UPDATE SET play_count=play_count+1, updated_at=excluded.updated_at",
            params![track_id, ended_at.unwrap_or_else(chrono_like_now_ms)],
        )?;
    }

    Ok(())
}

pub fn get_album_art_path(app: &AppHandle, track_id: &str) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT a.artwork_uri FROM tracks t LEFT JOIN albums a ON a.id=t.album_id WHERE t.id=?1 OR t.file_path=?1 LIMIT 1",
    )?;
    let mut rows = stmt.query([track_id])?;
    if let Some(r) = rows.next()? {
        let v: Option<String> = r.get(0).ok();
        return Ok(v.filter(|s| !s.is_empty()));
    }
    Ok(None)
}

pub fn get_recap_stats(
    app: &AppHandle,
    year: i32,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path)?;

    let start = format!("{}-01-01", year);
    let end = format!("{}-01-01", year + 1);

    let total_ms: i64 = conn.query_row(
        "SELECT COALESCE(SUM(COALESCE(ended_at,started_at)-started_at),0)
         FROM listening_events
         WHERE datetime(started_at/1000,'unixepoch') >= ?1
           AND datetime(started_at/1000,'unixepoch') < ?2",
        params![start, end],
        |r| r.get(0),
    )?;

    let mut top_tracks_stmt = conn.prepare(
        "SELECT t.id, t.title, t.artist, COUNT(*) AS play_count,
                COALESCE(SUM(COALESCE(le.ended_at,le.started_at)-le.started_at),0) AS total_ms
         FROM listening_events le
         JOIN tracks t ON t.id = le.track_id
         WHERE datetime(le.started_at/1000,'unixepoch') >= ?1
           AND datetime(le.started_at/1000,'unixepoch') < ?2
         GROUP BY t.id, t.title, t.artist
         ORDER BY play_count DESC, total_ms DESC
         LIMIT 20",
    )?;
    let top_tracks: Vec<Value> = top_tracks_stmt
        .query_map(params![start, end], |r| {
            Ok(json!({
                "track": { "id": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?, "artist": r.get::<_, String>(2)? },
                "playCount": r.get::<_, i64>(3)?,
                "totalMs": r.get::<_, i64>(4)?,
            }))
        })?
        .collect::<Result<_, _>>()?;

    let completed_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM listening_events WHERE completed=1 AND datetime(started_at/1000,'unixepoch') >= ?1 AND datetime(started_at/1000,'unixepoch') < ?2",
        params![start, end],
        |r| r.get(0),
    )?;
    let skipped_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM listening_events WHERE completed=0 AND ended_at IS NOT NULL AND datetime(started_at/1000,'unixepoch') >= ?1 AND datetime(started_at/1000,'unixepoch') < ?2",
        params![start, end],
        |r| r.get(0),
    )?;

    let mut hourly = vec![0i64; 24];
    let mut hour_stmt = conn.prepare(
        "SELECT CAST(strftime('%H', started_at/1000, 'unixepoch', 'localtime') AS INTEGER) AS hour, COUNT(*)
         FROM listening_events
         WHERE datetime(started_at/1000,'unixepoch') >= ?1
           AND datetime(started_at/1000,'unixepoch') < ?2
         GROUP BY hour",
    )?;
    let mut hour_rows = hour_stmt.query(params![start, end])?;
    while let Some(r) = hour_rows.next()? {
        let h: i64 = r.get(0)?;
        let c: i64 = r.get(1)?;
        if (0..24).contains(&h) {
            hourly[h as usize] = c;
        }
    }

    Ok(json!({
        "totalMs": total_ms,
        "topTracks": top_tracks,
        "topArtists": [],
        "topAlbums": [],
        "topGenres": [],
        "qualityBreakdown": [],
        "hourlyHeatmap": hourly,
        "dailyHistory": [],
        "sessionStats": {
            "skips": skipped_count,
            "repeats": 0,
            "completed": completed_count,
            "peakHour": hourly
                .iter()
                .enumerate()
                .max_by_key(|(_, v)| **v)
                .map(|(idx, _)| idx)
                .unwrap_or(0)
        }
    }))
}

fn stable_id(prefix: &str, raw: &str) -> String {
    let mut h: u64 = 1469598103934665603;
    for b in raw.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("{}-{:016x}", prefix, h)
}

fn file_stem(path: &str) -> &str {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
}

fn file_ext(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_ascii_lowercase()
}
