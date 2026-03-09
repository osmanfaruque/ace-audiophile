# Phase B — Android

> Second platform. Reuses shared C++ engine code from Phase A.  
> Focus: NDK cross-compilation, Oboe audio, touch UX, Android system integration.

---

## B1 — C++ Engine (NDK + Oboe)

### B1.1 NDK Cross-Compilation

- [ ] **B1.1.1** CMakeLists toolchain for `arm64-v8a` + `x86_64` (emulator)
- [ ] **B1.1.2** FFmpeg prebuilt `.so` for Android (or FetchContent NDK build)

### B1.2 Oboe Output Backend

- [ ] **B1.2.1** `AudioStreamBuilder` — prefer AAudio, fallback OpenSL ES
- [ ] **B1.2.2** `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY` + exclusive sharing
- [ ] **B1.2.3** USB DAC routing via `AudioDeviceInfo` API
- [ ] **B1.2.4** Sample rate negotiation (48 kHz device ↔ 44.1 kHz content)

### B1.3 JNI / FFI Bridge

- [ ] **B1.3.1** `JNI_OnLoad` bootstrap — register native methods
- [ ] **B1.3.2** Java → C++ forwarding for all `ace_*` API calls

### B1.4 Shared Code

- [ ] **B1.4.1** DSP chain — same as A1.3 (shared source, no fork)
- [ ] **B1.4.2** Flat C API — same `ace_engine.h` (shared headers)

---

## B2 — Rust Bridge (Mobile)

### B2.1 Entry Point

- [ ] **B2.1.1** `tauri::mobile_entry_point` in `lib.rs`
- [ ] **B2.1.2** Load `libace_engine.so` from APK native libs dir

### B2.2 Commands

- [ ] **B2.2.1** Same 14 commands as A2.2 (shared `commands.rs`)

### B2.3 Mobile Optimizations

- [ ] **B2.3.1** Battery-aware polling — `fft-frame` @ 30 Hz on battery, 60 Hz on charger
- [ ] **B2.3.2** Reduce `level-meter` to 15 Hz on battery

---

## B3 — Frontend Integration

### B3.1 Shared Code

- [ ] **B3.1.1** Same `audioEngine.ts` (shared with A3.1)
- [ ] **B3.1.2** Same event listeners (shared with A3.2)

### B3.2 Android System Integration

- [ ] **B3.2.1** Android `MediaSession` update on track change
- [ ] **B3.2.2** Media keys handling (Bluetooth headset buttons)
- [ ] **B3.2.3** Audio focus management (`AudioManager.requestAudioFocus`)

---

## B4 — File Scanning + Metadata

### B4.1 Android Permissions

- [ ] **B4.1.1** `READ_MEDIA_AUDIO` (Android 13+ / API 33)
- [ ] **B4.1.2** Legacy `READ_EXTERNAL_STORAGE` fallback (API 24–32)

### B4.2 Scanner

- [ ] **B4.2.1** `MediaStore` API supplemental scan for system-indexed media
- [ ] **B4.2.2** SAF (Storage Access Framework) for custom folders
- [ ] **B4.2.3** Same metadata extraction via C++ engine (shared A4.2)

### B4.3 Art Cache

- [ ] **B4.3.1** Album art → `getExternalFilesDir()/ace/art/` PNG cache

---

## B5 — Database

- [ ] **B5.1** Same SQLite schema as A5.1 (SQLite bundled in APK)
- [ ] **B5.2** Same migration system (A5.2)
- [ ] **B5.3** Same view wiring (A5.3)

---

## B6 — RadioView

### B6.1 Stream Protocol

- [ ] **B6.1.1** Shared C++ engine stream code from A6.1

### B6.2 Touch-Optimized UI

- [ ] **B6.2.1** Large station cards (swipe-to-favorite gesture)
- [ ] **B6.2.2** Portrait + landscape responsive layout
- [ ] **B6.2.3** Pull-to-refresh station list

### B6.3 Android Foreground Service

- [ ] **B6.3.1** `ForegroundService` for radio streaming (prevents kill)
- [ ] **B6.3.2** `MediaNotification` — play / stop / next-station buttons
- [ ] **B6.3.3** `WakeLock` for long listening sessions

---

## B7 — Analyzer + ABX

- [ ] **B7.1** Same C++ analysis functions as A7.2 (shared)
- [ ] **B7.2** Same Tauri command + AnalyzerView wiring (A7.3–A7.4)
- [ ] **B7.3** Touch-optimized ABX controls (larger tap targets)

---

## B8 — Auto-EQ

- [ ] **B8.1** Same C++ correction algorithm as A8.3 (shared)
- [ ] **B8.2** CSV import via Android file picker (SAF intent)
- [ ] **B8.3** Same GearView wiring (A8.4)

---

## B9 — Qobuz Streaming

### B9.1 Auth

- [ ] **B9.1.1** OAuth2 PKCE via Android Custom Tab (no localhost redirect)
- [ ] **B9.1.2** Token in Android Keystore (encrypted)
- [ ] **B9.1.3** Token refresh on expiry

### B9.2 Shared Code

- [ ] **B9.2.1** Same Qobuz API client as A9.2 (shared TypeScript)
- [ ] **B9.2.2** Same stream playback as A9.4 (shared C++)

### B9.3 Offline Cache

- [ ] **B9.3.1** Download → `getExternalFilesDir()/ace/cache/`
- [ ] **B9.3.2** Quota management + offline playback

### B9.4 Android-Specific

- [ ] **B9.4.1** Android Auto integration (streaming metadata)
- [ ] **B9.4.2** `MediaSession` for streaming tracks

---

## Deliverables (Phase B Complete)

1. APK plays FLAC via Oboe/AAudio on physical device
2. USB DAC routing confirmed (`adb logcat`)
3. Radio streams with notification controls
4. Library scan from device storage works
5. Qobuz streams with Android Auto metadata
