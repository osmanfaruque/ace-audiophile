'use client'

import { useEffect, type ReactNode } from 'react'
import { useAppStore } from '@/store/appStore'
import { usePlaybackStore } from '@/store/playbackStore'
import { useDspStore } from '@/store/dspStore'
import { getAudioEngine } from '@/lib/audioEngine'

/**
 * AppProviders — wraps the entire app with:
 *  - Theme sync (applies data-* attributes to <html>)
 *  - Tauri event listeners → Zustand store
 *  - App initialization
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const { uiMode, colorScheme, init } = useAppStore()

  // Apply design tokens to <html> element
  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-ui-mode', uiMode)
    html.setAttribute('data-color-scheme', colorScheme)
  }, [uiMode, colorScheme])

  // Initialize app (load preferences, detect audio devices)
  useEffect(() => {
    init()
  }, [init])

  // ── A3.2 — Wire engine events to Zustand stores ──────
  useEffect(() => {
    const engine = getAudioEngine()
    const cleanups: (() => void)[] = []

    // A3.2.1 — FFT + level meter → dspStore
    engine.onFftFrame((frame) => {
      useDspStore.getState()._setFftFrame(frame)
    }).then((off) => cleanups.push(off))

    engine.onLevelMeter((meter) => {
      useDspStore.getState()._setLevelMeter(meter)
    }).then((off) => cleanups.push(off))

    // A3.2.2 — Position → playbackStore
    engine.onPositionUpdate((positionMs) => {
      usePlaybackStore.getState()._onPositionUpdate(positionMs)
    }).then((off) => cleanups.push(off))

    // A3.2.3 — Track change → playbackStore
    engine.onTrackChange((track) => {
      usePlaybackStore.getState()._onTrackChange(track)
    }).then((off) => cleanups.push(off))

    // A3.2.4 — Engine errors → appStore + console
    engine.onError((message) => {
      console.error('[Engine Error]', message)
      useAppStore.getState().setLastError(message)
    }).then((off) => cleanups.push(off))

    return () => {
      cleanups.forEach((off) => off())
    }
  }, [])

  return <>{children}</>
}
