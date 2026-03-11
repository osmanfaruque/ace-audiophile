# Audiophile Ace

> Multifunctional Hi-Fi Audio Tool — bit-perfect playback, 60-band PEQ, spectral analysis, lossy detection, ABX blind testing, gear matching, and more.

## Platforms

| Platform | Stack |
|---|---|
| Desktop (Windows / macOS) | Tauri v2 + Next.js + C++ |
| Linux | Tauri v2 + Next.js + C++ |
| Android | Tauri v2 (mobile) + Next.js + C++ NDK |

## Tech Stack

- **Frontend:** Next.js 15 + TypeScript + Tailwind CSS (shared across all platforms)
- **Audio Engine:** Pure C++17 (FFmpeg, Oboe, PFFFT, libsoxr, libbs2b, mysofa, TagLib, Chromaprint)
- **Platform Bridge:** Tauri v2 (Rust bindings to C++ engine via bindgen)
- **Monorepo:** pnpm workspaces + Turborepo

## Features

- Bit-perfect playback with direct USB DAC access
- 60-band parametric EQ with 1000+ presets
- Full DSP chain: crossfeed, virtual surround (HRTF), dithering, noise shaping, compressor, ReplayGain
- Dual UI: Elegant mode (art-forward, minimal chrome) + Technical mode (info-dense, data-rich)
- Per-channel spectrogram with lossy transcoding detection
- Fake bit-depth detection (16-bit padded to 24-bit)
- Binary file structure inspector (RIFF chunks, FLAC frames, hex/binary view)
- Dynamic range meter (TT DR, LUFS, LRA, true peak)
- Mastering quality comparison between track versions
- Auto-tagger via AcoustID + MusicBrainz + Chromaprint fingerprinting
- ABX blind test mode with binomial statistical significance
- Gear matching: Auto-EQ from IEM/headphone FR data (3000+ profiles)
- Streaming: Qobuz (24/192 FLAC)
- Audio Recap: yearly stats + real-time listening dashboard

## Structure

```
audiophile-ace/
├── apps/
│   ├── desktop/     ← Tauri v2 (Windows + macOS)
│   ├── linux/       ← Tauri v2 (Linux)
│   └── android/     ← Tauri v2 Android
├── packages/
│   ├── ui/          ← Shared Next.js app
│   ├── types/       ← Shared TypeScript interfaces
│   └── audio-engine/← Pure C++ audio engine
└── docs/            ← Platform & phase documentation
```

## Getting Started

```bash
# Install dependencies
pnpm install

# Desktop dev
pnpm desktop:dev

# Linux dev
pnpm linux:dev

# Android dev
pnpm android:dev
```

## Docs

- [Platform: Desktop](docs/platform-desktop.md)
- [Platform: Android](docs/platform-android.md)
- [Platform: Linux](docs/platform-linux.md)
- [Phase 1: Audio Engine Core](docs/phase-1.md)
- [Phase 2: Frontend + Core Player UI](docs/phase-2.md)
- [Phase 3: Advanced Features](docs/phase-3.md)
