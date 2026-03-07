# Phase 1 — Audio Engine Core

## Goal

Deliver a working bit-perfect audio player on all three platforms with a functional DSP chain, driven by the C++ engine.  
The UI is minimal (player view + basic library), but playback quality must be production-grade.

---

## Scope

### 1.1 C++ Audio Engine (`packages/audio-engine`)

- [ ] **Decoder** — integrate libavcodec (FFmpeg) for FLAC, WAV, AIFF, MP3, AAC, Opus, DSF, DFF
- [ ] **Platform output backends**
  - Windows: WASAPI exclusive mode (`WASAPIOutput.cpp`)
  - macOS: CoreAudio hog-mode (`CoreAudioOutput.cpp`)
  - Linux: ALSA hw direct (`ALSAOutput.cpp`)
  - Android: Oboe AAudio (`OboeOutput.cpp`)
- [ ] **60-band parametric EQ** (`PEQ.cpp`) — biquad IIR, transposed Direct Form II
- [ ] **Pre-amp** — digital gain stage with clip detection
- [ ] **Resampler** — SoX-quality polyphase (`Resampler.cpp`)
- [ ] **Dither** — TPDF + noise shaping (`Dither.cpp`)
- [ ] **Flat C API** (`include/ace_engine.h`) — FFI-safe, no C++ types in ABI

### 1.2 Tauri Rust Bridge

- [ ] Load `ace_engine` dynamic library at startup via `libloading`
- [ ] Map all 14 Tauri commands (`commands.rs`) to real engine calls
- [ ] Emit `ace://fft-frame` and `ace://level-meter` from audio thread at 60 Hz
- [ ] Emit `ace://position-update` at 10 Hz
- [ ] Graceful error propagation via `ace://engine-error`

### 1.3 Frontend — Player View

- [ ] Transport controls (play/pause/stop/prev/next/seek)
- [ ] Real-time waveform / level meter bars (WebGL via `regl`)
- [ ] Album art with dominant-colour extraction (`node-vibrant`)
- [ ] Queue management (drag-to-reorder via `@dnd-kit`)
- [ ] Volume knob with scroll-wheel support

### 1.4 Frontend — Library View

- [ ] File system scan (Tauri `fs` plugin)
- [ ] SQLite-backed library index (via Tauri SQL plugin, Phase 1.5)
- [ ] Grid / list toggle
- [ ] Sort by: artist / album / year / date added

---

## Deliverables

1. `libace_engine.so` / `ace_engine.dll` loads and plays a FLAC file end-to-end
2. WASAPI exclusive mode confirmed with REW or ASIO4ALL check
3. 60-band EQ applies without audible glitches or denormals
4. Android: Oboe AAudio path confirmed with `adb logcat`
5. All pnpm / cargo build commands pass on all three CI platforms

---

## Dependencies to Add

```toml
# apps/*/src-tauri/Cargo.toml
libloading = "0.8"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

```json
// packages/ui — already in package.json
"@dnd-kit/core": "^6",
"@dnd-kit/sortable": "^8"
```

---

## Testing

- Unit: C++ — Google Test (`CMakeLists.txt` option `ACE_BUILD_TESTS`)
- Integration: play 30 s of a known FLAC, capture output with loopback, compare hash
- UI: Playwright E2E smoke test (player loads, play button starts position update)
