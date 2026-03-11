import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DspChainState, EqBand, EqFilterType, EqPreset, FftFrame, LevelMeter } from '@ace/types'
import { getAudioEngine } from '@/lib/audioEngine'
import { SYSTEM_PRESETS, exportPreset, importPreset } from '@/lib/eqPresets'

const DEFAULT_BANDS: EqBand[] = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  enabled: true,
  // Log-spaced frequencies from 20Hz to 20kHz
  frequency: Math.round(20 * Math.pow(1000, i / 59)),
  gainDb: 0,
  q: 1.0,
  type: 'peaking' as EqFilterType,
}))

const DEFAULT_DSP: DspChainState = {
  eqEnabled: false,
  eqPresetId: null,
  bands: DEFAULT_BANDS,
  preampDb: 0,

  crossfeedEnabled: false,
  crossfeedLevel: 0.4,
  crossfeedCutoff: 700,

  surroundEnabled: false,
  surroundWidth: 0.5,

  ditherEnabled: false,
  ditherType: 'tpdf',
  noiseShapingProfile: 'none',

  compressorEnabled: false,
  compressorThresholdDb: -18,
  compressorRatio: 4,
  compressorAttackMs: 10,
  compressorReleaseMs: 100,
  compressorKneeDb: 6,
  compressorMakeupDb: 0,

  stereoWidthEnabled: false,
  stereoWidth: 1.0,

  replayGainMode: 'off',
  replayGainPreampDb: 0,

  sampleRateConversion: 'off',
  targetSampleRate: 44100,

  pitchSemitons: 0,
  tempoRatio: 1.0,
}

// ── DSP Profiles (A3.3.6) ─────────────────────────────────
export interface DspProfile {
  id: string
  name: string
  isSystem: boolean
  state: DspChainState
}

const SYSTEM_PROFILES: DspProfile[] = [
  { id: 'neutral', name: 'Neutral', isSystem: true, state: { ...DEFAULT_DSP, eqEnabled: false } },
  { id: 'analytical', name: 'Analytical', isSystem: true, state: {
    ...DEFAULT_DSP, eqEnabled: true, crossfeedEnabled: false,
    stereoWidthEnabled: false, replayGainMode: 'off',
  }},
  { id: 'fun', name: 'Fun', isSystem: true, state: {
    ...DEFAULT_DSP, eqEnabled: true, crossfeedEnabled: true, crossfeedLevel: 0.3, crossfeedCutoff: 700,
    stereoWidthEnabled: true, stereoWidth: 1.3,
  }},
  { id: 'night', name: 'Night Mode', isSystem: true, state: {
    ...DEFAULT_DSP, eqEnabled: true, compressorEnabled: true,
    compressorThresholdDb: -24, compressorRatio: 3, compressorAttackMs: 10, compressorReleaseMs: 150,
  }},
]

interface DspStore {
  state: DspChainState
  presets: EqPreset[]

  // Band actions
  updateBand: (bandId: number, patch: Partial<EqBand>) => void
  resetAllBands: () => void
  setBandEnabled: (bandId: number, enabled: boolean) => void

  // Preset actions (A3.3.5)
  loadPreset: (preset: EqPreset) => void
  savePreset: (name: string) => void
  deletePreset: (id: string) => void
  importPresetJson: (json: string) => EqPreset | null
  exportPresetJson: (id: string) => string | null
  allPresets: () => EqPreset[]

  // DSP Profile actions (A3.3.6)
  profiles: DspProfile[]
  activeProfileId: string | null
  loadProfile: (id: string) => void
  saveProfile: (name: string) => void
  deleteProfile: (id: string) => void
  allProfiles: () => DspProfile[]

  // Global DSP toggles
  setEqEnabled: (enabled: boolean) => void
  setPreampDb: (db: number) => void
  setCrossfeedEnabled: (enabled: boolean) => void
  setCrossfeedLevel: (level: number) => void
  setSurroundEnabled: (enabled: boolean) => void
  setDitherEnabled: (enabled: boolean) => void
  setDitherType: (type: DspChainState['ditherType']) => void
  setNoiseShapingProfile: (profile: DspChainState['noiseShapingProfile']) => void
  setCompressorEnabled: (enabled: boolean) => void
  setStereoWidthEnabled: (enabled: boolean) => void
  setStereoWidth: (width: number) => void

  // Real-time (not persisted)
  fftFrame: FftFrame | null
  levelMeter: LevelMeter | null
  _setFftFrame: (frame: FftFrame) => void
  _setLevelMeter: (meter: LevelMeter) => void
}

export const useDspStore = create<DspStore>()(
  persist(
    (set, get) => ({
      state: DEFAULT_DSP,
      presets: [],
      profiles: [],
      activeProfileId: null,
      fftFrame: null,
      levelMeter: null,

      updateBand: (bandId, patch) => {
        set((s) => {
          const bands = s.state.bands.map((b) => (b.id === bandId ? { ...b, ...patch } : b))
          const newState = { ...s.state, bands }
          // A3.3.2 — Per-band update for responsive EQ drag
          const updated = bands.find((b) => b.id === bandId)
          if (updated) {
            getAudioEngine().setEqBand(updated.id, updated.frequency, updated.gainDb, updated.q)
          }
          return { state: newState }
        })
      },

      resetAllBands: () => {
        set((s) => {
          const newState = { ...s.state, bands: DEFAULT_BANDS, preampDb: 0 }
          getAudioEngine().setDspState(newState)
          return { state: newState }
        })
      },

      setBandEnabled: (bandId, enabled) => get().updateBand(bandId, { enabled }),

      loadPreset: (preset) => {
        set((s) => {
          const newState = {
            ...s.state,
            bands: preset.bands,
            preampDb: preset.preampDb,
            eqPresetId: preset.id,
          }
          getAudioEngine().setDspState(newState)
          return { state: newState }
        })
      },

      savePreset: (name) => {
        const { state } = get()
        const preset: EqPreset = {
          id: `user-${Date.now()}`,
          name,
          isSystem: false,
          bands: state.bands,
          preampDb: state.preampDb,
        }
        set((s) => ({ presets: [...s.presets, preset] }))
      },

      deletePreset: (id) =>
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),

      // A3.3.5 — Preset bank import/export
      importPresetJson: (json) => {
        const preset = importPreset(json)
        if (preset) set((s) => ({ presets: [...s.presets, preset] }))
        return preset
      },

      exportPresetJson: (id) => {
        const all = [...SYSTEM_PRESETS, ...get().presets]
        const preset = all.find((p) => p.id === id)
        return preset ? exportPreset(preset) : null
      },

      allPresets: () => [...SYSTEM_PRESETS, ...get().presets],

      // A3.3.6 — DSP profile stack
      loadProfile: (id) => {
        const all = [...SYSTEM_PROFILES, ...get().profiles]
        const profile = all.find((p) => p.id === id)
        if (!profile) return
        const newState = { ...profile.state }
        getAudioEngine().setDspState(newState)
        set({ state: newState, activeProfileId: id })
      },

      saveProfile: (name) => {
        const profile: DspProfile = {
          id: `profile-${Date.now()}`,
          name,
          isSystem: false,
          state: { ...get().state },
        }
        set((s) => ({ profiles: [...s.profiles, profile] }))
      },

      deleteProfile: (id) =>
        set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),

      allProfiles: () => [...SYSTEM_PROFILES, ...get().profiles],

      setEqEnabled: (eqEnabled) => {
        set((s) => {
          const newState = { ...s.state, eqEnabled }
          getAudioEngine().setDspState(newState)
          return { state: newState }
        })
      },
      setPreampDb: (preampDb) => {
        set((s) => {
          const newState = { ...s.state, preampDb }
          getAudioEngine().setDspState(newState)
          return { state: newState }
        })
      },
      setCrossfeedEnabled: (crossfeedEnabled) =>
        set((s) => ({ state: { ...s.state, crossfeedEnabled } })),
      setCrossfeedLevel: (crossfeedLevel) =>
        set((s) => ({ state: { ...s.state, crossfeedLevel } })),
      setSurroundEnabled: (surroundEnabled) =>
        set((s) => ({ state: { ...s.state, surroundEnabled } })),
      setDitherEnabled: (ditherEnabled) =>
        set((s) => ({ state: { ...s.state, ditherEnabled } })),
      setDitherType: (ditherType) =>
        set((s) => ({ state: { ...s.state, ditherType } })),
      setNoiseShapingProfile: (noiseShapingProfile) =>
        set((s) => ({ state: { ...s.state, noiseShapingProfile } })),
      setCompressorEnabled: (compressorEnabled) =>
        set((s) => ({ state: { ...s.state, compressorEnabled } })),
      setStereoWidthEnabled: (stereoWidthEnabled) =>
        set((s) => ({ state: { ...s.state, stereoWidthEnabled } })),
      setStereoWidth: (stereoWidth) =>
        set((s) => ({ state: { ...s.state, stereoWidth } })),

      _setFftFrame: (fftFrame) => set({ fftFrame }),
      _setLevelMeter: (levelMeter) => set({ levelMeter }),
    }),
    {
      name: 'ace-dsp-state',
      partialize: (s) => ({ state: s.state, presets: s.presets, profiles: s.profiles, activeProfileId: s.activeProfileId }),
    }
  )
)
