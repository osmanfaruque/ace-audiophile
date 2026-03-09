# Platform: Windows Desktop

> **Phase A** — see [phase-A.md](phase-A.md) for full task hierarchy.

## Overview

The Windows desktop app bundles the Next.js static frontend inside a **Tauri v2** shell with **WebView2**.  
Rust acts as a thin FFI bridge; all audio processing lives in the shared C++ engine loaded as `ace_engine.dll`.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Shell | Tauri v2 (Rust + WebView2) |
| Frontend | Next.js 15 static export (`output: 'export'`) |
| Audio engine | C++20 shared library (`ace_engine.dll`) |
| Audio output | WASAPI exclusive mode |
| System media | SMTC (System Media Transport Controls) |
| IPC | Tauri `invoke()` + `emit()` events |

---

## Window Configuration

- **Frameless** window (`decorations: false`, `transparent: true`) — custom title bar in React
- Minimum size: 900 × 600 px, default: 1280 × 800 px
- Tauri drag region: `.tauri-drag-region` CSS class on header bar

---

## Audio Architecture (WASAPI)

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

- Enumerate endpoints via `IMMDeviceEnumerator` → Phase A1.2.1
- `AUDCLNT_SHAREMODE_EXCLUSIVE` event-driven → Phase A1.2.2
- Format negotiation (native SR / bit-depth) → Phase A1.2.3
- Shared-mode fallback → Phase A1.2.4
- Hot-plug via `IMMNotificationClient` → Phase A1.2.5

---

## DSP Chain (shared with all platforms)

```
Decoder ──► Pre-amp ──► 60-band PEQ ──► Crossfeed ──► Resampler ──► Dither ──► Output
```

All stages in `packages/audio-engine/src/dsp/`. See Phase A1.3.

---

## IPC Events (frontend ← engine)

| Event | Payload | Rate | Phase |
|---|---|---|---|
| `ace://fft-frame` | `FftFrame` (2048 bins × 2 ch) | ~60 Hz | A2.3.1 |
| `ace://level-meter` | `LevelMeter` (peak + RMS + LUFS) | ~30 Hz | A2.3.2 |
| `ace://position-update` | `{ position_ms }` | ~10 Hz | A2.3.3 |
| `ace://track-change` | `AudioTrack` | on boundary | A2.3.4 |
| `ace://engine-error` | `{ code, message }` | on error | A2.3.5 |

---

## Packaging

| Format | Tool |
|---|---|
| NSIS installer + MSI | `pnpm tauri build` |

Code signing: `tauri.conf.json > bundle.signing`.

---

## Paths

| Purpose | Path |
|---|---|
| Album art cache | `%APPDATA%/ace/art/` |
| Qobuz offline cache | `%APPDATA%/ace/cache/` |
| SQLite database | `%APPDATA%/ace/ace.db` |
| Config (Zustand persist) | `%APPDATA%/ace/config.json` |

---

## Capabilities

Tauri capability file: `apps/desktop/src-tauri/capabilities/main.json`  
Granted permissions: `shell:open`, `dialog:open`, `fs:read`, `notification:default`
