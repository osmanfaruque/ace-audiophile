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

  // ── A3.3.4 — SMTC / MediaSession integration ──────────
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession

    // Transport action handlers
    ms.setActionHandler('play', () => usePlaybackStore.getState().play())
    ms.setActionHandler('pause', () => usePlaybackStore.getState().pause())
    ms.setActionHandler('stop', () => usePlaybackStore.getState().stop())
    ms.setActionHandler('previoustrack', () => usePlaybackStore.getState().prev())
    ms.setActionHandler('nexttrack', () => usePlaybackStore.getState().next())
    ms.setActionHandler('seekto', (d) => {
      if (d.seekTime != null) usePlaybackStore.getState().seek(d.seekTime * 1000)
    })

    // Sync metadata + playback state on store changes
    let prevTrackId: string | null = null
    let prevStatus = ''
    const unsub = usePlaybackStore.subscribe((s) => {
      const { currentTrack: track, status } = s
      if (track && track.id !== prevTrackId) {
        ms.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album,
        })
        prevTrackId = track.id
      }
      if (status !== prevStatus) {
        ms.playbackState = status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none'
        prevStatus = status
      }
    })

    return unsub
  }, [])

  return <>{children}</>
}
