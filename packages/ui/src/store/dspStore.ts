import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DspChainState, EqBand, EqFilterType, EqPreset } from '@ace/types'
import { getAudioEngine } from '@/lib/audioEngine'

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

interface DspStore {
  state: DspChainState
  presets: EqPreset[]

  // Band actions
  updateBand: (bandId: number, patch: Partial<EqBand>) => void
  resetAllBands: () => void
  setBandEnabled: (bandId: number, enabled: boolean) => void

  // Preset actions
  loadPreset: (preset: EqPreset) => void
  savePreset: (name: string) => void
  deletePreset: (id: string) => void

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
}

export const useDspStore = create<DspStore>()(
  persist(
    (set, get) => ({
      state: DEFAULT_DSP,
      presets: [],

      updateBand: (bandId, patch) => {
        set((s) => {
          const bands = s.state.bands.map((b) => (b.id === bandId ? { ...b, ...patch } : b))
          const newState = { ...s.state, bands }
          getAudioEngine().setDspState(newState)
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
    }),
    {
      name: 'ace-dsp-state',
      partialize: (s) => ({ state: s.state, presets: s.presets }),
    }
  )
)
