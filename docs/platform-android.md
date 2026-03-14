# Platform: Android

> **Phase B** — see [phase-B.md](phase-B.md) for full task hierarchy.

## Overview

The Android platform uses a **Kotlin-native app** (Jetpack Compose + Android framework components).  
The shared C++ audio engine (`ace_engine`) is compiled as an `.so` with the Android NDK and loaded via JNI.

---

## Technology Stack

| Layer | Technology |
|---|---|
| App | Kotlin + Android Gradle Plugin |
| UI | Jetpack Compose + Navigation |
| Audio engine | C++20 `.so` (Android NDK r26) |
| Audio output | **Oboe** library (AAudio / OpenSL ES) |
| USB audio | Android USB Audio Class 2.0 via `UsbManager` |
| Bridge | JNI `external` calls + Kotlin Flow event bridge |

---

## Architecture

```
┌──────────────────────────────────────────┐
│  Kotlin UI (Compose)                      │
│  ViewModel / Flow ─────────────────────►  │
│                        JNI bridge         │
│                 (Kotlin `external`)       │
│                              │            │
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
| APK (debug) | `./gradlew :app:assembleDebug` |
| APK (release) | `./gradlew :app:assembleRelease` |
| AAB | `./gradlew :app:bundleRelease` (Play Store) |

Minimum SDK: **Android 24** (7.0 Nougat) — required for AAudio; Oboe falls back on older.  
Target SDK: 35 (Android 15).

---

## Development Workflow

```bash
# Build and install debug app
./gradlew :app:installDebug

# Or launch from Android Studio
```

For profiling and optimization, use Android Studio Profiler + `adb logcat` + `systrace`.

---

## Permissions (`AndroidManifest.xml`)

```xml
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-feature android:name="android.hardware.usb.host" android:required="false" />
```

Use `READ_EXTERNAL_STORAGE` only as legacy fallback for API 24-32.

---

## Paths

| Purpose | Path |
|---|---|
| Album art cache | `getExternalFilesDir()/ace/art/` |
| Qobuz offline cache | `getExternalFilesDir()/ace/cache/` |
| SQLite database | `getDatabasePath("ace.db")` |

---

## Phase B Cross-References

| Feature | Phase Task |
|---|---|
| NDK cross-compilation | B1.1 |
| Oboe output backend | B1.2 |
| JNI/FFI bridge | B1.3 |
| Android MediaSession | B3.2.1 |
| READ_MEDIA_AUDIO permission | B4.1.1 |
| ForegroundService (radio) | B6.3.1 |
| OAuth2 Custom Tab (Qobuz) | B9.1.1 |
| Android Auto | B9.4.1 |

---

## Capabilities

No Tauri capability file is used in Kotlin-native Android mode.  
Permissions and services are managed via `AndroidManifest.xml`, runtime permission flow, and foreground service declarations.
