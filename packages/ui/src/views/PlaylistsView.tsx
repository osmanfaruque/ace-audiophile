'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Plus, Trash2, Edit2, Check, X, Play, GripVertical,
  ListMusic, Zap, Upload, Download, Music2,
} from 'lucide-react'
import { usePlaylistStore } from '@/store/playlistStore'
import { usePlaybackStore } from '@/store/playbackStore'
import { formatDuration, cn } from '@/lib/utils'
import type { SmartPlaylistRule, AudioTrack, AudioCodec } from '@ace/types'
import { getAudioEngine } from '@/lib/audioEngine'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTrackFromPath(filePath: string, index: number): AudioTrack {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const title    = fileName.replace(/\.[^.]+$/, '')
  const ext      = (fileName.split('.').pop() ?? 'unknown').toLowerCase() as AudioCodec
  const valid: AudioCodec[] = ['flac','wav','aiff','alac','aac','mp3','ogg','opus','dsf','dff','wma','ape','wavpack','tta','mp4']
  const codec: AudioCodec   = valid.includes(ext) ? ext : 'unknown'
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

// Export playlist as M3U
function exportM3U(name: string, tracks: AudioTrack[]) {
  const lines = ['#EXTM3U', '']
  tracks.forEach((t) => {
    const secs = Math.round(t.durationMs / 1000)
    lines.push(`#EXTINF:${secs},${t.artist} - ${t.title}`)
    lines.push(t.filePath)
  })
  const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `${name}.m3u`; a.click()
  URL.revokeObjectURL(url)
}

// Import M3U — returns array of file paths
async function importM3U(): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.m3u,.m3u8'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve([])
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        const paths = text.split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
        resolve(paths)
      }
      reader.readAsText(file)
    }
    input.click()
  })
}

// ── Smart rule field options ──────────────────────────────────────────────────

const RULE_FIELDS: { value: keyof AudioTrack; label: string }[] = [
  { value: 'artist',    label: 'Artist'   },
  { value: 'album',     label: 'Album'    },
  { value: 'genre',     label: 'Genre'    },
  { value: 'year',      label: 'Year'     },
  { value: 'codec',     label: 'Format'   },
  { value: 'playCount', label: 'Play count' },
  { value: 'bitDepth',  label: 'Bit depth' },
  { value: 'sampleRate',label: 'Sample rate' },
]

const RULE_OPS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'eq',         label: 'is'           },
  { value: 'neq',        label: 'is not'       },
  { value: 'contains',   label: 'contains'     },
  { value: 'startsWith', label: 'starts with'  },
  { value: 'gt',         label: 'greater than' },
  { value: 'lt',         label: 'less than'    },
]

// ── Inline rename input ───────────────────────────────────────────────────────

function InlineRename({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(initial)
  return (
    <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel() }}
        className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded outline-none"
        style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)', border: '1px solid var(--ace-accent)' }}
      />
      <button onClick={() => onSave(val)} className="p-0.5 rounded" style={{ color: 'var(--ace-accent)' }}><Check size={12} /></button>
      <button onClick={onCancel} className="p-0.5 rounded" style={{ color: 'var(--ace-text-muted)' }}><X size={12} /></button>
    </div>
  )
}

// ── Smart rules editor ────────────────────────────────────────────────────────

function SmartRulesEditor({ rules, onChange }: { rules: SmartPlaylistRule[]; onChange: (r: SmartPlaylistRule[]) => void }) {
  const addRule = () => onChange([...rules, { field: 'artist', operator: 'contains', value: '' }])
  const update  = (i: number, patch: Partial<SmartPlaylistRule>) =>
    onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const remove  = (i: number) => onChange(rules.filter((_, idx) => idx !== i))

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl" style={{ background: 'var(--ace-bg)', border: '1px solid var(--ace-border)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: 'var(--ace-text-muted)' }}>Match all rules</span>
        <button
          onClick={addRule}
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors hover:opacity-80"
          style={{ background: 'var(--ace-accent)', color: '#fff' }}>
          <Plus size={10} /> Add Rule
        </button>
      </div>

      {rules.length === 0 && (
        <p className="text-xs text-center py-2" style={{ color: 'var(--ace-text-muted)' }}>
          No rules yet — all tracks will match
        </p>
      )}

      {rules.map((rule, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <select
            value={rule.field as string}
            onChange={(e) => update(i, { field: e.target.value as keyof AudioTrack })}
            className="text-xs rounded px-1.5 py-1 outline-none"
            style={{ background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-primary)', border: '1px solid var(--ace-border)' }}>
            {RULE_FIELDS.map((f) => <option key={f.value as string} value={f.value as string}>{f.label}</option>)}
          </select>
          <select
            value={rule.operator}
            onChange={(e) => update(i, { operator: e.target.value as SmartPlaylistRule['operator'] })}
            className="text-xs rounded px-1.5 py-1 outline-none"
            style={{ background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-primary)', border: '1px solid var(--ace-border)' }}>
            {RULE_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            value={String(rule.value)}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value"
            className="flex-1 min-w-20 text-xs px-2 py-1 rounded outline-none"
            style={{ background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-primary)', border: '1px solid var(--ace-border)' }}
          />
          <button onClick={() => remove(i)} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--ace-text-muted)' }}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Drag-reorder track row ────────────────────────────────────────────────────

function DraggableTrackRow({
  track, index, isPlaying, onPlay, onRemove,
  onDragStart, onDragOver, onDrop,
}: {
  track: AudioTrack; index: number; isPlaying: boolean
  onPlay: () => void; onRemove: () => void
  onDragStart: (i: number) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (i: number) => void
}) {
  return (
    <tr
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e) }}
      onDrop={() => onDrop(index)}
      className="border-b group cursor-grab active:cursor-grabbing transition-colors hover:bg-white/4"
      style={{ borderColor: 'var(--ace-border)', background: isPlaying ? 'rgba(124,106,255,0.08)' : 'transparent' }}
    >
      <td className="px-2 py-1.5 w-8 text-center">
        <GripVertical size={13} className="opacity-30 group-hover:opacity-70 transition-opacity" style={{ color: 'var(--ace-text-muted)' }} />
      </td>
      <td className="px-2 py-1.5 w-8 text-center tabular-nums text-xs" style={{ color: 'var(--ace-text-muted)' }}>
        {isPlaying ? <span style={{ color: 'var(--ace-accent)' }}>▶</span> : index + 1}
      </td>
      <td className="px-3 py-1.5 max-w-50 truncate text-xs"
        style={{ color: isPlaying ? 'var(--ace-accent)' : 'var(--ace-text-primary)' }}>
        {track.title}
      </td>
      <td className="px-3 py-1.5 max-w-35 truncate text-xs" style={{ color: 'var(--ace-text-muted)' }}>{track.artist}</td>
      <td className="px-3 py-1.5 max-w-35 truncate text-xs" style={{ color: 'var(--ace-text-muted)' }}>{track.album}</td>
      <td className="px-3 py-1.5 text-xs tabular-nums" style={{ color: 'var(--ace-text-muted)', fontFamily: 'var(--ace-font-mono)' }}>
        {track.durationMs > 0 ? formatDuration(track.durationMs) : '—'}
      </td>
      <td className="px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-0.5">
          <button onClick={onPlay} className="p-1 rounded hover:bg-white/10" style={{ color: 'var(--ace-text-muted)' }}>
            <Play size={11} />
          </button>
          <button onClick={onRemove} className="p-1 rounded hover:bg-white/10" style={{ color: 'var(--ace-text-muted)' }}>
            <X size={11} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Main PlaylistsView ────────────────────────────────────────────────────────

export function PlaylistsView() {
  const plStore   = usePlaylistStore()
  const pbStore   = usePlaybackStore()

  const [renaming, setRenaming]       = useState<string | null>(null)
  const [showSmartRules, setShowSmartRules] = useState(false)
  const dragFrom = useRef<number>(-1)
  const hydrated = useRef(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const rows = await getAudioEngine().loadPlaylists()
        if (!mounted) return
        const entries = rows.map((row) => ({
          playlist: {
            id: row.id,
            name: row.name,
            description: row.description,
            createdAt: row.createdAt,
            modifiedAt: row.modifiedAt,
            trackCount: row.trackCount,
            isSmartPlaylist: row.isSmartPlaylist,
            rules: row.rulesJson ? (JSON.parse(row.rulesJson) as SmartPlaylistRule[]) : undefined,
          },
          trackIds: row.trackPaths,
        }))
        plStore.hydrate(entries, entries[0]?.playlist.id ?? null)
        hydrated.current = true
      } catch (e) {
        console.error('[PlaylistsView] Failed to load playlists from DB:', e)
      }
    })()
    return () => {
      mounted = false
    }
  }, [plStore])

  useEffect(() => {
    if (!hydrated.current) return
    const entries = plStore.entries.map((entry) => ({
      id: entry.playlist.id,
      name: entry.playlist.name,
      description: entry.playlist.description,
      createdAt: entry.playlist.createdAt,
      modifiedAt: entry.playlist.modifiedAt,
      trackCount: entry.trackIds.length,
      isSmartPlaylist: entry.playlist.isSmartPlaylist,
      rulesJson: entry.playlist.rules ? JSON.stringify(entry.playlist.rules) : null,
      trackPaths: entry.trackIds,
    }))

    getAudioEngine().savePlaylists(entries).catch((e) => {
      console.error('[PlaylistsView] Failed to save playlists to DB:', e)
    })
  }, [plStore.entries])

  // ── Track resolution (Phase 1: reconstruct from queue) ──────────────────
  const queueTrackMap = new Map<string, AudioTrack>()
  pbStore.queue.forEach((qi, i) => {
    const t = pbStore.currentTrack?.id === qi.trackId ? pbStore.currentTrack : makeTrackFromPath(qi.trackId, i)
    queueTrackMap.set(qi.trackId, t)
  })

  const activeEntry = plStore.activeId ? plStore.getEntry(plStore.activeId) : null
  const activeTracks: AudioTrack[] = activeEntry
    ? activeEntry.trackIds.map((id, i) => queueTrackMap.get(id) ?? makeTrackFromPath(id, i))
    : []

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleCreate = useCallback((smart = false) => {
    plStore.createPlaylist(smart ? 'Smart Playlist' : 'New Playlist', smart)
  }, [plStore])

  const handleAddFiles = useCallback(async () => {
    if (!plStore.activeId) return
    const paths = await openAudioFiles()
    if (!paths.length) return
    const newTracks = paths.map(makeTrackFromPath)
    // Also add to queue so we can play them
    pbStore.addToQueue(newTracks)
    await getAudioEngine().indexFilePaths(paths).catch(() => {})
    plStore.addTracks(plStore.activeId, newTracks.map((t) => t.filePath))
  }, [plStore, pbStore])

  const handlePlayTrack = useCallback(async (track: AudioTrack) => {
    try {
      const { getAudioEngine } = await import('@/lib/audioEngine')
      await getAudioEngine().openFile(track.filePath)
      pbStore._onTrackChange(track)
    } catch {}
    await pbStore.play(track.id)
  }, [pbStore])

  const handleExport = useCallback(() => {
    if (!activeEntry) return
    exportM3U(activeEntry.playlist.name, activeTracks)
  }, [activeEntry, activeTracks])

  const handleImport = useCallback(async () => {
    if (!plStore.activeId) return
    const paths = await importM3U()
    if (!paths.length) return
    const newTracks = paths.map(makeTrackFromPath)
    pbStore.addToQueue(newTracks)
    await getAudioEngine().indexFilePaths(paths).catch(() => {})
    plStore.addTracks(plStore.activeId, newTracks.map((t) => t.filePath))
  }, [plStore, pbStore])

  const totalDuration = activeTracks.reduce((sum, t) => sum + t.durationMs, 0)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--ace-bg)' }}>

      {/* ══ Left: playlist list ══════════════════════════════ */}
      <aside
        className="w-56 shrink-0 flex flex-col border-r overflow-hidden"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b flex items-center gap-2"
          style={{ borderColor: 'var(--ace-border)' }}>
          <ListMusic size={13} style={{ color: 'var(--ace-accent)' }} />
          <span className="text-xs uppercase tracking-widest font-semibold flex-1"
            style={{ color: 'var(--ace-text-muted)' }}>Playlists</span>
          <button
            title="New Playlist"
            onClick={() => handleCreate(false)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: 'var(--ace-text-muted)' }}>
            <Plus size={13} />
          </button>
          <button
            title="New Smart Playlist"
            onClick={() => handleCreate(true)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: 'var(--ace-text-muted)' }}>
            <Zap size={13} />
          </button>
        </div>

        {/* Playlist list */}
        <div className="flex-1 overflow-y-auto">
          {plStore.entries.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
              <ListMusic size={28} style={{ color: 'var(--ace-text-muted)', opacity: 0.4 }} />
              <p className="text-xs text-center" style={{ color: 'var(--ace-text-muted)' }}>
                No playlists yet.<br />Click + to create one.
              </p>
            </div>
          )}
          {plStore.entries.map(({ playlist }) => {
            const isActive = playlist.id === plStore.activeId
            return (
              <div
                key={playlist.id}
                onClick={() => plStore.setActive(playlist.id)}
                className="flex items-center gap-2 px-3 py-2 border-b cursor-pointer group transition-colors hover:bg-white/4"
                style={{
                  borderColor: 'var(--ace-border)',
                  background: isActive ? 'rgba(124,106,255,0.08)' : 'transparent',
                }}
              >
                <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center"
                  style={{ background: isActive ? 'var(--ace-accent)' : 'var(--ace-surface)' }}>
                  {playlist.isSmartPlaylist
                    ? <Zap size={12} style={{ color: isActive ? '#fff' : 'var(--ace-accent)' }} />
                    : <Music2 size={12} style={{ color: isActive ? '#fff' : 'var(--ace-text-muted)' }} />}
                </div>
                <div className="flex-1 min-w-0">
                  {renaming === playlist.id
                    ? <InlineRename
                        initial={playlist.name}
                        onSave={(v) => { plStore.renamePlaylist(playlist.id, v); setRenaming(null) }}
                        onCancel={() => setRenaming(null)}
                      />
                    : <>
                        <p className="text-xs truncate" style={{ color: isActive ? 'var(--ace-accent)' : 'var(--ace-text-primary)' }}>
                          {playlist.name}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>
                          {playlist.trackCount} track{playlist.trackCount !== 1 ? 's' : ''}
                          {playlist.isSmartPlaylist && <span className="ml-1 opacity-60">· smart</span>}
                        </p>
                      </>
                  }
                </div>
                {renaming !== playlist.id && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenaming(playlist.id) }}
                      className="p-1 rounded hover:bg-white/10"
                      style={{ color: 'var(--ace-text-muted)' }}>
                      <Edit2 size={11} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Delete "${playlist.name}"?`)) plStore.deletePlaylist(playlist.id)
                      }}
                      className="p-1 rounded hover:bg-white/10"
                      style={{ color: 'var(--ace-text-muted)' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>

      {/* ══ Right: playlist content ══════════════════════════ */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* No playlist selected */}
        {!activeEntry && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <ListMusic size={40} style={{ color: 'var(--ace-text-muted)', opacity: 0.3 }} />
            <p className="text-sm" style={{ color: 'var(--ace-text-muted)' }}>Select or create a playlist</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleCreate(false)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all hover:scale-105"
                style={{ background: 'var(--ace-accent)', color: '#fff' }}>
                <Plus size={14} /> New Playlist
              </button>
              <button
                onClick={() => handleCreate(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all hover:bg-white/5"
                style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}>
                <Zap size={14} /> Smart Playlist
              </button>
            </div>
          </div>
        )}

        {/* Playlist content */}
        {activeEntry && (
          <>
            {/* Toolbar */}
            <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b"
              style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--ace-text-primary)' }}>
                  {activeEntry.playlist.isSmartPlaylist && <Zap size={13} className="inline mr-1" style={{ color: 'var(--ace-accent)' }} />}
                  {activeEntry.playlist.name}
                </p>
                <p className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
                  {activeTracks.length} track{activeTracks.length !== 1 ? 's' : ''}
                  {totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
                </p>
              </div>

              {activeEntry.playlist.isSmartPlaylist && (
                <button
                  onClick={() => setShowSmartRules((v) => !v)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors',
                    showSmartRules ? 'bg-white/10' : 'hover:bg-white/5',
                  )}
                  style={{ color: 'var(--ace-accent)' }}>
                  <Zap size={12} /> Rules
                </button>
              )}

              <button
                onClick={handleAddFiles}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/5"
                style={{ color: 'var(--ace-text-secondary)' }}>
                <Plus size={12} /> Add Files
              </button>
              <button
                onClick={handleImport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/5"
                style={{ color: 'var(--ace-text-secondary)' }}>
                <Upload size={12} /> Import M3U
              </button>
              <button
                onClick={handleExport}
                disabled={activeTracks.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/5 disabled:opacity-40"
                style={{ color: 'var(--ace-text-secondary)' }}>
                <Download size={12} /> Export M3U
              </button>
              <button
                onClick={() => activeTracks.length > 0 && handlePlayTrack(activeTracks[0])}
                disabled={activeTracks.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--ace-accent)', color: '#fff' }}>
                <Play size={12} /> Play All
              </button>
            </div>

            {/* Smart rules editor */}
            {showSmartRules && activeEntry.playlist.isSmartPlaylist && (
              <div className="shrink-0 px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
                <SmartRulesEditor
                  rules={activeEntry.playlist.rules ?? []}
                  onChange={(rules) => {
                    plStore.updateRules(activeEntry.playlist.id, rules)
                  }}
                />
              </div>
            )}

            {/* Empty playlist */}
            {activeTracks.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Music2 size={36} style={{ color: 'var(--ace-text-muted)', opacity: 0.3 }} />
                <p className="text-sm" style={{ color: 'var(--ace-text-muted)' }}>This playlist is empty</p>
                <button
                  onClick={handleAddFiles}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all hover:scale-105"
                  style={{ background: 'var(--ace-accent)', color: '#fff' }}>
                  <Plus size={14} /> Add Audio Files
                </button>
              </div>
            )}

            {/* Track table with drag-reorder */}
            {activeTracks.length > 0 && (
              <div className="flex-1 overflow-auto">
                <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--ace-bg-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
                      <th className="w-8 border-b" style={{ borderColor: 'var(--ace-border)' }} />
                      <th className="px-2 py-2 w-8 text-xs text-left border-b" style={{ color: 'var(--ace-text-muted)', borderColor: 'var(--ace-border)' }}>#</th>
                      <th className="px-3 py-2 text-xs text-left border-b" style={{ color: 'var(--ace-text-muted)', borderColor: 'var(--ace-border)' }}>Title</th>
                      <th className="px-3 py-2 text-xs text-left border-b" style={{ color: 'var(--ace-text-muted)', borderColor: 'var(--ace-border)' }}>Artist</th>
                      <th className="px-3 py-2 text-xs text-left border-b" style={{ color: 'var(--ace-text-muted)', borderColor: 'var(--ace-border)' }}>Album</th>
                      <th className="px-3 py-2 text-xs text-left border-b" style={{ color: 'var(--ace-text-muted)', borderColor: 'var(--ace-border)' }}>Time</th>
                      <th className="w-20 border-b" style={{ borderColor: 'var(--ace-border)' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {activeTracks.map((track, idx) => (
                      <DraggableTrackRow
                        key={track.id}
                        track={track}
                        index={idx}
                        isPlaying={track.id === pbStore.currentTrack?.id}
                        onPlay={() => handlePlayTrack(track)}
                        onRemove={() => plStore.removeTrack(activeEntry.playlist.id, track.id)}
                        onDragStart={(i) => { dragFrom.current = i }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(toIdx) => {
                          if (dragFrom.current >= 0 && dragFrom.current !== toIdx) {
                            plStore.reorderTrack(activeEntry.playlist.id, dragFrom.current, toIdx)
                          }
                          dragFrom.current = -1
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

