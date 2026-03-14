/**
 * Audiophile Ace — Audio Engine Bridge
 * lib/audioEngine.ts
 *
 * This module provides a unified interface to the C++ audio engine
 * running in the Tauri Rust backend.
 *
 * All calls go through Tauri's `invoke()` IPC mechanism.
 * Real-time data (FFT frames, level meters) arrive via Tauri events.
 *
 * The singleton pattern ensures one engine instance per app session.
 */

import type { DspChainState, AudioDevice, FftFrame, LevelMeter, AudioTrack, FileAnalysisResult } from '@ace/types'

// Dynamically imported to avoid build errors in non-Tauri environments
let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null
let tauriListen: (<T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>) | null = null

async function loadTauri() {
  if (tauriInvoke) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const { listen } = await import('@tauri-apps/api/event')
    tauriInvoke = invoke
    tauriListen = listen
  } catch {
    console.warn('[AudioEngine] Tauri APIs not available — running in browser/mock mode')
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await loadTauri()
  if (!tauriInvoke) {
    console.warn(`[AudioEngine] Mock invoke: ${cmd}`, args)
    return undefined as T
  }
  return tauriInvoke(cmd, args) as Promise<T>
}

async function listen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<() => void> {
  await loadTauri()
  if (!tauriListen) {
    return () => {}
  }
  return tauriListen<T>(event, (e) => handler(e.payload as T))
}

// ─────────────────────────────────────────────────────────────
//  Raw event payloads from Rust bridge (snake_case)
// ─────────────────────────────────────────────────────────────
interface RustFftFrameEvent {
  bins_l: number[]
  bins_r: number[]
  timestamp_ms: number
}

interface RustLevelMeterEvent {
  peak_l_db: number
  peak_r_db: number
  rms_l_db: number
  rms_r_db: number
  lufs_integrated: number
}

interface RustPositionEvent {
  position_ms: number
}

interface RustTrackInfo {
  file_path: string
  codec: string
  sample_rate: number
  bit_depth: number
  channels: number
  duration_ms: number
}

interface RustScanProgress {
  file: string
  count: number
}

interface RustScanComplete {
  total: number
  folder: string
}

export interface MetadataWritePayload {
  filePath: string
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  comment: string
  year: number
  trackNumber: number
  trackTotal: number
  discNumber: number
  discTotal: number
}

export interface AutoTagCandidate {
  id: string
  title: string
  artist: string
  album: string
  year: string
  score: number
}

// ─────────────────────────────────────────────────────────────
//  Engine Interface
// ─────────────────────────────────────────────────────────────
export interface IAudioEngine {
  // Lifecycle
  initialize(): Promise<void>
  destroy(): Promise<void>

  // Playback (A3.1.1)
  openTrack(trackId: string): Promise<void>
  openFile(filePath: string): Promise<RustTrackInfo>
  play(): Promise<void>
  pause(): void
  stop(): void
  seek(positionMs: number): void
  /** Accepts linear 0–1 volume; converted to dB for the engine */
  setVolume(volume: number): void

  // DSP (A3.1.2)
  setEqBand(band: number, freq: number, gainDb: number, q: number): void
  setDspState(state: DspChainState): void

  // Devices (A3.1.3)
  listDevices(): Promise<AudioDevice[]>
  setOutputDevice(deviceId: string): Promise<void>

  // Analysis (A3.1.4)
  analyzeFile(filePath: string): Promise<FileAnalysisResult>
  generateSpectrogram(filePath: string, channelIndex: number): Promise<Float32Array>

  // Metadata (A4.3.1)
  writeMetadata(payload: MetadataWritePayload): Promise<void>

  // AutoTag (A4.3.2 / A4.3.3 / A4.3.4)
  lookupAcoustId(filePath: string): Promise<AutoTagCandidate[]>
  searchMusicBrainz(query: string): Promise<AutoTagCandidate[]>
  fetchAndEmbedCoverArt(filePath: string, releaseMbid: string): Promise<void>

  // Scanning (A3.1.5)
  scanFolder(path: string, onProgress?: (file: string, count: number) => void): Promise<number>

  // File-system watcher (A4.1.2)
  startWatcher(paths: string[]): Promise<void>
  stopWatcher(): Promise<void>
  onFsChange(handler: (event: { kind: string; path: string }) => void): Promise<() => void>
  onScanComplete(handler: (event: { total: number; folder: string }) => void): Promise<() => void>

  // Real-time event subscriptions
  onFftFrame(handler: (frame: FftFrame) => void): Promise<() => void>
  onLevelMeter(handler: (meter: LevelMeter) => void): Promise<() => void>
  onPositionUpdate(handler: (positionMs: number) => void): Promise<() => void>
  onTrackChange(handler: (track: AudioTrack | null) => void): Promise<() => void>
  onError(handler: (error: string) => void): Promise<() => void>
}

// ─────────────────────────────────────────────────────────────
//  Tauri Implementation
// ─────────────────────────────────────────────────────────────
class TauriAudioEngine implements IAudioEngine {
  async initialize() {
    await invoke('ace_engine_init')
  }

  async destroy() {
    await invoke('ace_engine_destroy')
  }

  // ── A3.1.1 — Playback ─────────────────────────────────

  async openTrack(trackId: string) {
    await invoke('ace_open_track', { trackId })
  }

  async openFile(filePath: string): Promise<RustTrackInfo> {
    return invoke<RustTrackInfo>('ace_open_file', { filePath })
  }

  async play() {
    await invoke('ace_play')
  }

  pause() {
    invoke('ace_pause').catch(console.error)
  }

  stop() {
    invoke('ace_stop').catch(console.error)
  }

  seek(positionMs: number) {
    invoke('ace_seek', { positionMs }).catch(console.error)
  }

  setVolume(volume: number) {
    // Convert linear 0–1 to dB (Rust engine expects dB)
    const db = volume > 0 ? 20 * Math.log10(volume) : -100
    invoke('ace_set_volume', { db }).catch(console.error)
  }

  // ── A3.1.2 — DSP ──────────────────────────────────────

  setEqBand(band: number, freq: number, gainDb: number, q: number) {
    invoke('ace_set_eq_band', { band, freq, gainDb, q }).catch(console.error)
  }

  setDspState(state: DspChainState) {
    invoke('ace_set_dsp_state', { state }).catch(console.error)
  }

  // ── A3.1.3 — Devices ──────────────────────────────────

  async listDevices(): Promise<AudioDevice[]> {
    return invoke<AudioDevice[]>('ace_list_devices')
  }

  async setOutputDevice(deviceId: string) {
    await invoke('ace_set_output_device', { deviceId })
  }

  // ── A3.1.4 — Analysis ─────────────────────────────────

  async analyzeFile(filePath: string): Promise<FileAnalysisResult> {
    return invoke<FileAnalysisResult>('ace_analyze_file', { filePath })
  }

  async generateSpectrogram(filePath: string, channelIndex: number): Promise<Float32Array> {
    const raw = await invoke<number[]>('ace_generate_spectrogram', { filePath, channelIndex })
    return new Float32Array(raw)
  }

  async writeMetadata(payload: MetadataWritePayload) {
    await invoke('ace_write_metadata', {
      payload: {
        file_path: payload.filePath,
        title: payload.title,
        artist: payload.artist,
        album_artist: payload.albumArtist,
        album: payload.album,
        genre: payload.genre,
        comment: payload.comment,
        year: payload.year,
        track_number: payload.trackNumber,
        track_total: payload.trackTotal,
        disc_number: payload.discNumber,
        disc_total: payload.discTotal,
      },
    })
  }

  async lookupAcoustId(filePath: string): Promise<AutoTagCandidate[]> {
    return invoke<AutoTagCandidate[]>('ace_acoustid_lookup', { filePath })
  }

  async searchMusicBrainz(query: string): Promise<AutoTagCandidate[]> {
    return invoke<AutoTagCandidate[]>('ace_musicbrainz_search', { query })
  }

  async fetchAndEmbedCoverArt(filePath: string, releaseMbid: string) {
    await invoke('ace_fetch_embed_cover_art', { filePath, releaseMbid })
  }

  // ── A3.1.5 — Folder scanning ──────────────────────────

  async scanFolder(
    path: string,
    onProgress?: (file: string, count: number) => void
  ): Promise<number> {
    let unlistenProgress: (() => void) | undefined
    let unlistenComplete: (() => void) | undefined

    if (onProgress) {
      unlistenProgress = await listen<RustScanProgress>(
        'ace://scan-progress',
        (p) => onProgress(p.file, p.count)
      )
    }

    try {
      const total = await invoke<number>('ace_scan_folder', { path })
      return total
    } finally {
      unlistenProgress?.()
      unlistenComplete?.()
    }
  }

  // ── A4.1.2 — File-system watcher ──────────────────────────

  async startWatcher(paths: string[]) {
    await invoke('ace_start_watcher', { paths })
  }

  async stopWatcher() {
    await invoke('ace_stop_watcher')
  }

  onFsChange(handler: (event: { kind: string; path: string }) => void) {
    return listen<{ kind: string; path: string }>('ace://fs-change', handler)
  }

  onScanComplete(handler: (event: { total: number; folder: string }) => void) {
    return listen<{ total: number; folder: string }>('ace://scan-complete', handler)
  }

  // ── Real-time events ─────────────────────────────────────

  onFftFrame(handler: (frame: FftFrame) => void) {
    return listen<RustFftFrameEvent>('ace://fft-frame', (raw) => {
      handler({
        channelIndex: 0,
        bins: new Float32Array(raw.bins_l),
        timestamp: raw.timestamp_ms,
        // Also expose right channel for stereo views
        ...(raw.bins_r && { binsR: new Float32Array(raw.bins_r) }),
      } as FftFrame)
    })
  }

  onLevelMeter(handler: (meter: LevelMeter) => void) {
    return listen<RustLevelMeterEvent>('ace://level-meter', (raw) => {
      handler({
        channels: [
          { index: 0, peakDb: raw.peak_l_db, rmsDb: raw.rms_l_db, lufsShortTerm: 0, lufsIntegrated: raw.lufs_integrated, truePeakDb: raw.peak_l_db, clipping: raw.peak_l_db >= 0 },
          { index: 1, peakDb: raw.peak_r_db, rmsDb: raw.rms_r_db, lufsShortTerm: 0, lufsIntegrated: raw.lufs_integrated, truePeakDb: raw.peak_r_db, clipping: raw.peak_r_db >= 0 },
        ],
        timestamp: Date.now(),
      })
    })
  }

  onPositionUpdate(handler: (positionMs: number) => void) {
    return listen<RustPositionEvent>('ace://position-update', (raw) => {
      handler(raw.position_ms)
    })
  }

  onTrackChange(handler: (track: AudioTrack | null) => void) {
    return listen<RustTrackInfo | null>('ace://track-change', (raw) => {
      if (!raw) {
        handler(null)
        return
      }
      // Map RustTrackInfo → minimal AudioTrack for the store
      handler({
        id: raw.file_path,
        filePath: raw.file_path,
        title: raw.file_path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Unknown',
        artist: '',
        albumArtist: '',
        album: '',
        genre: '',
        year: null,
        trackNumber: null,
        totalTracks: null,
        discNumber: null,
        totalDiscs: null,
        comment: '',
        durationMs: raw.duration_ms,
        sampleRate: raw.sample_rate,
        bitDepth: raw.bit_depth,
        channels: raw.channels,
        codec: raw.codec as AudioTrack['codec'],
        bitrateKbps: 0,
        fileSizeBytes: 0,
        effectiveBitDepth: null,
        dynamicRange: null,
        lufs: null,
        truePeak: null,
        isLossyTranscode: null,
        lossyConfidence: null,
        replayGainTrack: null,
        replayGainAlbum: null,
        musicBrainzId: null,
        acoustId: null,
        albumId: '',
        dateAdded: Date.now(),
        dateModified: Date.now(),
        lastPlayed: null,
        playCount: 0,
      })
    })
  }

  onError(handler: (error: string) => void) {
    return listen<{ message: string }>('ace://engine-error', (raw) => {
      handler(raw.message)
    })
  }
}

// ─────────────────────────────────────────────────────────────
//  Singleton
// ─────────────────────────────────────────────────────────────
let _engine: IAudioEngine | null = null

export function getAudioEngine(): IAudioEngine {
  if (!_engine) {
    _engine = new TauriAudioEngine()
  }
  return _engine
}
