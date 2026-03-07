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
//  Engine Interface
// ─────────────────────────────────────────────────────────────
export interface IAudioEngine {
  // Lifecycle
  initialize(): Promise<void>
  destroy(): Promise<void>

  // Playback
  openTrack(trackId: string): Promise<void>
  openFile(filePath: string): Promise<void>
  play(): Promise<void>
  pause(): void
  stop(): void
  seek(positionMs: number): void
  setVolume(volume: number): void

  // Devices
  listDevices(): Promise<AudioDevice[]>
  setOutputDevice(deviceId: string): Promise<void>

  // DSP
  setDspState(state: DspChainState): void

  // Analysis
  analyzeFile(filePath: string): Promise<FileAnalysisResult>
  generateSpectrogram(filePath: string, channelIndex: number): Promise<Float32Array>

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

  async openTrack(trackId: string) {
    await invoke('ace_open_track', { trackId })
  }

  async openFile(filePath: string) {
    await invoke('ace_open_file', { filePath })
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
    invoke('ace_set_volume', { volume }).catch(console.error)
  }

  async listDevices(): Promise<AudioDevice[]> {
    return invoke<AudioDevice[]>('ace_list_devices')
  }

  async setOutputDevice(deviceId: string) {
    await invoke('ace_set_output_device', { deviceId })
  }

  setDspState(state: DspChainState) {
    // Debounced — send to engine; fast-path, no await
    invoke('ace_set_dsp_state', { state }).catch(console.error)
  }

  async analyzeFile(filePath: string): Promise<FileAnalysisResult> {
    return invoke<FileAnalysisResult>('ace_analyze_file', { filePath })
  }

  async generateSpectrogram(filePath: string, channelIndex: number): Promise<Float32Array> {
    const raw = await invoke<number[]>('ace_generate_spectrogram', { filePath, channelIndex })
    return new Float32Array(raw)
  }

  // ── Real-time events ─────────────────────────────────────
  onFftFrame(handler: (frame: FftFrame) => void) {
    return listen<FftFrame>('ace://fft-frame', handler)
  }

  onLevelMeter(handler: (meter: LevelMeter) => void) {
    return listen<LevelMeter>('ace://level-meter', handler)
  }

  onPositionUpdate(handler: (positionMs: number) => void) {
    return listen<number>('ace://position-update', handler)
  }

  onTrackChange(handler: (track: AudioTrack | null) => void) {
    return listen<AudioTrack | null>('ace://track-change', handler)
  }

  onError(handler: (error: string) => void) {
    return listen<string>('ace://engine-error', handler)
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
