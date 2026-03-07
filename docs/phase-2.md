# Phase 2 — Full Player UI + Streaming

## Goal

Complete all primary UI views, implement streaming (Qobuz), add MPRIS2 / system integration, and ship the first distributable binary.

---

## Scope

### 2.1 Dual UI Modes

- [ ] **Beautiful mode** — inspired by HiBy/UAPP; large album art, frosted glass cards, animated spectrum bars, `#7c6aff` accent
- [ ] **Techie mode** — inspired by Symphonium; monospace type, oscilloscope-style waveform, `#00d4ff` cyan accent, information-dense layout
- [ ] Mode toggle persisted to `ace-app-prefs` via Zustand persist
- [ ] Smooth animated transitions between modes (`framer-motion` layout animations)

### 2.2 Equalizer View

- [ ] 60-band PEQ graph — interactive drag handles on each band dot
- [ ] Frequency response curve drawn in real time (`<canvas>` + requestAnimationFrame)
- [ ] Preset selector (built-in: Flat, Bass Boost, V-Shape, Harman, Vocal)
- [ ] Preset save / rename / delete (stored in dspStore + localStorage)
- [ ] Per-band lock toggle
- [ ] Pre-amp slider (−20 … +20 dB) with auto-gain on clip

### 2.3 Albums / Artists Views

- [ ] Virtual-scroll grid (react-virtual) for 50 k+ album libraries
- [ ] Album detail page — track list, disc grouping, embedded art
- [ ] Artist page — discography sorted by year, genres
- [ ] Search: debounced full-text across title / artist / album / tags

### 2.4 Streaming — Qobuz

- [ ] OAuth2 PKCE flow in Tauri shell (`tauri-plugin-oauth`)
- [ ] Qobuz API client: `/catalog/search`, `/track/get`, `/track/getFileUrl`
- [ ] Unified `AudioTrack` type — local and streaming tracks treated identically
- [ ] Offline cache: download FLAC to `$APPDATA/ace/cache/` (configurable quota)
- [ ] Stream quality selector: MP3 320, FLAC 16/44, Hi-Res 24/192

### 2.5 System Integration

- [ ] **MPRIS2** D-Bus interface (Linux) — media keys, desktop widget, Now Playing
- [ ] **Windows System Media Transport Controls** — thumbnail toolbar, lock screen
- [ ] **macOS Now Playing** — `MPNowPlayingInfoCenter`
- [ ] **Android Media Session** — notification player controls

### 2.6 Hot-plug Device Detection

- [ ] udev monitor (Linux), `IMMNotificationClient` (Windows), `AVAudioSessionRouteChange` (Android)
- [ ] Auto-switch output on device connect/disconnect
- [ ] Toast notification on device change

---

## Deliverables

1. Both UI modes fully implemented, no placeholder views remaining
2. Qobuz streaming plays a Hi-Res track end-to-end
3. MPRIS2 tested with GNOME Shell media indicator
4. Windows SMTC shows album art on lock screen
5. All 3 platform builds pass `pnpm tauri build`

---

## Dependencies to Add

```bash
pnpm --filter @ace/ui add @tanstack/react-virtual react-hook-form zod
pnpm --filter @ace/desktop add tauri-plugin-oauth
```

---

## Breaking Changes from Phase 1

- `AppView` enum gains `albums`, `artists` (already in store, just needs views implemented)
- `PlaybackStore.queue` item shape unchanged — streaming tracks use `uri` field with `qobuz://` scheme
