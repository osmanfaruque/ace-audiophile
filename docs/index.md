# Audiophile Ace — Master Phase Index

> **Development order**: A (Windows) → B (Android) → C (Linux)  
> Each platform phase contains 9 sub-phases (1–9) with deep hierarchical task IDs.

---

## Platform Phases

| Phase | Platform | Status | Doc |
|---|---|---|---|
| **A** | Windows Desktop | 🔄 Next | [phase-A.md](phase-A.md) |
| **B** | Android | ⬜ Queued | [phase-B.md](phase-B.md) |
| **C** | Linux Desktop | ⬜ Queued | [phase-C.md](phase-C.md) |

---

## Sub-Phase Map (same sequence per platform)

| # | Feature | Windows | Android | Linux |
|---|---|---|---|---|
| 1 | C++ Engine Wiring | A1 | B1 | C1 |
| 2 | Rust Bridge IPC | A2 | B2 | C2 |
| 3 | Frontend Integration | A3 | B3 | C3 |
| 4 | File Scanning + Metadata | A4 | B4 | C4 |
| 5 | Database (SQLite) | A5 | B5 | C5 |
| 6 | RadioView | A6 | B6 | C6 |
| 7 | Analyzer + ABX Real | A7 | B7 | C7 |
| 8 | Auto-EQ Real | A8 | B8 | C8 |
| 9 | Qobuz Streaming | A9 | B9 | C9 |

---

## Task ID Format

```
{Platform}{Sub-Phase}.{section}.{task}.{subtask}

Examples:
  A1.2.3   → Windows, C++ Engine, WASAPI backend, format negotiation
  B6.4.2   → Android, RadioView, UI components, NowPlayingBanner
  C2.2.3   → Linux, Rust Bridge, MPRIS2 D-Bus, metadata emitter
```

---

## Commit Message Convention

Format:

`{type}: {Platform}{Sub-Phase}.{section}.{task}.{subtask} : {message}`

Allowed `type` examples:

- `feat`
- `fix`
- `refactor`
- `docs`
- `chore`
- `restruct`
- `perf`
- `test`

Examples:

- `feat: A1.3.5 : wasapi backend implemented`
- `fix: A2.3.4 : track-change event race condition resolved`
- `restruct: B4.1.2 : media scanner flow reorganized`

Rules:

- `A` = Windows, `B` = Android, `C` = Linux
- For shared/cross-platform work, use the platform currently active in roadmap order
- Do not rewrite already pushed commit history unless explicitly approved

---

## Platform Reference Docs

| Doc | Description |
|---|---|
| [platform-windows.md](platform-windows.md) | Windows stack, WASAPI architecture, packaging |
| [platform-android.md](platform-android.md) | Android stack, Oboe/AAudio, USB DAC, build targets |
| [platform-linux.md](platform-linux.md) | Linux stack, ALSA/PipeWire, MPRIS2, distribution |

---

## Completed Work (Pre-Phase A)

All **UI views** implemented and type-check clean (commit `63b11a3`):

- ✅ PlayerView (Beautiful + Techie modes, lyrics panel, star ratings)
- ✅ EqualizerView (60-band interactive SVG PEQ)
- ✅ LibraryView (3-panel browser, 4 browse modes)
- ✅ PlaylistsView (CRUD, smart playlists, M3U, drag-reorder)
- ✅ AnalyzerView (verdict cards, spectrogram, waveform, spectrum)
- ✅ TaggerView (metadata editor, MusicBrainz, album art)
- ✅ AbxView (blind A/B/X test, binomial stats)
- ✅ GearView (FR curves, target curves, Auto-EQ correction)
- ✅ RecapView (stats, heatmaps, ranked charts)
- ✅ SettingsView (6-tab settings, themes, audio config)
- ✅ RadioView (stub — full implementation in Phase A6/B6/C6)
- ✅ AppShell (sidebar, routing, 14 views)
- ✅ 4 Zustand stores (app, playback, dsp, playlist)
