use std::process::Command;

use serde::{Deserialize, Serialize};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutoTagCandidate {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub year: String,
    pub score: u8,
}

#[derive(Debug, Deserialize)]
struct FpcalcJson {
    duration: f32,
    fingerprint: String,
}

pub fn generate_fingerprint(file_path: &str) -> Result<(u32, String), BoxError> {
    let output = Command::new("fpcalc")
        .arg("-json")
        .arg(file_path)
        .output()
        .map_err(|e| format!("fpcalc not available: {e}"))?;

    if !output.status.success() {
        return Err(format!("fpcalc failed with code {:?}", output.status.code()).into());
    }

    let parsed: FpcalcJson = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("invalid fpcalc json: {e}"))?;

    Ok((parsed.duration.max(1.0).round() as u32, parsed.fingerprint))
}

pub async fn acoustid_lookup(file_path: &str) -> Result<Vec<AutoTagCandidate>, BoxError> {
    let (duration, fingerprint) = generate_fingerprint(file_path)?;
    let client_key = std::env::var("ACOUSTID_API_KEY")
        .map_err(|_| "ACOUSTID_API_KEY environment variable is required")?;

    let client = reqwest::Client::builder()
        .user_agent("AudiophileAce/0.1 (acoustid lookup)")
        .build()?;

    let resp = client
        .get("https://api.acoustid.org/v2/lookup")
        .query(&[
            ("client", client_key.as_str()),
            ("meta", "recordings+releasegroups+releases"),
            ("duration", &duration.to_string()),
            ("fingerprint", fingerprint.as_str()),
        ])
        .send()
        .await?
        .error_for_status()?;

    let json: serde_json::Value = resp.json().await?;
    let mut out = Vec::new();

    if let Some(results) = json.get("results").and_then(|v| v.as_array()) {
        for item in results.iter().take(8) {
            let score = item
                .get("score")
                .and_then(|s| s.as_f64())
                .map(|s| (s * 100.0).clamp(0.0, 100.0) as u8)
                .unwrap_or(0);

            if let Some(recordings) = item.get("recordings").and_then(|v| v.as_array()) {
                for rec in recordings.iter().take(2) {
                    let id = rec.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
                    let artist = rec
                        .get("artists")
                        .and_then(|a| a.as_array())
                        .and_then(|a| a.first())
                        .and_then(|a| a.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown Artist")
                        .to_string();
                    let album = rec
                        .get("releasegroups")
                        .and_then(|a| a.as_array())
                        .and_then(|a| a.first())
                        .and_then(|g| g.get("title"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown Album")
                        .to_string();
                    let year = rec
                        .get("releasegroups")
                        .and_then(|a| a.as_array())
                        .and_then(|a| a.first())
                        .and_then(|g| g.get("first-release-date"))
                        .and_then(|v| v.as_str())
                        .map(|d| d.chars().take(4).collect::<String>())
                        .unwrap_or_default();

                    out.push(AutoTagCandidate { id, title, artist, album, year, score });
                }
            }
        }
    }

    Ok(out)
}

pub async fn musicbrainz_search(query: &str) -> Result<Vec<AutoTagCandidate>, BoxError> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .user_agent("AudiophileAce/0.1 (musicbrainz search)")
        .build()?;

    let resp = client
        .get("https://musicbrainz.org/ws/2/recording")
        .query(&[
            ("query", q),
            ("fmt", "json"),
            ("limit", "12"),
        ])
        .send()
        .await?
        .error_for_status()?;

    let json: serde_json::Value = resp.json().await?;
    let mut out = Vec::new();

    if let Some(recs) = json.get("recordings").and_then(|v| v.as_array()) {
        for rec in recs.iter().take(12) {
            let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
            let artist = rec
                .get("artist-credit")
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .and_then(|a| a.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Artist")
                .to_string();

            let release = rec
                .get("releases")
                .and_then(|r| r.as_array())
                .and_then(|r| r.first());

            let album = release
                .and_then(|r| r.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Album")
                .to_string();

            let year = release
                .and_then(|r| r.get("date"))
                .and_then(|v| v.as_str())
                .map(|d| d.chars().take(4).collect::<String>())
                .unwrap_or_default();

            let base_score = rec
                .get("score")
                .and_then(|v| v.as_str())
                .and_then(|v| v.parse::<u8>().ok())
                .unwrap_or(0);

            let lower_q = q.to_lowercase();
            let mut confidence = base_score as i32;
            if title.to_lowercase().contains(&lower_q) {
                confidence += 5;
            }
            if artist.to_lowercase().contains(&lower_q) {
                confidence += 3;
            }

            out.push(AutoTagCandidate {
                id: release
                    .and_then(|r| r.get("id"))
                    .and_then(|v| v.as_str())
                    .or_else(|| rec.get("id").and_then(|v| v.as_str()))
                    .unwrap_or_default()
                    .to_string(),
                title,
                artist,
                album,
                year,
                score: confidence.clamp(0, 100) as u8,
            });
        }
    }

    Ok(out)
}

pub async fn fetch_cover_art_to_temp(release_mbid: &str) -> Result<String, BoxError> {
    let client = reqwest::Client::builder()
        .user_agent("AudiophileAce/0.1 (cover art archive)")
        .build()?;

    let url = format!("https://coverartarchive.org/release/{release_mbid}/front");
    let resp = client.get(url).send().await?.error_for_status()?;

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_lowercase();

    let ext = if content_type.contains("png") { "png" } else { "jpg" };
    let bytes = resp.bytes().await?;

    let temp_path = std::env::temp_dir().join(format!("ace-cover-{release_mbid}.{ext}"));
    std::fs::write(&temp_path, &bytes)?;

    Ok(temp_path.to_string_lossy().into_owned())
}
