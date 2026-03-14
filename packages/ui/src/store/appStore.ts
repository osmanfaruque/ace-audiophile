import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UiMode, ColorScheme, AppPreferences } from '@ace/types'
import { getAudioEngine } from '@/lib/audioEngine'

interface SmtcRadioMetadata {
  stationName: string
  icyTitle: string
}

interface AppState {
  uiMode: UiMode
  colorScheme: ColorScheme
  accentColor: string | null        // null = default purple
  activeView: AppView
  sidebarOpen: boolean
  isInitialized: boolean

  // Library prefs
  libraryPaths: string[]
  autoScan: boolean
  scanOnStartup: boolean

  // Output prefs
  outputDeviceId: string | null
  exclusiveMode: boolean
  bitPerfect: boolean
  bufferMs: number

  // Playback prefs
  gapless: boolean
  crossfadeDurationMs: number
  replayGainMode: 'off' | 'track' | 'album'

  // Error notification (not persisted)
  lastError: string | null

  // Scan state (not persisted)
  isScanning: boolean
  scanProgress: { file: string; count: number } | null
  scanTotal: number | null

  // A6.5.1 SMTC radio metadata override
  smtcRadio: SmtcRadioMetadata | null

  // Actions
  setUiMode: (mode: UiMode) => void
  setColorScheme: (scheme: ColorScheme) => void
  setAccentColor: (color: string | null) => void
  setActiveView: (view: AppView) => void
  toggleSidebar: () => void
  addLibraryPath: (path: string) => void
  removeLibraryPath: (path: string) => void
  setAutoScan: (v: boolean) => void
  setScanOnStartup: (v: boolean) => void
  setOutputDeviceId: (id: string | null) => void
  setExclusiveMode: (v: boolean) => void
  setBitPerfect: (v: boolean) => void
  setBufferMs: (v: number) => void
  setGapless: (v: boolean) => void
  setCrossfadeDurationMs: (v: number) => void
  setReplayGainMode: (mode: 'off' | 'track' | 'album') => void
  setLastError: (error: string | null) => void
  setIsScanning: (v: boolean) => void
  setScanProgress: (p: { file: string; count: number } | null) => void
  setScanTotal: (n: number | null) => void
  setSmtcRadio: (payload: SmtcRadioMetadata | null) => void
  clearSmtcRadio: () => void
  init: () => Promise<void>
}

export type AppView =
  | 'player'
  | 'library'
  | 'albums'
  | 'artists'
  | 'genres'
  | 'playlists'
  | 'equalizer'
  | 'analyzer'
  | 'tagger'
  | 'abx'
  | 'gear'
  | 'radio'
  | 'recap'
  | 'settings'

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      uiMode: 'elegant',
      colorScheme: 'dark',
      accentColor: null,
      activeView: 'player',
      sidebarOpen: true,
      isInitialized: false,

      libraryPaths: [],
      autoScan: true,
      scanOnStartup: false,

      outputDeviceId: null,
      exclusiveMode: false,
      bitPerfect: false,
      bufferMs: 200,

      gapless: true,
      crossfadeDurationMs: 0,
      replayGainMode: 'off',
      lastError: null,

      isScanning: false,
      scanProgress: null,
      scanTotal: null,
      smtcRadio: null,

      setUiMode: (uiMode) => set({ uiMode }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setActiveView: (activeView) => set({ activeView }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      addLibraryPath: (path) => set((s) => ({ libraryPaths: s.libraryPaths.includes(path) ? s.libraryPaths : [...s.libraryPaths, path] })),
      removeLibraryPath: (path) => set((s) => ({ libraryPaths: s.libraryPaths.filter((p) => p !== path) })),
      setAutoScan: (autoScan) => set({ autoScan }),
      setScanOnStartup: (scanOnStartup) => set({ scanOnStartup }),
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
      setExclusiveMode: (exclusiveMode) => set({ exclusiveMode }),
      setBitPerfect: (bitPerfect) => set({ bitPerfect }),
      setBufferMs: (bufferMs) => set({ bufferMs }),
      setGapless: (gapless) => set({ gapless }),
      setCrossfadeDurationMs: (crossfadeDurationMs) => set({ crossfadeDurationMs }),
      setReplayGainMode: (replayGainMode) => set({ replayGainMode }),
      setLastError: (lastError) => set({ lastError }),
      setIsScanning: (isScanning) => set({ isScanning }),
      setScanProgress: (scanProgress) => set({ scanProgress }),
      setScanTotal: (scanTotal) => set({ scanTotal }),
      setSmtcRadio: (smtcRadio) => set({ smtcRadio }),
      clearSmtcRadio: () => set({ smtcRadio: null }),

      init: async () => {
        try {
          const engine = getAudioEngine()
          await engine.initialize()
          set({ isInitialized: true })
        } catch (e) {
          console.error('[AppStore] Failed to initialize audio engine:', e)
          set({ isInitialized: true })
        }
      },
    }),
    {
      name: 'ace-app-prefs',
      partialize: (s) => ({
        uiMode: s.uiMode,
        colorScheme: s.colorScheme,
        accentColor: s.accentColor,
        sidebarOpen: s.sidebarOpen,
        libraryPaths: s.libraryPaths,
        autoScan: s.autoScan,
        scanOnStartup: s.scanOnStartup,
        outputDeviceId: s.outputDeviceId,
        exclusiveMode: s.exclusiveMode,
        bitPerfect: s.bitPerfect,
        bufferMs: s.bufferMs,
        gapless: s.gapless,
        crossfadeDurationMs: s.crossfadeDurationMs,
        replayGainMode: s.replayGainMode,
      }),
    }
  )
)
