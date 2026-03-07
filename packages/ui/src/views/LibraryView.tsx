'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  FolderOpen, Search, Grid, List, ChevronUp, ChevronDown, Play, Star,
  Music2, Disc3, Mic2, Tag,
} from 'lucide-react'
import { usePlaybackStore } from '@/store/playbackStore'
import { useAppStore } from '@/store/appStore'
import { formatDuration, formatSampleRate, cn } from '@/lib/utils'
import type { AudioTrack, AudioCodec } from '@ace/types'

// ── Track factory ─────────────────────────────────────────────────────────────

function makeTrackFromPath(filePath: string, index: number): AudioTrack {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const title = fileName.replace(/\.[^.]+$/, '')
  const ext = (fileName.split('.').pop() ?? 'unknown').toLowerCase() as AudioCodec
  const valid: AudioCodec[] = ['flac','wav','aiff','alac','aac','mp3','ogg','opus','dsf','dff','wma','ape','wavpack','tta','mp4']
  const codec: AudioCodec = valid.includes(ext) ? ext : 'unknown'
  const now = Date.now()
  return {
    id: `local-${now}-${index}`, filePath, title,
    artist: 'Unknown Artist', albumArtist: 'Unknown Artist',
    album: 'Unknown Album', genre: '', year: null,
    trackNumber: null, totalTracks: null, discNumber: null, totalDiscs: null, comment: '',
    durationMs: 0, sampleRate: 0, bitDepth: 0, channels: 2, codec,
    bitrateKbps: 0, fileSizeBytes: 0,
    effectiveBitDepth: null, dynamicRange: null, lufs: null,
    truePeak: null, isLossyTranscode: null, lossyConfidence: null,
    replayGainTrack: null, replayGainAlbum: null,
    musicBrainzId: null, acoustId: null,
    albumId: `album-${now}-${index}`,
    dateAdded: now, dateModified: now, lastPlayed: null, playCount: 0,
  }
}

async function openAudioFiles(): Promise<string[]> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({
      multiple: true,
      filters: [{ name: 'Audio Files', extensions: ['flac','wav','aiff','aif','mp3','aac','m4a','opus','ogg','dsf','dff','ape','wv','wma'] }],
    })
    if (!result) return []
    return Array.isArray(result) ? result : [result]
  } catch { return [] }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = 'title' | 'artist' | 'album' | 'year' | 'codec' | 'sampleRate' | 'durationMs' | 'playCount' | 'rating'
type SortDir = 'asc' | 'desc'

// ── Star Rating widget ────────────────────────────────────────────────────────

function StarRating({
  value, onChange, size = 12,
}: { value: number; onChange?: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          onClick={(e) => { e.stopPropagation(); onChange?.(s === value ? 0 : s) }}
          onMouseEnter={() => setHover(s)}
          style={{ color: (hover || value) >= s ? '#f59e0b' : 'var(--ace-border)', lineHeight: 1 }}
        >
          <Star size={size} fill={(hover || value) >= s ? '#f59e0b' : 'none'} />
        </button>
      ))}
    </div>
  )
}

// ── Left side-panel (mode-aware) ──────────────────────────────────────────────

function SidePanel({
  mode, tracks, activeFilter, setFilter,
}: {
  mode: string
  tracks: AudioTrack[]
  activeFilter: string | null
  setFilter: (v: string | null) => void
}) {
  const mutedColor: React.CSSProperties = { color: 'var(--ace-text-muted)' }
  const borderLine = { borderColor: 'var(--ace-border)' }

  if (mode === 'genres') {
    const genres = useMemo(() => {
      const map = new Map<string, number>()
      tracks.forEach((t) => {
        const g = t.genre || 'Unknown Genre'
        map.set(g, (map.get(g) ?? 0) + 1)
      })
      return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    }, [tracks])
    return (
      <div className="w-48 shrink-0 flex flex-col border-r overflow-hidden"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
        <div className="px-3 py-2 text-xs uppercase tracking-widest border-b flex items-center gap-1.5"
          style={{ ...mutedColor, ...borderLine }}>
          <Tag size={11} /> Genres
        </div>
        {tracks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <span className="text-xs text-center" style={mutedColor}>No genres yet</span>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            <button
              onClick={() => setFilter(null)}
              className="w-full text-left px-3 py-1.5 text-xs border-b hover:bg-white/5 transition-colors"
              style={{ borderColor: 'var(--ace-border)', color: activeFilter === null ? 'var(--ace-accent)' : 'var(--ace-text-secondary)' }}>
              All Genres ({genres.length})
            </button>
            {genres.map(([genre, count]) => (
              <button key={genre} onClick={() => setFilter(genre)}
                className="w-full text-left px-3 py-1.5 border-b hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--ace-border)', background: activeFilter === genre ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center"
                    style={{ background: 'var(--ace-accent-dim)' }}>
                    <Music2 size={10} style={{ color: 'var(--ace-accent)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate" style={{ color: activeFilter === genre ? 'var(--ace-accent)' : 'var(--ace-text-primary)' }}>{genre}</p>
                    <p className="text-[10px]" style={mutedColor}>{count} track{count !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (mode === 'albums') {
    const albums = useMemo(() => {
      const map = new Map<string, { album: string; artist: string; count: number }>()
      tracks.forEach((t) => {
        const key = t.album
        if (!map.has(key)) map.set(key, { album: t.album, artist: t.albumArtist || t.artist, count: 0 })
        map.get(key)!.count++
      })
      return Array.from(map.values()).sort((a, b) => a.album.localeCompare(b.album))
    }, [tracks])
    return (
      <div className="w-48 shrink-0 flex flex-col border-r overflow-hidden"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
        <div className="px-3 py-2 text-xs uppercase tracking-widest border-b flex items-center gap-1.5"
          style={{ ...mutedColor, ...borderLine }}>
          <Disc3 size={11} /> Albums
        </div>
        {tracks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <span className="text-xs text-center" style={mutedColor}>No albums yet</span>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            <button onClick={() => setFilter(null)}
              className="w-full text-left px-3 py-1.5 text-xs border-b hover:bg-white/5 transition-colors"
              style={{ borderColor: 'var(--ace-border)', color: activeFilter === null ? 'var(--ace-accent)' : 'var(--ace-text-secondary)' }}>
              All Albums ({albums.length})
            </button>
            {albums.map(({ album, artist, count }) => (
              <button key={album} onClick={() => setFilter(album)}
                className="w-full text-left px-3 py-1.5 border-b hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--ace-border)', background: activeFilter === album ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center"
                    style={{ background: 'var(--ace-accent-dim)' }}>
                    <Disc3 size={12} style={{ color: 'var(--ace-accent)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate" style={{ color: activeFilter === album ? 'var(--ace-accent)' : 'var(--ace-text-primary)' }}>{album}</p>
                    <p className="text-[10px] truncate" style={mutedColor}>{artist} · {count} track{count !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Default: artists (library / artists mode)
  const artists = useMemo(() => {
    const map = new Map<string, number>()
    tracks.forEach((t) => map.set(t.artist, (map.get(t.artist) ?? 0) + 1))
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [tracks])
  return (
    <div className="w-48 shrink-0 flex flex-col border-r overflow-hidden"
      style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
      <div className="px-3 py-2 text-xs uppercase tracking-widest border-b flex items-center gap-1.5"
        style={{ ...mutedColor, ...borderLine }}>
        <Mic2 size={11} /> Artists
      </div>
      {tracks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <span className="text-xs text-center" style={mutedColor}>No artists yet</span>
        </div>
      ) : (
        <div className="overflow-y-auto flex-1">
          <button onClick={() => setFilter(null)}
            className="w-full text-left px-3 py-1.5 text-xs border-b hover:bg-white/5 transition-colors"
            style={{ borderColor: 'var(--ace-border)', color: activeFilter === null ? 'var(--ace-accent)' : 'var(--ace-text-secondary)' }}>
            All Artists ({artists.length})
          </button>
          {artists.map(([artist, count]) => (
            <button key={artist} onClick={() => setFilter(artist)}
              className="w-full text-left px-3 py-1.5 border-b hover:bg-white/5 transition-colors"
              style={{ borderColor: 'var(--ace-border)', background: activeFilter === artist ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold"
                  style={{ background: 'var(--ace-accent-dim)', color: 'var(--ace-accent)' }}>
                  {artist[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0">
                  <p className="text-xs truncate" style={{ color: activeFilter === artist ? 'var(--ace-accent)' : 'var(--ace-text-primary)' }}>{artist}</p>
                  <p className="text-[10px]" style={mutedColor}>{count} track{count !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LibraryView({ mode }: { mode: string }) {
  const store      = usePlaybackStore()
  const { uiMode } = useAppStore()
  const techie     = uiMode === 'techie'

  // Derive flat track list from queue (Phase 1 source)
  const tracks = useMemo(() =>
    store.queue.map((qi) => {
      const t = store.currentTrack?.id === qi.trackId ? store.currentTrack : null
      return t ?? makeTrackFromPath(qi.trackId, qi.position)
    }),
  [store.queue, store.currentTrack])

  // ── Local state ──────────────────────────────────────────
  const [search,      setSearch]      = useState('')
  const [sortKey,     setSortKey]     = useState<SortKey>('title')
  const [sortDir,     setSortDir]     = useState<SortDir>('asc')
  const [selected,    setSelected]    = useState<string | null>(null)
  const [gridView,    setGridView]    = useState(false)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  // Per-track ratings stored locally (Phase 1; will move to DB in Phase 2)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const setRating = useCallback((id: string, val: number) =>
    setRatings((prev) => ({ ...prev, [id]: val })), [])

  // ── Filtering ────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase()

    let list = tracks.filter((t) => {
      // Text search
      if (q && !(
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q)
      )) return false

      // Side-panel filter
      if (activeFilter !== null) {
        if (mode === 'genres')  return (t.genre || 'Unknown Genre') === activeFilter
        if (mode === 'albums')  return t.album === activeFilter
        return t.artist === activeFilter   // artists / library
      }
      return true
    })

    list = list.slice().sort((a, b) => {
      let av: string | number
      let bv: string | number
      if (sortKey === 'rating') {
        av = ratings[a.id] ?? 0
        bv = ratings[b.id] ?? 0
      } else {
        av = a[sortKey] ?? ''
        bv = b[sortKey] ?? ''
      }
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [tracks, search, sortKey, sortDir, activeFilter, mode, ratings])

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else setSortDir('asc')
      return key
    })
  }, [])

  // ── Actions ───────────────────────────────────────────────
  const handleOpenFiles = useCallback(async () => {
    const paths = await openAudioFiles()
    if (!paths.length) return
    const newTracks = paths.map(makeTrackFromPath)
    store.addToQueue(newTracks)
    if (!store.currentTrack) {
      try {
        const { getAudioEngine } = await import('@/lib/audioEngine')
        await getAudioEngine().openFile(newTracks[0].filePath)
        store._onTrackChange(newTracks[0])
      } catch {}
      await store.play(newTracks[0].id)
    }
  }, [store])

  const handlePlayTrack = useCallback(async (track: AudioTrack) => {
    try {
      const { getAudioEngine } = await import('@/lib/audioEngine')
      await getAudioEngine().openFile(track.filePath)
      store._onTrackChange(track)
    } catch {}
    await store.play(track.id)
  }, [store])

  // ── Style helpers ─────────────────────────────────────────
  const mutedColor: React.CSSProperties  = { color: 'var(--ace-text-muted)' }
  const trackColor: React.CSSProperties  = { color: 'var(--ace-text-primary)' }

  // ── Column definitions ────────────────────────────────────
  const COLS: { key: SortKey; label: string; mono?: boolean }[] = [
    { key: 'title',      label: 'Title'  },
    { key: 'artist',     label: 'Artist' },
    { key: 'album',      label: 'Album'  },
    { key: 'year',       label: 'Year',  mono: true },
    { key: 'codec',      label: 'Format',mono: true },
    { key: 'sampleRate', label: 'SR',    mono: true },
    { key: 'durationMs', label: 'Time',  mono: true },
    { key: 'playCount',  label: 'Plays', mono: true },
    { key: 'rating',     label: 'Rating' },
  ]

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--ace-bg)' }}>

      {/* ══ Left panel (mode-aware) ══ */}
      {!techie && (
        <SidePanel
          mode={mode}
          tracks={tracks}
          activeFilter={activeFilter}
          setFilter={setActiveFilter}
        />
      )}

      {/* ══ Center ══ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>

          {/* Mode label */}
          <span className="text-xs font-semibold uppercase tracking-widest hidden sm:block"
            style={{ color: 'var(--ace-text-muted)' }}>
            {mode === 'genres' ? 'Genres' : mode === 'albums' ? 'Albums' : mode === 'artists' ? 'Artists' : 'Library'}
          </span>

          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={mutedColor} />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-7 pr-3 py-1.5 rounded-lg text-xs focus:outline-none"
              style={{
                background: 'var(--ace-surface)', color: 'var(--ace-text-primary)',
                border: '1px solid var(--ace-border)', width: 190,
              }}
            />
          </div>

          {activeFilter && (
            <button
              onClick={() => setActiveFilter(null)}
              className="text-xs px-2 py-0.5 rounded-full transition-colors hover:opacity-70"
              style={{ background: 'var(--ace-accent)', color: '#fff' }}>
              {activeFilter} ×
            </button>
          )}

          <span className="text-xs" style={mutedColor}>
            {filtered.length} track{filtered.length !== 1 ? 's' : ''}
          </span>

          <div className="flex-1" />

          {/* View toggle */}
          <button onClick={() => setGridView(false)}
            className={cn('p-1.5 rounded transition-colors', !gridView ? 'bg-white/10' : 'hover:bg-white/5')}
            style={{ color: !gridView ? 'var(--ace-accent)' : 'var(--ace-text-muted)' }}>
            <List size={15} />
          </button>
          <button onClick={() => setGridView(true)}
            className={cn('p-1.5 rounded transition-colors', gridView ? 'bg-white/10' : 'hover:bg-white/5')}
            style={{ color: gridView ? 'var(--ace-accent)' : 'var(--ace-text-muted)' }}>
            <Grid size={15} />
          </button>

          <button onClick={handleOpenFiles}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all hover:bg-white/10"
            style={{ color: 'var(--ace-text-secondary)' }}>
            <FolderOpen size={13} />
            Open Files
          </button>
        </div>

        {/* Empty state */}
        {tracks.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--ace-surface)', border: '1px solid var(--ace-border)' }}>
              <FolderOpen size={32} style={{ color: 'var(--ace-text-muted)' }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--ace-text-secondary)' }}>Your library is empty</p>
              <p className="text-xs mt-1" style={mutedColor}>Open audio files to start listening</p>
            </div>
            <button onClick={handleOpenFiles}
              className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold transition-all hover:scale-105 active:scale-95"
              style={{ background: 'var(--ace-accent)', color: '#fff', boxShadow: '0 0 20px var(--ace-accent-glow)' }}>
              <FolderOpen size={15} />
              Open Audio Files
            </button>
          </div>
        )}

        {/* Track table */}
        {tracks.length > 0 && !gridView && (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--ace-bg-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
                  {COLS.map(({ key, label }) => (
                    <th key={key}
                      onClick={() => toggleSort(key)}
                      className="px-3 py-2 text-left font-semibold cursor-pointer hover:bg-white/5 transition-colors select-none border-b whitespace-nowrap"
                      style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-muted)', userSelect: 'none' }}>
                      <span className="flex items-center gap-1">
                        {label}
                        {sortKey === key && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                      </span>
                    </th>
                  ))}
                  <th className="w-12 border-b" style={{ borderColor: 'var(--ace-border)' }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((track, idx) => {
                  const isPlaying = track.id === store.currentTrack?.id
                  const isSel    = track.id === selected
                  return (
                    <tr
                      key={track.id}
                      onClick={() => setSelected(track.id)}
                      onDoubleClick={() => handlePlayTrack(track)}
                      className="border-b cursor-pointer transition-colors hover:bg-white/[0.04]"
                      style={{
                        borderColor: 'var(--ace-border)',
                        background: isPlaying
                          ? 'rgba(124,106,255,0.08)'
                          : isSel ? 'rgba(255,255,255,0.04)'
                          : idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                      }}
                    >
                      {/* Title */}
                      <td className="px-3 py-1.5 max-w-[200px] truncate"
                        style={{ color: isPlaying ? 'var(--ace-accent)' : 'var(--ace-text-primary)' }}>
                        {isPlaying && <span className="mr-1">▶</span>}
                        {track.title}
                      </td>
                      {/* Artist */}
                      <td className="px-3 py-1.5 max-w-[140px] truncate" style={mutedColor}>{track.artist}</td>
                      {/* Album */}
                      <td className="px-3 py-1.5 max-w-[140px] truncate" style={mutedColor}>{track.album}</td>
                      {/* Year */}
                      <td className="px-3 py-1.5 tabular-nums" style={{ ...mutedColor, fontFamily: 'var(--ace-font-mono)' }}>{track.year ?? '—'}</td>
                      {/* Format */}
                      <td className="px-3 py-1.5 whitespace-nowrap" style={{ ...mutedColor, fontFamily: 'var(--ace-font-mono)' }}>
                        {track.codec.toUpperCase()}
                        {track.bitDepth > 0 && <span className="opacity-60 ml-0.5 text-[10px]">{track.bitDepth}b</span>}
                      </td>
                      {/* SR */}
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap" style={{ ...mutedColor, fontFamily: 'var(--ace-font-mono)' }}>
                        {track.sampleRate > 0 ? formatSampleRate(track.sampleRate) : '—'}
                      </td>
                      {/* Duration */}
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap" style={{ ...mutedColor, fontFamily: 'var(--ace-font-mono)' }}>
                        {track.durationMs > 0 ? formatDuration(track.durationMs) : '—'}
                      </td>
                      {/* Play count */}
                      <td className="px-3 py-1.5 tabular-nums text-center" style={{ ...mutedColor, fontFamily: 'var(--ace-font-mono)' }}>
                        {track.playCount > 0 ? track.playCount : '—'}
                      </td>
                      {/* Rating */}
                      <td className="px-3 py-1.5">
                        <StarRating
                          value={ratings[track.id] ?? 0}
                          onChange={(v) => setRating(track.id, v)}
                          size={11}
                        />
                      </td>
                      {/* Play button */}
                      <td className="px-2 py-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePlayTrack(track) }}
                          className="p-1 rounded hover:bg-white/10 transition-colors"
                          style={{ color: 'var(--ace-text-muted)' }}>
                          <Play size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Grid view */}
        {tracks.length > 0 && gridView && (
          <div className="flex-1 overflow-auto p-4">
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))' }}>
              {filtered.map((track) => {
                const isPlaying = track.id === store.currentTrack?.id
                return (
                  <button
                    key={track.id}
                    onDoubleClick={() => handlePlayTrack(track)}
                    onClick={() => setSelected(track.id)}
                    className="rounded-xl p-3 text-left transition-all hover:scale-[1.03] group"
                    style={{
                      background: isPlaying ? 'rgba(124,106,255,0.12)' : 'var(--ace-surface)',
                      border: `1px solid ${isPlaying ? 'var(--ace-accent)' : 'var(--ace-border)'}`,
                    }}>
                    <div className="w-full aspect-square rounded-lg mb-2 flex items-center justify-center relative overflow-hidden"
                      style={{ background: 'var(--ace-bg-elevated)' }}>
                      <span style={{ fontSize: 32, color: 'var(--ace-accent)' }}>♪</span>
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Play size={24} fill="white" stroke="none" />
                      </div>
                    </div>
                    <p className="text-xs font-medium truncate" style={trackColor}>{track.title}</p>
                    <p className="text-[10px] truncate mt-0.5" style={mutedColor}>{track.artist}</p>
                    <div className="mt-1.5">
                      <StarRating
                        value={ratings[track.id] ?? 0}
                        onChange={(v) => setRating(track.id, v)}
                        size={10}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══ Right: Now Playing panel ══ */}
      {!techie && store.currentTrack && (
        <div className="w-56 shrink-0 border-l flex flex-col overflow-hidden"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
          <div className="px-3 py-2 text-xs uppercase tracking-widest border-b"
            style={{ color: 'var(--ace-text-muted)', borderColor: 'var(--ace-border)' }}>
            Now Playing
          </div>

          {/* Album art */}
          <div className="mx-3 mt-3 rounded-xl overflow-hidden aspect-square flex items-center justify-center"
            style={{ background: 'var(--ace-surface)', border: '1px solid var(--ace-border)' }}>
            <span style={{ fontSize: 52, color: 'var(--ace-accent)' }}>♪</span>
          </div>

          {/* Track info */}
          <div className="px-3 mt-3 flex-1 min-h-0 overflow-auto">
            <p className="text-sm font-semibold truncate" style={trackColor}>{store.currentTrack.title}</p>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ace-text-secondary)' }}>{store.currentTrack.artist}</p>
            <p className="text-xs opacity-60 truncate" style={{ color: 'var(--ace-text-secondary)' }}>{store.currentTrack.album}</p>

            {/* Star rating for current track */}
            <div className="mt-3">
              <StarRating
                value={ratings[store.currentTrack.id] ?? 0}
                onChange={(v) => setRating(store.currentTrack!.id, v)}
                size={14}
              />
            </div>

            {/* Technical info */}
            <div className="mt-3 space-y-1">
              {([
                ['Codec',   store.currentTrack.codec.toUpperCase()],
                ['Rate',    store.currentTrack.sampleRate > 0 ? formatSampleRate(store.currentTrack.sampleRate) : '—'],
                ['Depth',   store.currentTrack.bitDepth > 0 ? `${store.currentTrack.bitDepth}-bit` : '—'],
                ['Bitrate', store.currentTrack.bitrateKbps > 0 ? `${store.currentTrack.bitrateKbps} kbps` : 'Lossless'],
                ['Plays',   String(store.currentTrack.playCount)],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span style={mutedColor}>{k}</span>
                  <span style={{ ...trackColor, fontFamily: 'var(--ace-font-mono)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
