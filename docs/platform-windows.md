# Platform: Desktop (Windows · macOS)

## Overview

The desktop platform bundles the Next.js static frontend inside a **Tauri v2** shell.  
Rust acts exclusively as a thin FFI bridge; all audio heavy-lifting lives in the shared C++ engine (`packages/audio-engine`) loaded as a dynamic library (`ace_engine.dll` / `libace_engine.dylib`).

---

## Technology Stack

| Layer | Technology |
|---|---|
| Shell | Tauri v2 (Rust + WebView2 / WKWebView) |
| Frontend | Next.js 15 static export (`output: 'export'`) |
| Audio engine | C++20 shared library |
| Windows audio | WASAPI exclusive mode |
| macOS audio | CoreAudio hog-mode via AudioUnit |
| IPC | Tauri `invoke()` + `emit()` events |

---

## Window Configuration

- **Frameless** window (`decorations: false`, `transparent: true`) — custom title bar rendered in React
- Minimum size: 900 × 600 px, default launch: 1280 × 800 px
- Tauri drag region set via `.tauri-drag-region` CSS class on header bar
- macOS traffic-light buttons re-enabled via `window.traffic-light-position`

---

## Audio Subsystem — Windows (WASAPI)

```
┌──────────────────────────────────────────┐
│  Next.js UI  (WebView2)                  │
│  invoke("ace_play") ──────────────────►  │
│                          Rust bridge     │
│                          (commands.rs)   │
│                              │ FFI call  │
│                          ace_engine.dll  │
│                          (C++ / WASAPI)  │
│                              │           │
│                      IAudioClient        │
│                  (EXCLUSIVE mode)        │
│                          WaveFormat:     │
│                  32-bit float, native SR │
└──────────────────────────────────────────┘
```

- Enumerate endpoints via `IMMDeviceEnumerator`
- Open in `AUDCLNT_SHAREMODE_EXCLUSIVE` for bit-perfect output
- Fall back to shared mode if exclusive is denied
- Hot-plug notifications via `IMMNotificationClient`

## Audio Subsystem — macOS (CoreAudio)

- Enumerate via `AudioObjectGetPropertyData(kAudioHardwarePropertyDevices)`
- Set hog-mode: `kAudioDevicePropertyHogMode` → `getpid()`
- Feed via `AudioUnitSetProperty` render callback at native sample rate

---

## DSP Chain (shared with all platforms)

```
Decoder ──► Pre-amp ──► 60-band PEQ ──► Crossfeed ──► Resampler ──► Dither ──► Output
```

All stages implemented in `packages/audio-engine/src/dsp/`.  
The Rust bridge applies the DSP state atomically on every `ace_set_dsp_state` command.

---

## IPC Events (frontend ← engine)

| Event | Payload | Rate |
|---|---|---|
| `ace://fft-frame` | `FftFrame` (2048 bins × 2 ch) | ~60 Hz |
| `ace://level-meter` | `LevelMeter` (peak + RMS + LUFS) | ~30 Hz |
| `ace://position-update` | `{ position_ms }` | ~10 Hz |
| `ace://track-change` | `AudioTrack` | on track boundary |
| `ace://engine-error` | `{ code, message }` | on error |

---

## Packaging

| OS | Format | Tool |
|---|---|---|
| Windows | NSIS installer + MSI | `pnpm tauri build` |
| macOS | `.app` bundle + `.dmg` | `pnpm tauri build` |

Code signing: configured via `tauri.conf.json > bundle.signing`.  
Auto-update: Tauri updater plugin (Phase 3).

---

## Capabilities

Tauri capability file: `apps/desktop/src-tauri/capabilities/main.json`  
Granted permissions: `shell:open`, `dialog:open`, `fs:read`, `notification:default`
