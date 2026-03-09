# Phase A — Windows Desktop

> First platform. All core engine work happens here; B and C reuse shared C++ code.

---

## A1 — C++ Engine Wiring (FFmpeg + WASAPI + DSP)

### A1.1 FFmpeg Decoder

- [ ] **A1.1.1** CMake FetchContent / system FFmpeg detection
- [ ] **A1.1.2** `AVFormatContext` + `AVCodecContext` pipeline for: FLAC, WAV, AIFF, MP3, AAC, Opus
- [ ] **A1.1.3** DSD support (DSF / DFF) — DoP passthrough or native DSD
- [ ] **A1.1.4** Gapless decode — pre-buffer next track, seamless boundary crossing

### A1.2 WASAPI Output Backend

- [ ] **A1.2.1** `IMMDeviceEnumerator` endpoint enumeration → device list
- [ ] **A1.2.2** `AUDCLNT_SHAREMODE_EXCLUSIVE` event-driven render loop
- [ ] **A1.2.3** Format negotiation — match native sample rate / bit depth
- [ ] **A1.2.4** Shared-mode fallback when exclusive denied
- [ ] **A1.2.5** `IMMNotificationClient` hot-plug detection

### A1.3 DSP Chain

- [ ] **A1.3.1** 60-band PEQ — biquad IIR, Transposed Direct Form II
- [ ] **A1.3.2** Pre-amp — digital gain stage with clip detection
- [ ] **A1.3.3** Crossfeed — Bauer binaural stereo-to-stereo
- [ ] **A1.3.4** Polyphase resampler — libsoxr integration
- [ ] **A1.3.5** TPDF dither + noise shaping (16-bit / 24-bit output)

### A1.4 Flat C API (`ace_engine.h`)

- [ ] **A1.4.1** `ace_open_file`, `ace_play`, `ace_pause`, `ace_stop`, `ace_seek`
- [ ] **A1.4.2** `ace_set_volume`, `ace_set_eq_band`, `ace_set_dsp_state`
- [ ] **A1.4.3** `ace_get_position_ms`, `ace_analyze_file`
- [ ] **A1.4.4** `ace_get_fft_frame` — 2048 bins × 2 channels

### A1.5 Unit Tests (Google Test)

- [ ] **A1.5.1** Decoder: byte-correct FLAC output hash comparison
- [ ] **A1.5.2** PEQ: known frequency response verification (sweep signal)
- [ ] **A1.5.3** WASAPI exclusive mode confirmed (loopback capture)

---

## A2 — Rust Bridge IPC

### A2.1 Cargo Setup

- [ ] **A2.1.1** Add `libloading` crate to `apps/desktop/src-tauri/Cargo.toml`
- [ ] **A2.1.2** Dynamic library path resolution (`$APPDIR/ace_engine.dll`)
- [ ] **A2.1.3** Engine init on Tauri `setup` hook (load + `ace_init()`)

### A2.2 Tauri Commands (`commands.rs`)

- [ ] **A2.2.1** `ace_open_file(path: String) → Result<TrackInfo>`
- [ ] **A2.2.2** `ace_play()`, `ace_pause()`, `ace_stop()`
- [ ] **A2.2.3** `ace_seek(position_ms: u64)`
- [ ] **A2.2.4** `ace_set_volume(db: f32)`
- [ ] **A2.2.5** `ace_set_eq_band(band: u8, gain_db: f32, freq: f32, q: f32)`
- [ ] **A2.2.6** `ace_apply_dsp(state: DspStateJson)`
- [ ] **A2.2.7** `ace_get_devices() → Vec<AudioDevice>`
- [ ] **A2.2.8** `ace_set_device(device_id: String)`
- [ ] **A2.2.9** `ace_analyze_file(path: String) → AnalysisResult`
- [ ] **A2.2.10** `ace_scan_folder(path: String)` → triggers scan event stream

### A2.3 Event Emitters (audio thread → frontend)

- [ ] **A2.3.1** `ace://fft-frame` @ 60 Hz — `FftFrame` (2048 bins × 2 ch)
- [ ] **A2.3.2** `ace://level-meter` @ 30 Hz — peak + RMS + LUFS
- [ ] **A2.3.3** `ace://position-update` @ 10 Hz — `{ position_ms }`
- [ ] **A2.3.4** `ace://track-change` — on track boundary
- [ ] **A2.3.5** `ace://engine-error` — on fatal error

### A2.4 Error Handling

- [ ] **A2.4.1** `AppError` enum — `EngineLoad`, `Playback`, `DeviceNotFound`, `AnalysisFailed`
- [ ] **A2.4.2** `serde_json` serialization → frontend-consumable JSON

---

## A3 — Frontend Integration

### A3.1 `audioEngine.ts` — Real `invoke()` Calls

- [ ] **A3.1.1** `openFile`, `play`, `pause`, `stop`, `seek`
- [ ] **A3.1.2** `setVolume`, `setEqBand`, `applyDspState`
- [ ] **A3.1.3** `getDevices`, `setDevice`
- [ ] **A3.1.4** `analyzeFile` → `AnalysisResult`
- [ ] **A3.1.5** `scanFolder` → progress event stream

### A3.2 Event Listeners (AppShell)

- [ ] **A3.2.1** `fft-frame` → `dspStore.fftBins` (SpectrumBars, AnalyzerView)
- [ ] **A3.2.2** `position-update` → `playbackStore.positionMs` (SeekBar)
- [ ] **A3.2.3** `track-change` → `playbackStore.currentTrack` (PlayerView)
- [ ] **A3.2.4** `engine-error` → toast notification

### A3.3 View Wiring

- [ ] **A3.3.1** Transport controls (play/pause/stop/next/prev) → real playback
- [ ] **A3.3.2** EqualizerView drag → `ace_set_eq_band` per band
- [ ] **A3.3.3** SeekBar → `ace_seek`, VolumeSlider → `ace_set_volume`
- [ ] **A3.3.4** SMTC (System Media Transport Controls) update on track change

---

## A4 — File Scanning + Metadata

### A4.1 Folder Scanner (Rust)

- [ ] **A4.1.1** `tauri::fs::read_dir` recursive with audio extension filter
- [ ] **A4.1.2** `notify` crate file-system watcher for live folder changes
- [ ] **A4.1.3** Scan progress events → frontend progress bar in LibraryView

### A4.2 Metadata Extraction (TagLib via C++ engine)

- [ ] **A4.2.1** FLAC: Vorbis comments
- [ ] **A4.2.2** MP3: ID3v2.4
- [ ] **A4.2.3** AAC / M4A: iTunes atoms
- [ ] **A4.2.4** Embedded album art → `%APPDATA%/ace/art/` PNG cache

### A4.3 Integration

- [ ] **A4.3.1** LibraryView wired to real scan data (replace mock tracks)
- [ ] **A4.3.2** Album art displayed from cache in PlayerView

---

## A5 — Database (SQLite)

### A5.1 Schema (`tauri-plugin-sql`)

- [ ] **A5.1.1** `tracks` table — all `AudioTrack` fields indexed
- [ ] **A5.1.2** `albums`, `artists`, `genres` tables — normalized
- [ ] **A5.1.3** FTS5 virtual table for full-text search
- [ ] **A5.1.4** `playlists` + `playlist_tracks` (M3U export compatible)
- [ ] **A5.1.5** `ratings` (track_id, stars, timestamp)
- [ ] **A5.1.6** `listening_events` (track_id, started_at, ended_at, completed)
- [ ] **A5.1.7** `play_count` aggregate per track

### A5.2 Infrastructure

- [ ] **A5.2.1** Schema migration versioning (version table + up/down scripts)
- [ ] **A5.2.2** Full DB backup / export as JSON

### A5.3 View Wiring

- [ ] **A5.3.1** PlaylistsView CRUD → SQLite (replace Zustand-only)
- [ ] **A5.3.2** RecapView → real `listening_events` data
- [ ] **A5.3.3** PlayerView star ratings → persist to `ratings` table
- [ ] **A5.3.4** LibraryView sort / filter → SQL queries

---

## A6 — RadioView

### A6.1 Stream Protocol (C++ engine)

- [ ] **A6.1.1** HTTP ICY header parser (`Icy-MetaData`, `Icy-MetaInt`)
- [ ] **A6.1.2** Inline ICY metadata extraction (`StreamTitle`, `StreamUrl`)
- [ ] **A6.1.3** Reconnect-on-drop (3 retries, exponential backoff)
- [ ] **A6.1.4** HLS (M3U8) support
  - [ ] **A6.1.4.1** M3U8 playlist parser
  - [ ] **A6.1.4.2** Segment downloader + stitcher → decode pipeline

### A6.2 Radio Browser API (`api.radio-browser.info`)

- [ ] **A6.2.1** `/json/stations/search` — query by name, genre, country
- [ ] **A6.2.2** `/json/tags` + `/json/countries` — filter data
- [ ] **A6.2.3** Click-count reporting via `/json/url/{stationuuid}`

### A6.3 Persistence

- [ ] **A6.3.1** `radio_stations` SQLite table (favorites + recents)

### A6.4 UI (RadioView.tsx — replace stub)

- [ ] **A6.4.1** StationGrid — virtualized 4-col card layout with station logo
- [ ] **A6.4.2** NowPlayingBanner — ICY title + station metadata strip
- [ ] **A6.4.3** Search + filter bar (genre / language / bitrate / country)
- [ ] **A6.4.4** Sidebar tabs: Favorites | Recents | Browse by genre

### A6.5 System Integration

- [ ] **A6.5.1** SMTC — station name + ICY title on Windows lock screen

---

## A7 — Analyzer + ABX Real Implementation

### A7.1 FFT Engine (KissFFT — MIT license)

- [ ] **A7.1.1** STFT: Hann window, 50% overlap, 2048-point
- [ ] **A7.1.2** Per-channel spectrogram ring buffer

### A7.2 Analysis Functions (`ace_analyze_file`)

- [ ] **A7.2.1** EBU R128 LUFS (ITU-R BS.1770) + DR score
- [ ] **A7.2.2** True peak detection (4× oversampled)
- [ ] **A7.2.3** Fake hi-res detector
  - [ ] **A7.2.3.1** Bit-depth histogram analysis (effective vs stated)
  - [ ] **A7.2.3.2** Spectral ceiling check (high-freq energy threshold)
- [ ] **A7.2.4** Lossy transcode detector
  - [ ] **A7.2.4.1** Spectral cutoff fingerprint (15–20 kHz shelf)
  - [ ] **A7.2.4.2** Codec chain sniffing (container metadata)
- [ ] **A7.2.5** DC offset measurement (mean of all samples)
- [ ] **A7.2.6** Clipping detection (consecutive full-scale sample runs)

### A7.3 Integration

- [ ] **A7.3.1** `ace_analyze_file` Tauri command → `AnalysisResult` JSON
- [ ] **A7.3.2** AnalyzerView wired to real verdicts (replace mock data)
- [ ] **A7.3.3** Real-time spectrogram via `fft-frame` events → canvas heat-map
- [ ] **A7.3.4** ABX: sample-perfect A/B gapless switching
- [ ] **A7.3.5** Export analysis report as JSON

---

## A8 — Auto-EQ Real Implementation

### A8.1 FR Data Import

- [ ] **A8.1.1** AutoEQ CSV parser (frequency + SPL columns)
- [ ] **A8.1.2** REW `.txt` measurement export parser
- [ ] **A8.1.3** Validation + log-scale interpolation (1/24-octave grid)

### A8.2 Target Curve Library (built-in data)

- [ ] **A8.2.1** Harman 2018 In-Ear
- [ ] **A8.2.2** Harman 2019 Over-Ear
- [ ] **A8.2.3** Diffuse Field, Free Field
- [ ] **A8.2.4** Custom drawable target curve in GearView SVG

### A8.3 Correction Algorithm (C++)

- [ ] **A8.3.1** Deviation = measured − target at each frequency point
- [ ] **A8.3.2** Fit 60-band PEQ via least-squares optimization
- [ ] **A8.3.3** ±12 dB per-band gain clamp
- [ ] **A8.3.4** Smoothing pass — prevent narrow notches < 0.1 octave

### A8.4 Integration

- [ ] **A8.4.1** CSV import → compute correction → overlay in FR chart
- [ ] **A8.4.2** "Apply to PEQ" → `dspStore` + `ace_set_eq_band` for all 60 bands

---

## A9 — Qobuz Streaming

### A9.1 OAuth2 PKCE Auth (Windows)

- [ ] **A9.1.1** `tauri-plugin-oauth` localhost redirect callback
- [ ] **A9.1.2** Token stored in Windows Credential Manager (`tauri-plugin-keychain`)
- [ ] **A9.1.3** Automatic token refresh on expiry

### A9.2 Qobuz API Client (TypeScript)

- [ ] **A9.2.1** `/catalog/search` — artist, album, track search
- [ ] **A9.2.2** `/track/getFileUrl` — authenticated stream URL
- [ ] **A9.2.3** `/user/getFavoriteAlbums` + `getTracks`
- [ ] **A9.2.4** Rate limiting + retry with exponential backoff

### A9.3 Unified AudioTrack

- [ ] **A9.3.1** `qobuz://` URI scheme in `filePath` field
- [ ] **A9.3.2** Streaming and local tracks handled identically in queue

### A9.4 Stream Playback (C++ engine)

- [ ] **A9.4.1** `libavformat` `AVIOContext` HTTP streaming input
- [ ] **A9.4.2** 3-second pre-buffer management

### A9.5 Offline Cache

- [ ] **A9.5.1** Download FLAC → `%APPDATA%/ace/cache/`
- [ ] **A9.5.2** Configurable quota in SettingsView
- [ ] **A9.5.3** Offline playback from cache (automatic fallback)

### A9.6 UI

- [ ] **A9.6.1** Streaming tab in LibraryView (or dedicated StreamingView)
- [ ] **A9.6.2** Quality selector (MP3 320 / FLAC 16-44 / Hi-Res 24-192)

### A9.7 System Integration

- [ ] **A9.7.1** SMTC streaming track metadata (title, artist, album art on lock screen)

---

## Deliverables (Phase A Complete)

1. `ace_engine.dll` loads and plays FLAC end-to-end via WASAPI exclusive
2. 60-band EQ applies without audible glitches
3. All 14 Tauri IPC commands operational
4. Library scan → SQLite → LibraryView renders real data
5. RadioView plays ICY streams with metadata display
6. Analyzer produces real LUFS/DR/hi-res verdicts
7. Auto-EQ imports CSV, computes correction, applies to PEQ
8. Qobuz streams Hi-Res track end-to-end
9. All views wired to real data (no mock data remaining)
