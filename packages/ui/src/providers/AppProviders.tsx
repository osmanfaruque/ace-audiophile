'use client'

import { useEffect, useRef, type ReactNode } from 'react'
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
  const listenStartRef = useRef<number | null>(null)
  const listenTrackRef = useRef<string | null>(null)

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

  // A5.3.2/A5.3.6 — persist listening session events for recap stats
  useEffect(() => {
    const unsub = usePlaybackStore.subscribe((s) => {
      const currentPath = s.currentTrack?.filePath ?? s.currentTrack?.id ?? null

      if (currentPath && currentPath !== listenTrackRef.current) {
        const previousPath = listenTrackRef.current
        const previousStart = listenStartRef.current
        if (previousPath && previousStart) {
          const endedAt = Date.now()
          const completed = s.durationMs > 0 ? s.positionMs >= s.durationMs * 0.8 : false
          getAudioEngine().logListeningEvent(previousPath, previousStart, endedAt, completed).catch(() => {})
        }
        listenTrackRef.current = currentPath
        listenStartRef.current = Date.now()
      }

      if (!currentPath && listenTrackRef.current && listenStartRef.current) {
        const endedAt = Date.now()
        const completed = s.durationMs > 0 ? s.positionMs >= s.durationMs * 0.8 : false
        getAudioEngine()
          .logListeningEvent(listenTrackRef.current, listenStartRef.current, endedAt, completed)
          .catch(() => {})
        listenTrackRef.current = null
        listenStartRef.current = null
      }
    })

    return unsub
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
    let prevSmtcSig = ''
    let prevStatus = ''
    const unsub = usePlaybackStore.subscribe((s) => {
      const { currentTrack: track, status } = s
      const smtcRadio = useAppStore.getState().smtcRadio

      if (smtcRadio) {
        const sig = `${smtcRadio.stationName}::${smtcRadio.icyTitle}`
        if (sig !== prevSmtcSig) {
          ms.metadata = new MediaMetadata({
            title: smtcRadio.icyTitle || smtcRadio.stationName,
            artist: smtcRadio.stationName,
            album: 'Internet Radio',
          })
          prevSmtcSig = sig
        }
      } else if (track && track.id !== prevTrackId) {
        ms.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album,
        })
        prevTrackId = track.id
        prevSmtcSig = ''
      }

      if (status !== prevStatus) {
        ms.playbackState = status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none'
        prevStatus = status
      }
    })

    // React to radio SMTC metadata updates even when playback track object does not change.
    const unsubApp = useAppStore.subscribe((state) => {
      const smtcRadio = state.smtcRadio
      if (!smtcRadio) return
      const sig = `${smtcRadio.stationName}::${smtcRadio.icyTitle}`
      if (sig === prevSmtcSig) return
      ms.metadata = new MediaMetadata({
        title: smtcRadio.icyTitle || smtcRadio.stationName,
        artist: smtcRadio.stationName,
        album: 'Internet Radio',
      })
      prevSmtcSig = sig
    })

    return () => {
      unsub()
      unsubApp()
    }
  }, [])

  return <>{children}</>
}
