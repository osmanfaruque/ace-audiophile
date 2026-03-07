import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UiMode, ColorScheme, AppPreferences } from '@ace/types'
import { getAudioEngine } from '@/lib/audioEngine'

interface AppState {
  uiMode: UiMode
  colorScheme: ColorScheme
  activeView: AppView
  sidebarOpen: boolean
  isInitialized: boolean

  // Actions
  setUiMode: (mode: UiMode) => void
  setColorScheme: (scheme: ColorScheme) => void
  setActiveView: (view: AppView) => void
  toggleSidebar: () => void
  init: () => Promise<void>
}

export type AppView =
  | 'player'
  | 'library'
  | 'albums'
  | 'artists'
  | 'equalizer'
  | 'analyzer'
  | 'tagger'
  | 'abx'
  | 'gear'
  | 'recap'
  | 'settings'

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      uiMode: 'beautiful',
      colorScheme: 'dark',
      activeView: 'player',
      sidebarOpen: true,
      isInitialized: false,

      setUiMode: (uiMode) => set({ uiMode }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
      setActiveView: (activeView) => set({ activeView }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      init: async () => {
        try {
          const engine = getAudioEngine()
          await engine.initialize()
          set({ isInitialized: true })
        } catch (e) {
          console.error('[AppStore] Failed to initialize audio engine:', e)
          set({ isInitialized: true }) // proceed with degraded mode
        }
      },
    }),
    {
      name: 'ace-app-prefs',
      partialize: (s) => ({
        uiMode: s.uiMode,
        colorScheme: s.colorScheme,
        sidebarOpen: s.sidebarOpen,
      }),
    }
  )
)
