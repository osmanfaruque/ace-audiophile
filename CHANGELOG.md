# Changelog

All notable changes to Audiophile Ace are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
task IDs reference [phase-A.md](docs/phase-A.md).

---

## [Unreleased]

### Phase A — Windows Desktop (In Progress)

#### A8 — Auto-EQ
- `db3fcfc` **A8.4** — Integrate auto-eq compute, overlay apply, and local-only toggle
- `7cf4e5e` **A8.3** — C++ AutoEQ least-squares correction fitter
- `c1b5239` **A8.2** — Target curve library and drawable custom curve
- `5ee40d0` **A8.1** — FR import parsers and log-grid interpolation

#### A7 — Analyzer + ABX
- `baa6ec2` **A7.4** — Mastering comparison with alignment and spectral delta
- `ce9b136` **A7.3.1–A7.3.2** — Wire AnalyzerView to real analysis API
- `779f5a4` **A7.2.1** — BS.1770 LUFS and DR analysis
- `6f897ed` **A7.1** — Extend STFT engine and spectrogram channel modes

#### A6 — RadioView
- `be9afc9` **A6.5.1** — SMTC radio metadata on lock screen
- `3d4bc49` **A6.4** — RadioView station grid and filters
- `258245f` **A6.3.1** — Radio stations persistence for favorites and recents
- `324e59c` **A6.2** — Radio browser API commands and client wiring
- `bc37a83` **A6.1** — Stream protocol parser and HLS stitcher

#### A5 — Database (SQLite)
- `6f75026` **A5.3.1–9** — Wire playlists, library, recap and ratings to SQLite
- `8682cc9` **A5.2.1–2** — Schema migration versioning and full DB JSON export
- `e2d5d28` **A5.1.1–7** — SQLite schema tables, indexes, and FTS wiring

#### A4 — File Scanning + Metadata
- `abd9f5b` **A4.3.2–4** — AcoustID lookup, MusicBrainz scoring, and cover-art embed
- `a731daf` **A4.3.1** — Tag write-back: real metadata save pipeline (C++/Rust/UI)
- `84ea342` **A4.2** — Metadata extraction: TagLib-based tags and album-art cache
- `379af7e` **A4.1** — Folder scanner: walkdir recursive scan, notify watcher, progress bar

#### A3 — App/UI + System Integration
- `0d94f94` **A3.4** — Dual UI mode: Elegant/Technical theming + mode switcher
- `8a37bcf` **A3.3** — View wiring: transport, EQ, SMTC, preset bank, DSP, level meter
- `2704cbf` **A3.1–A3.2** — Wire audioEngine invoke calls + event listeners to Zustand stores

#### A2 — Rust Bridge IPC
- `465c64a` **A2.4.1–2** — AppError enum with JSON serialization
- `4bd7a39` **A2.3.1–5** — Event emitters: FFT@60Hz, level@30Hz, position@10Hz, track-change, error
- `471cf99` **A2.2.1–10** — Tauri commands wired to C++ engine FFI
- `4c01e6d` **A2.1.1–3** — libloading crate, DLL path resolution, engine init setup hook

#### A1 — C++ Engine Wiring
- `c4d5bd4` **A1.5.1–3** — Google Test unit tests for decoder, PEQ, WASAPI
- `342405d` **A1.3.9–11** — Convolver, channel mixer, crossfade engine
- `257322b` **A1.3.8** — Brickwall look-ahead limiter + anti-clip guard
- `66429b5` **A1.3.7** — ReplayGain pipeline: track/album mode with true-peak limiter
- `c8ec62a` **A1.3.6** — Virtual surround spatializer: M/S widening + Haas delay
- `10172b7` **A1.3.5** — TPDF dither + 2nd-order F-weighted noise shaping
- `07d0c7f` **A1.3.4** — Polyphase resampler: libsoxr VHQ integration
- `7e1a140` **A1.3.3** — Crossfeed: Bauer BS2B stereo-to-binaural
- `d01ae2c` **A1.3.2** — PreAmp: digital gain stage (±20 dB) with clip detection
- `f6c1e00` **A1.3.1** — 60-band PEQ: Audio EQ Cookbook biquad TDF-II, 8 filter types
- `55e4aaa` **A1.4.1–4** — Flat C API: ace_open_file, ace_set_eq_band, KissFFT STFT
- `503cd3b` **A1.2.5–6** — IMMNotificationClient hot-plug + bit-perfect verification
- `b9466c9` **A1.2.3–4** — Format negotiation + shared-mode fallback
- `df3dca3` **A1.2.2** — WASAPI exclusive event-driven render loop with SPSC ring buffer
- `e608c45` **A1.2.1** — IMMDeviceEnumerator WASAPI endpoint enumeration
- `554a174` **A1.1.2–4** — Full decode pipeline, DSD DoP, gapless pre-buffer
- `295fb98` **A1.1.1** — CMake FetchContent and system FFmpeg detection

---

## [0.0.1] — Pre-Phase A

### Added
- `662ff9a` Initial project scaffold — monorepo, types, Next.js UI, audio engine bridge
- `fc9c936` Tauri v2 apps, C++ engine skeleton, docs, icons
- `63b11a3` Complete Phase 1 UI — all 11 views implemented
- `d3fddb1` Commit message convention defined in index

### Infrastructure
- `ca72d6e` Platform phase docs and hierarchy finalized
- `4c3e927` Strict ascending execution order enforced in phase A
- `384f357` Desktop platform and workflow docs refactored
