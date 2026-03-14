use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:ace.db";
const DB_FILE_NAME: &str = "ace.db";

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
    Ok(base)
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
