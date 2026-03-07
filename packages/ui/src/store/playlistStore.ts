import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Playlist, SmartPlaylistRule, AudioTrack } from '@ace/types'

interface PlaylistEntry {
  playlist: Playlist
  trackIds: string[]   // ordered list of track IDs
}

interface PlaylistStore {
  entries: PlaylistEntry[]
  activeId: string | null

  // CRUD
  createPlaylist: (name: string, smart?: boolean, rules?: SmartPlaylistRule[]) => string
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  setActive: (id: string | null) => void

  // Track management
  addTracks: (playlistId: string, trackIds: string[]) => void
  removeTrack: (playlistId: string, trackId: string) => void
  reorderTrack: (playlistId: string, fromIdx: number, toIdx: number) => void

  // Smart playlist rules
  updateRules: (playlistId: string, rules: SmartPlaylistRule[]) => void

  // Helpers
  getEntry: (id: string) => PlaylistEntry | undefined
}

function uid() {
  return `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export const usePlaylistStore = create<PlaylistStore>()(
  persist(
    (set, get) => ({
      entries: [],
      activeId: null,

      createPlaylist: (name, smart = false, rules = []) => {
        const id = uid()
        const now = Date.now()
        set((s) => ({
          entries: [
            ...s.entries,
            {
              playlist: {
                id, name,
                description: '',
                createdAt: now,
                modifiedAt: now,
                trackCount: 0,
                isSmartPlaylist: smart,
                rules: smart ? rules : undefined,
              },
              trackIds: [],
            },
          ],
          activeId: id,
        }))
        return id
      },

      renamePlaylist: (id, name) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.playlist.id === id
              ? { ...e, playlist: { ...e.playlist, name, modifiedAt: Date.now() } }
              : e,
          ),
        })),

      deletePlaylist: (id) =>
        set((s) => ({
          entries: s.entries.filter((e) => e.playlist.id !== id),
          activeId: s.activeId === id
            ? (s.entries.find((e) => e.playlist.id !== id)?.playlist.id ?? null)
            : s.activeId,
        })),

      setActive: (activeId) => set({ activeId }),

      addTracks: (playlistId, trackIds) =>
        set((s) => ({
          entries: s.entries.map((e) => {
            if (e.playlist.id !== playlistId) return e
            const existing = new Set(e.trackIds)
            const fresh = trackIds.filter((id) => !existing.has(id))
            const newIds = [...e.trackIds, ...fresh]
            return {
              ...e,
              trackIds: newIds,
              playlist: { ...e.playlist, trackCount: newIds.length, modifiedAt: Date.now() },
            }
          }),
        })),

      removeTrack: (playlistId, trackId) =>
        set((s) => ({
          entries: s.entries.map((e) => {
            if (e.playlist.id !== playlistId) return e
            const newIds = e.trackIds.filter((id) => id !== trackId)
            return {
              ...e,
              trackIds: newIds,
              playlist: { ...e.playlist, trackCount: newIds.length, modifiedAt: Date.now() },
            }
          }),
        })),

      reorderTrack: (playlistId, fromIdx, toIdx) =>
        set((s) => ({
          entries: s.entries.map((e) => {
            if (e.playlist.id !== playlistId) return e
            const ids = [...e.trackIds]
            const [moved] = ids.splice(fromIdx, 1)
            ids.splice(toIdx, 0, moved)
            return { ...e, trackIds: ids }
          }),
        })),

      updateRules: (playlistId, rules) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.playlist.id === playlistId
              ? { ...e, playlist: { ...e.playlist, rules, modifiedAt: Date.now() } }
              : e,
          ),
        })),

      getEntry: (id) => get().entries.find((e) => e.playlist.id === id),
    }),
    {
      name: 'ace-playlists',
    },
  ),
)
