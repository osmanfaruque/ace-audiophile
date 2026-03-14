use serde::{Deserialize, Serialize};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

const BASE_URL: &str = "https://de1.api.radio-browser.info";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RadioStation {
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RadioFacet {
    pub name: String,
    pub stationcount: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct StationSearchQuery {
    pub name: Option<String>,
    pub genre: Option<String>,
    pub country: Option<String>,
    pub limit: Option<u32>,
}

fn client() -> Result<reqwest::Client, BoxError> {
    Ok(reqwest::Client::builder()
        .user_agent("AudiophileAce/0.1 (radio browser)")
        .build()?)
}

pub async fn search_stations(query: StationSearchQuery) -> Result<Vec<RadioStation>, BoxError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);

    let mut params: Vec<(&str, String)> = vec![
        ("hidebroken", "true".to_string()),
        ("limit", limit.to_string()),
        ("order", "votes".to_string()),
        ("reverse", "true".to_string()),
    ];

    if let Some(v) = query.name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        params.push(("name", v));
    }
    if let Some(v) = query.genre.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        params.push(("tag", v));
    }
    if let Some(v) = query.country.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        params.push(("country", v));
    }

    let url = format!("{BASE_URL}/json/stations/search");
    let resp = client()?
        .get(url)
        .query(&params)
        .send()
        .await?
        .error_for_status()?;

    Ok(resp.json::<Vec<RadioStation>>().await?)
}

pub async fn get_tags() -> Result<Vec<RadioFacet>, BoxError> {
    let url = format!("{BASE_URL}/json/tags");
    let resp = client()?
        .get(url)
        .query(&[("hidebroken", "true"), ("order", "stationcount"), ("reverse", "true"), ("limit", "200")])
        .send()
        .await?
        .error_for_status()?;

    let mut rows = resp.json::<Vec<RadioFacet>>().await?;
    rows.retain(|r| !r.name.trim().is_empty());
    Ok(rows)
}

pub async fn get_countries() -> Result<Vec<RadioFacet>, BoxError> {
    let url = format!("{BASE_URL}/json/countries");
    let resp = client()?
        .get(url)
        .query(&[("hidebroken", "true"), ("order", "stationcount"), ("reverse", "true"), ("limit", "200")])
        .send()
        .await?
        .error_for_status()?;

    let mut rows = resp.json::<Vec<RadioFacet>>().await?;
    rows.retain(|r| !r.name.trim().is_empty());
    Ok(rows)
}

pub async fn report_station_click(stationuuid: &str) -> Result<(), BoxError> {
    let stationuuid = stationuuid.trim();
    if stationuuid.is_empty() {
        return Err("stationuuid is required".into());
    }

    let url = format!("{BASE_URL}/json/url/{stationuuid}");
    let _ = client()?
        .get(url)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}