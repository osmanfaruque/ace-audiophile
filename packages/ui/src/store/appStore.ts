import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UiMode, ColorScheme, AppPreferences } from '@ace/types'
import { getAudioEngine } from '@/lib/audioEngine'

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
      uiMode: 'beautiful',
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
