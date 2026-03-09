# Phase C — Linux Desktop

> Third platform. Reuses shared C++ engine and frontend code from Phase A.  
> Focus: ALSA/PipeWire backends, MPRIS2 D-Bus, Linux packaging.

---

## C1 — C++ Engine (ALSA + PipeWire)

### C1.1 ALSA Backend

- [ ] **C1.1.1** `snd_pcm_open("hw:N,N", PLAYBACK, BLOCKING)` — direct hw access (bypass dmix)
- [ ] **C1.1.2** `snd_pcm_set_params` — `SND_PCM_FORMAT_FLOAT_LE`, native sample rate
- [ ] **C1.1.3** `snd_device_name_hint` — device enumeration
- [ ] **C1.1.4** `udev` monitor — hot-plug detection

### C1.2 PipeWire Backend (optional)

- [ ] **C1.2.1** `pw_stream_new` with `PW_DIRECTION_OUTPUT`, native SR negotiation
- [ ] **C1.2.2** Runtime detection — check if PipeWire daemon is active, fallback to ALSA

### C1.3 CMake Build

- [ ] **C1.3.1** `FindALSA` (required) + `FindPipeWire` (optional) CMake modules

### C1.4 Shared Code

- [ ] **C1.4.1** DSP chain — same as A1.3 (shared source)
- [ ] **C1.4.2** Flat C API — same `ace_engine.h`

---

## C2 — Rust Bridge (+ MPRIS2)

### C2.1 Commands

- [ ] **C2.1.1** Same `commands.rs` as A2.2 (shared source)
- [ ] **C2.1.2** Same event emitters as A2.3

### C2.2 MPRIS2 D-Bus Emitter

- [ ] **C2.2.1** `org.mpris.MediaPlayer2.Player` interface implementation
- [ ] **C2.2.2** Methods: `Play`, `Pause`, `Stop`, `Next`, `Previous`
- [ ] **C2.2.3** Properties: `Metadata` (xesam:title, artist, album, artUrl)
- [ ] **C2.2.4** Properties: `PlaybackStatus`, `Position`, `Volume`, `LoopStatus`, `Shuffle`
- [ ] **C2.2.5** Signal: `PropertiesChanged` on track change / state change

---

## C3 — Frontend Integration

### C3.1 Shared Code

- [ ] **C3.1.1** Same `audioEngine.ts` (shared with A3.1)
- [ ] **C3.1.2** Same event listeners (shared with A3.2)

### C3.2 Linux-Specific

- [ ] **C3.2.1** MPRIS2 track update replaces SMTC (no additional frontend code needed)
- [ ] **C3.2.2** System media key handling via MPRIS2 (GNOME, KDE, etc.)

---

## C4 — File Scanning + Metadata

### C4.1 Scanner

- [ ] **C4.1.1** XDG Music dir (`$XDG_MUSIC_DIR` / `~/Music`) auto-add on first launch
- [ ] **C4.1.2** `inotify` watcher via `notify` crate (live folder monitoring)
- [ ] **C4.1.3** Same metadata extraction via C++ engine (shared A4.2)

### C4.2 Art Cache

- [ ] **C4.2.1** Album art → `$XDG_DATA_HOME/ace/art/` PNG cache

---

## C5 — Database

- [ ] **C5.1** Same SQLite schema as A5.1 (shared)
- [ ] **C5.2** Same migration system (A5.2)
- [ ] **C5.3** Same view wiring (A5.3)

---

## C6 — RadioView

### C6.1 Stream Protocol

- [ ] **C6.1.1** Shared C++ engine stream code from A6.1

### C6.2 UI

- [ ] **C6.2.1** Same desktop RadioView UI as A6.4 (shared)

### C6.3 Linux Integration

- [ ] **C6.3.1** MPRIS2 station name → `xesam:artist` property
- [ ] **C6.3.2** `libnotify` desktop notification on ICY title change

---

## C7 — Analyzer + ABX

- [ ] **C7.1** Same C++ analysis functions as A7.2 (shared)
- [ ] **C7.2** Same Tauri command + AnalyzerView wiring (A7.3–A7.4)

---

## C8 — Auto-EQ

- [ ] **C8.1** Same C++ correction algorithm as A8.3 (shared)
- [ ] **C8.2** Same GearView wiring (A8.4)

---

## C9 — Qobuz Streaming

### C9.1 Auth

- [ ] **C9.1.1** OAuth2 PKCE via system browser + localhost redirect
- [ ] **C9.1.2** Token in `libsecret` (GNOME) / KWallet (KDE) via `tauri-plugin-keychain`
- [ ] **C9.1.3** Token refresh on expiry

### C9.2 Shared Code

- [ ] **C9.2.1** Same Qobuz API client as A9.2 (shared TypeScript)
- [ ] **C9.2.2** Same stream playback as A9.4 (shared C++)
- [ ] **C9.2.3** Same offline cache logic as A9.5 (path: `$XDG_CACHE_HOME/ace/`)

### C9.3 Linux-Specific

- [ ] **C9.3.1** MPRIS2 metadata for streaming tracks

---

## Deliverables (Phase C Complete)

1. `libace_engine.so` plays FLAC via ALSA direct hw on Linux
2. PipeWire backend works when PipeWire is active
3. MPRIS2 shows in GNOME Shell / KDE media indicator
4. AppImage, deb, rpm packages build cleanly
5. Radio + Qobuz streaming functional on Linux
