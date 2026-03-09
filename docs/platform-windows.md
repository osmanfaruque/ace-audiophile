# Platform: Windows Desktop

> **Phase A** — see [phase-A.md](phase-A.md) for full task hierarchy.

## Overview

The Windows desktop app bundles the Next.js static frontend inside a **Tauri v2** shell with **WebView2**.  
Rust acts as a thin FFI bridge; all audio processing lives in the shared C++ engine loaded as `ace_engine.dll`.

Windows scope is defined by **Phase A** (`A1`-`A9`), including dual UI modes, analyzer verdict engine, and streaming/provider-readiness.

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
- USB DAC direct-path verification (bit-perfect test tone hash) → Phase A1.2.6

---

## DSP Modules (shared with all platforms)

```
Pre-amp | 60-band PEQ | Crossfeed | Resampler | Dither/Noise Shaping |
Virtual Surround | ReplayGain | Limiter | Convolver | Channel Mixer | Crossfade
```

All stages live in `packages/audio-engine/src/dsp/`. See Phase `A1.3.1` to `A1.3.11`.

---

## Phase A Alignment Map

| Windows capability | Phase A reference |
|---|---|
| Engine + WASAPI exclusive + USB DAC verification | `A1.1` to `A1.2.6` |
| Flat C API + FFT frame API | `A1.4.1` to `A1.4.4` |
| Rust IPC commands/events/errors | `A2.2` to `A2.4` |
| Real frontend wiring + dual UI mode | `A3.1` to `A3.4` |
| Scanning, tags, MusicBrainz, AutoTag | `A4.1` to `A4.3` |
| SQLite schema + recap/stats + metadata editor UI | `A5.1` to `A5.3` |
| Radio stream + Radio Browser + SMTC | `A6.1` to `A6.5` |
| Analyzer, ABX, mastering compare, automated verdict | `A7.1` to `A7.4` |
| Auto-EQ import/fit/apply | `A8.1` to `A8.4` |
| Qobuz + multi-service readiness | `A9.1` to `A9.8` |

---

## IPC Events (frontend ← engine)

| Event | Payload | Rate | Phase |
|---|---|---|---|
| `ace://fft-frame` | `FftFrame` (2048 bins × 2 ch) | ~60 Hz | A2.3.1 |
| `ace://level-meter` | `LevelMeter` (peak + RMS + LUFS + DR display feed) | ~30 Hz | A2.3.2, A3.3.7 |
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
