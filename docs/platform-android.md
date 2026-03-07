# Platform: Android

## Overview

The Android platform uses **Tauri v2 Mobile** to wrap the same Next.js frontend in a native Android `Activity`.  
The C++ audio engine (`ace_engine`) is compiled as an `.so` with the Android NDK and loaded via JNI/FFI.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Shell | Tauri v2 mobile (`tauri::mobile_entry_point`) |
| Frontend | Next.js 15 static export served from assets |
| Audio engine | C++20 `.so` (Android NDK r26) |
| Audio output | **Oboe** library (AAudio / OpenSL ES) |
| USB audio | Android USB Audio Class 2.0 via `UsbManager` |
| IPC | Tauri `invoke()` + `emit()` (same API as desktop) |

---

## Architecture

```
┌──────────────────────────────────────────┐
│  Next.js UI  (Android WebView / Chroma)  │
│  invoke("ace_play") ──────────────────►  │
│                          Rust bridge     │
│                          (lib.rs)        │
│                              │ JNI/FFI   │
│                      libace_engine.so    │
│                          (C++ / Oboe)    │
│                              │           │
│                       Oboe AudioStream   │
│                    (AAudio low-latency)  │
└──────────────────────────────────────────┘
```

---

## Audio Subsystem (Oboe)

- `oboe::AudioStreamBuilder` → prefer AAudio, fall back to OpenSL ES
- Performance mode: `PerformanceModeType::LowLatency`
- Sharing mode: `SharingMode::Exclusive`
- Format: `AudioFormat::Float`, stereo
- Sample rate: native device rate (commonly 48 kHz; resampler handles 44.1 kHz content)

### USB DAC Support

1. Detect `UsbDevice` via `UsbManager.getDeviceList()`
2. Request permission via `PendingIntent` broadcast
3. Route audio to USB audio class device using Android's `AudioDeviceInfo` routing API
4. For bit-perfect: use `AudioTrack` with `AUDIO_OUTPUT_FLAG_DIRECT` where supported

---

## Build Targets

| Format | Notes |
|---|---|
| APK (debug) | `pnpm tauri android build --debug` |
| APK (release) | `pnpm tauri android build` |
| AAB | `pnpm tauri android build --apk false` (Play Store) |

Minimum SDK: **Android 24** (7.0 Nougat) — required for AAudio; Oboe falls back on older.  
Target SDK: 35 (Android 15).

---

## Development Workflow

```bash
# Start dev server
pnpm --filter @ace/ui dev

# In second terminal — run on connected device or emulator
cd apps/android
pnpm tauri android dev
```

Dev URL: `http://10.0.2.2:3000` (emulator localhost alias configured in `tauri.conf.json`).  
For physical device: set `devUrl` to LAN IP of dev machine.

---

## Permissions (`AndroidManifest.xml`)

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.USB_PERMISSION" />
<uses-feature android:name="android.hardware.usb.host" android:required="false" />
```

---

## Capabilities

Tauri capability file: `apps/android/src-tauri/capabilities/main.json`  
Granted permissions: `shell:open`, `dialog:open`, `fs:read`  
(No `notification` plugin — uses Android native notifications instead.)
