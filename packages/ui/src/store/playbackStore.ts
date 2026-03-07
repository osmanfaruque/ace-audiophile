import { create } from 'zustand'
import type { PlaybackState, PlaybackStatus, RepeatMode, ShuffleMode, AudioTrack, QueueItem } from '@ace/types'
import { getAudioEngine } from '@/lib/audioEngine'

interface PlaybackStore extends PlaybackState {
  queue: QueueItem[]
  currentTrack: AudioTrack | null

  // Actions
  play: (trackId?: string) => Promise<void>
  pause: () => void
  stop: () => void
  seek: (positionMs: number) => void
  next: () => Promise<void>
  prev: () => Promise<void>
  setVolume: (volume: number) => void
  setRepeat: (repeat: RepeatMode) => void
  setShuffle: (shuffle: ShuffleMode) => void
  addToQueue: (tracks: AudioTrack[]) => void
  clearQueue: () => void
  removeFromQueue: (queueId: string) => void
  reorderQueue: (fromIndex: number, toIndex: number) => void

  // Called by engine events
  _onPositionUpdate: (positionMs: number) => void
  _onStatusChange: (status: PlaybackStatus) => void
  _onTrackChange: (track: AudioTrack | null) => void
}

export const usePlaybackStore = create<PlaybackStore>()((set, get) => ({
  // Initial state
  status: 'idle',
  currentTrackId: null,
  currentTrack: null,
  positionMs: 0,
  durationMs: 0,
  volume: 1.0,
  repeat: 'none',
  shuffle: 'off',
  deviceId: null,
  queue: [],

  play: async (trackId) => {
    const engine = getAudioEngine()
    if (trackId) {
      await engine.openTrack(trackId)
    }
    await engine.play()
    set({ status: 'playing' })
  },

  pause: () => {
    getAudioEngine().pause()
    set({ status: 'paused' })
  },

  stop: () => {
    getAudioEngine().stop()
    set({ status: 'idle', positionMs: 0 })
  },

  seek: (positionMs) => {
    getAudioEngine().seek(positionMs)
    set({ positionMs })
  },

  next: async () => {
    const { queue, currentTrackId } = get()
    const idx = queue.findIndex((q) => q.trackId === currentTrackId)
    const next = queue[idx + 1]
    if (next) await get().play(next.trackId)
  },

  prev: async () => {
    const { queue, currentTrackId, positionMs } = get()
    // If > 3s in, restart; otherwise go to previous
    if (positionMs > 3000) {
      get().seek(0)
      return
    }
    const idx = queue.findIndex((q) => q.trackId === currentTrackId)
    const prev = queue[idx - 1]
    if (prev) await get().play(prev.trackId)
  },

  setVolume: (volume) => {
    getAudioEngine().setVolume(volume)
    set({ volume })
  },

  setRepeat: (repeat) => set({ repeat }),
  setShuffle: (shuffle) => set({ shuffle }),

  addToQueue: (tracks) =>
    set((s) => ({
      queue: [
        ...s.queue,
        ...tracks.map((t, i) => ({
          queueId: `q-${Date.now()}-${i}`,
          trackId: t.id,
          position: s.queue.length + i,
        })),
      ],
    })),

  clearQueue: () => set({ queue: [] }),

  removeFromQueue: (queueId) =>
    set((s) => ({ queue: s.queue.filter((q) => q.queueId !== queueId) })),

  reorderQueue: (fromIdx, toIdx) =>
    set((s) => {
      const q = [...s.queue]
      const [item] = q.splice(fromIdx, 1)
      q.splice(toIdx, 0, item)
      return { queue: q.map((item, i) => ({ ...item, position: i })) }
    }),

  _onPositionUpdate: (positionMs) => set({ positionMs }),
  _onStatusChange: (status) => set({ status }),
  _onTrackChange: (track) =>
    set({ currentTrack: track, currentTrackId: track?.id ?? null, durationMs: track?.durationMs ?? 0 }),
}))
