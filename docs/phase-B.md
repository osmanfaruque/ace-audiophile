# Phase B — Android

> Second platform. Reuses shared C++ engine code from Phase A.  
> Focus: Kotlin-native Android app, NDK/Oboe audio, touch UX, Android system integration, and Play Store release readiness.

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
- [ ] **B1.3.2** Kotlin/JNI forwarding for all `ace_*` API calls

### B1.4 Shared Code

- [ ] **B1.4.1** DSP chain — same as A1.3 (shared source, no fork)
- [ ] **B1.4.2** Flat C API — same `ace_engine.h` (shared headers)

---

## B2 — Kotlin Android App Foundation

### B2.1 Project Setup

- [ ] **B2.1.1** Android app module in Kotlin (`:app`) with AGP + Kotlin DSL
- [ ] **B2.1.2** ABI packaging for `arm64-v8a` + optional `x86_64` debug builds
- [ ] **B2.1.3** Load `libace_engine.so` from APK native libs dir

### B2.2 App Architecture

- [ ] **B2.2.1** Jetpack Compose UI shell + Navigation graph
- [ ] **B2.2.2** ViewModel + Kotlin Flow state pipeline (player, DSP, library, radio)
- [ ] **B2.2.3** Repository layer for native engine bridge + local persistence

### B2.3 Play Store Readiness

- [ ] **B2.3.1** Android App Bundle (`.aab`) release pipeline
- [ ] **B2.3.2** Play App Signing + keystore management
- [ ] **B2.3.3** Internal testing track upload checklist (versionCode/versionName, changelog)

---

## B3 — Kotlin Bridge + System Integration

### B3.1 Native Bridge Layer

- [ ] **B3.1.1** Kotlin `external` bindings for all core playback/DSP/analyzer calls
- [ ] **B3.1.2** Native callback/event bridge to Kotlin Flow (`fft`, meters, position, errors)
- [ ] **B3.1.3** Battery-aware polling policy: `fft-frame` @ 30 Hz on battery, 60 Hz on charger
- [ ] **B3.1.4** Reduce `level-meter` to 15 Hz on battery

### B3.2 Android System Integration

- [ ] **B3.2.1** Android `MediaSession` update on track change
- [ ] **B3.2.2** Media keys handling (Bluetooth headset buttons)
- [ ] **B3.2.3** Audio focus management (`AudioManager.requestAudioFocus`)
- [ ] **B3.2.4** Foreground playback service + media notification controls

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

- [ ] **B5.1** Same SQLite schema as A5.1 (SQLite in app sandbox)
- [ ] **B5.2** Same migration system (A5.2)
- [ ] **B5.3** Kotlin data access layer (Room or direct SQLite wrapper)
- [ ] **B5.4** Same feature wiring as A5.3 (playlists, recap, ratings, library filters)

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
- [ ] **B7.2** Kotlin bridge + Compose Analyzer wiring (equivalent to A7.3-A7.4)
- [ ] **B7.3** Touch-optimized ABX controls (larger tap targets)

---

## B8 — Auto-EQ

- [ ] **B8.1** Same C++ correction algorithm as A8.3 (shared)
- [ ] **B8.2** CSV import via Android file picker (SAF intent)
- [ ] **B8.3** Kotlin/Compose Gear screen wiring (equivalent to A8.4)

---

## B9 — Qobuz Streaming

### B9.1 Auth

- [ ] **B9.1.1** OAuth2 PKCE via Android Custom Tab (no localhost redirect)
- [ ] **B9.1.2** Token in Android Keystore (encrypted)
- [ ] **B9.1.3** Token refresh on expiry

### B9.2 Shared Code

- [ ] **B9.2.1** Same Qobuz API contract as A9.2 (Kotlin implementation)
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
6. Signed `.aab` passes Play Console internal testing rollout
