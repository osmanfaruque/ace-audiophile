# Phase 3 — Advanced Features

## Goal

Implement all analysis, diagnostic, and personalisation tools that differentiate Audiophile Ace from generic players.

---

## Scope

### 3.1 Analyzer View (Spectrogram + DR + File Inspector)

- [ ] **Per-channel spectrogram** — real-time STFT with WebGL (`regl`) heat-map  
  L channel: blue-green palette; R channel: orange-red palette; mid/side toggle
- [ ] **Dynamic Range meter** — EBU R128 LUFS + DR score (compatible with DR Database)
- [ ] **File binary inspector** — hex dump + container structure tree (RIFF chunks for WAV, IFF for AIFF, ID3 frames for MP3, Vorbis comment blocks for FLAC)
- [ ] **Fake hi-res detector** — bit-depth histogram analysis + spectral ceiling check
- [ ] **Lossy transcode detector** — spectral cutoff fingerprint + codec chain sniffing

### 3.2 File Analysis Result Page

After `ace_analyze_file()` completes, display a **Verdict Card**:

```
┌──────────────────────────────────────────────┐
│  track.flac                                  │
│  ─────────────────────────────────────────── │
│  Codec: FLAC 24-bit / 96 kHz  Stereo         │
│  Duration: 4:32   DR: 12   LUFS: −14.3       │
│  True Peak: −0.3 dBTP                        │
│  ─────────────────────────────────────────── │
│  ⚠ Effective bit depth: 16  (padded to 24)   │
│  ✓ No lossy transcode detected               │
└──────────────────────────────────────────────┘
```

### 3.3 ABX Blind Test View

- [ ] Load two files (A and B) or two EQ presets
- [ ] Randomised X presentation; user clicks A or B
- [ ] Session records all trials: timestamp, choice, correct, reaction time
- [ ] Statistical confidence display: binomial p-value, % correct
- [ ] Export session as JSON / CSV

### 3.4 Gear Matching View (Auto-EQ)

- [ ] Import frequency-response CSV (from AutoEQ database / REW export)
- [ ] Target curve selector: Harman 2018, Diffuse Field, Free Field, Flat, custom
- [ ] Auto-generate 60-band PEQ correction to match target
- [ ] Preview: overlay measured FR vs target vs corrected
- [ ] One-click apply to active EQ preset

### 3.5 Metadata Auto-Tagger

- [ ] AcoustID fingerprinting via `chromaprint` (C++ integration)
- [ ] MusicBrainz lookup for track/release/artist metadata
- [ ] Cover art fetching (Cover Art Archive)
- [ ] Batch tagging with per-file review before write
- [ ] Write tags via libavformat (no external tagger binary)
- [ ] Supported: FLAC (Vorbis comment), MP3 (ID3v2.4), AAC/M4A (iTunes atoms)

### 3.6 Audio Recap (Listening Statistics)

- [ ] **Yearly recap** (Spotify Wrapped style) — top artists, albums, genres, total hours
  - Generated on December 1 each year from listen log
- [ ] **Real-time stats** — session listen time, skips, repeat count, peak listening hour
- [ ] **Listening log** — SQLite table `listening_events (track_id, started_at, ended_at, completed)`
- [ ] **Charts** — bar (top artists), calendar heatmap (listen density), donut (genre split)
- [ ] Share card: PNG export of recap summary

### 3.7 Mastering Comparison

- [ ] Load two versions of the same track (e.g. 1994 CD vs 2016 remaster)
- [ ] Time-align automatically (cross-correlation)
- [ ] Show DR / LUFS / True Peak side-by-side
- [ ] Overlay spectral difference (colour-coded deviation map)

### 3.8 Auto-Update

- [ ] Tauri updater plugin configured for GitHub Releases
- [ ] Check for updates on startup (once per day, non-blocking)
- [ ] Release notes shown in Settings → About before update

---

## Deliverables

1. Spectrogram WebGL renders at 60 fps with no jank on 24/96 FLAC
2. Fake hi-res detector correctly flags known up-sampled test files
3. ABX session correctly computes binomial p-value
4. Auto-EQ imports an AutoEQ CSV and generates a 60-band EQ that brings measured FR within ±1 dB of Harman target (simulated)
5. Metadata tagger writes correct Vorbis comments to a FLAC without corruption
6. Yearly recap generates a shareable card PNG

---

## Dependencies to Add

```bash
# C++
# chromaprint (AcoustID) — CMakeLists FetchContent or system lib
# KissFFT — for Spectrogram (lightweight, no GPL)

# TypeScript
pnpm --filter @ace/ui add d3 @visx/shape html-to-image
```

---

## Performance Targets

| Feature | Target |
|---|---|
| Spectrogram update rate | 60 fps (16 ms budget) |
| File analysis (1 min FLAC) | < 3 s on mid-range CPU |
| Auto-EQ computation | < 500 ms |
| Tagger batch (100 files) | < 30 s on HDD |
| Recap generation | < 2 s |
