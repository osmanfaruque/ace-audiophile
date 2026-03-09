# Platform: Linux Desktop

> **Phase C** — see [phase-C.md](phase-C.md) for full task hierarchy.

## Overview

The Linux platform uses **Tauri v2** with WebKitGTK as the webview backend.  
Audio output uses **ALSA** natively, with optional **PipeWire** routing.  
Distributed as AppImage (portable), deb (Debian/Ubuntu), and rpm (Fedora/RHEL).

---

## Technology Stack

| Layer | Technology |
|---|---|
| Shell | Tauri v2 (Rust + WebKitGTK 4.1) |
| Frontend | Next.js 15 static export |
| Audio engine | C++20 shared library (`libace_engine.so`) |
| Audio output | ALSA (`snd_pcm_*`) + PipeWire native |
| IPC | Tauri `invoke()` + `emit()` |
| Media integration | MPRIS2 D-Bus interface |

---

## Audio Subsystem

### ALSA (default)

```
ace_engine.so ──► snd_pcm_open("hw:0,0", PLAYBACK, BLOCKING)
                  snd_pcm_set_params(format=FLOAT_LE, rate=native)
                  snd_pcm_writei(frames)
```

- Opens `hw:N,N` directly for bit-perfect (bypasses ALSA dmix/resampling)
- Enumerates devices via `snd_device_name_hint`
- Hot-plug via `udev` monitor (Phase 2)

### PipeWire (optional, Phase 2)

- `pw_stream_new` with `PW_DIRECTION_OUTPUT`
- Negotiates native sample rate with session manager
- Allows simultaneous playback with other apps while maintaining quality

---

## MPRIS2 Integration (Phase 2)

Implements `org.mpris.MediaPlayer2.Player` D-Bus interface:

```
/org/mpris/MediaPlayer2
  ├── Play / Pause / Stop / Next / Previous
  ├── Metadata (xesam:title, album, artist, artUrl)
  ├── PlaybackStatus, LoopStatus, Shuffle
  └── Volume, Position
```

Enables system media key support and integration with desktop environments (GNOME, KDE, etc.).

---

## Distribution Formats

| Format | Target | Build command |
|---|---|---|
| `.AppImage` | Any Linux (portable) | `pnpm tauri build` |
| `.deb` | Debian / Ubuntu | `pnpm tauri build` |
| `.rpm` | Fedora / openSUSE | `pnpm tauri build` |

System dependencies bundled in deb/rpm:

```
libasound2 (≥ 1.1.8)
libgtk-3-0 (≥ 3.22)
libwebkit2gtk-4.1-0
```

---

## Build Requirements

```bash
# Debian/Ubuntu
sudo apt install \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libasound2-dev

# Fedora
sudo dnf install \
  gtk3-devel \
  webkit2gtk4.1-devel \
  alsa-lib-devel
```

---

## Development Workflow

```bash
# Start Next.js dev server
pnpm --filter @ace/ui dev

# In second terminal
cd apps/linux
pnpm tauri dev
```

---

## Paths

| Purpose | Path |
|---|---|
| Album art cache | `$XDG_DATA_HOME/ace/art/` |
| Qobuz offline cache | `$XDG_CACHE_HOME/ace/` |
| SQLite database | `$XDG_DATA_HOME/ace/ace.db` |
| Config (Zustand persist) | `$XDG_CONFIG_HOME/ace/config.json` |

---

## Phase C Cross-References

| Feature | Phase Task |
|---|---|
| ALSA direct hw output | C1.1.1 |
| PipeWire backend | C1.2 |
| udev hot-plug | C1.1.4 |
| MPRIS2 D-Bus | C2.2 |
| XDG Music dir scan | C4.1.1 |
| inotify watcher | C4.1.2 |
| libnotify (radio) | C6.3.2 |
| libsecret / KWallet (Qobuz) | C9.1.2 |

---

## Capabilities

Tauri capability file: `apps/linux/src-tauri/capabilities/main.json`  
Granted permissions: `shell:open`, `dialog:open`, `fs:read`, `notification:default`
