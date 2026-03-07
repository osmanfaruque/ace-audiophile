'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import {
  FolderOpen, Save, Undo2, Search, Fingerprint, Image, Trash2,
  ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Loader2,
  Music2, X, Download, Upload, Plus, Copy, RotateCcw, FileAudio,
} from 'lucide-react'
import { cn, formatDuration, formatSampleRate, formatBytes } from '@/lib/utils'
import type { AudioTrack, AudioCodec } from '@ace/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TagFile {
  track: AudioTrack
  original: TagFields
  edited: TagFields
  artworkUrl: string | null
  dirty: boolean
}

interface TagFields {
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  year: string
  trackNumber: string
  totalTracks: string
  discNumber: string
  totalDiscs: string
  comment: string
}

interface MbResult {
  id: string
  title: string
  artist: string
  album: string
  year: string
  score: number
}

type LookupStatus = 'idle' | 'loading' | 'done' | 'error'
type ActivePanel = 'tags' | 'artwork' | 'technical' | 'musicbrainz'

// ── Helpers ───────────────────────────────────────────────────────────────────

function trackToFields(t: AudioTrack): TagFields {
  return {
    title: t.title,
    artist: t.artist,
    albumArtist: t.albumArtist,
    album: t.album,
    genre: t.genre,
    year: t.year != null ? String(t.year) : '',
    trackNumber: t.trackNumber != null ? String(t.trackNumber) : '',
    totalTracks: t.totalTracks != null ? String(t.totalTracks) : '',
    discNumber: t.discNumber != null ? String(t.discNumber) : '',
    totalDiscs: t.totalDiscs != null ? String(t.totalDiscs) : '',
    comment: t.comment,
  }
}

function fieldsEqual(a: TagFields, b: TagFields): boolean {
  return (Object.keys(a) as (keyof TagFields)[]).every(k => a[k] === b[k])
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

function makeTrack(filePath: string, index: number): AudioTrack {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const title = fileName.replace(/\.[^.]+$/, '')
  const ext = (fileName.split('.').pop() ?? 'unknown').toLowerCase() as AudioCodec
  const valid: AudioCodec[] = ['flac','wav','aiff','alac','aac','mp3','ogg','opus','dsf','dff','wma','ape','wavpack','tta','mp4']
  const codec: AudioCodec = valid.includes(ext) ? ext : 'unknown'
  const now = Date.now()
  return {
    id: `tag-${now}-${index}`, filePath, title,
    artist: 'Unknown Artist', albumArtist: 'Unknown Artist',
    album: 'Unknown Album', genre: '', year: null,
    trackNumber: null, totalTracks: null, discNumber: null, totalDiscs: null, comment: '',
    durationMs: 0, sampleRate: 44100, bitDepth: 16, channels: 2, codec,
    bitrateKbps: 0, fileSizeBytes: 0,
    effectiveBitDepth: null, dynamicRange: null, lufs: null,
    truePeak: null, isLossyTranscode: null, lossyConfidence: null,
    replayGainTrack: null, replayGainAlbum: null,
    musicBrainzId: null, acoustId: null,
    albumId: `alb-${now}-${index}`,
    dateAdded: now, dateModified: now, lastPlayed: null, playCount: 0,
  }
}

/** Simulated MusicBrainz search (real implementation: invoke('mb_search', ...)) */
function simulateMbSearch(query: string): MbResult[] {
  if (!query.trim()) return []
  return [
    { id: 'mb-001', title: query, artist: 'Possible Artist', album: 'Possible Album', year: '2024', score: 95 },
    { id: 'mb-002', title: `${query} (Remaster)`, artist: 'Possible Artist', album: 'Deluxe Edition', year: '2025', score: 82 },
    { id: 'mb-003', title: `${query} (Live)`, artist: 'Another Artist', album: 'Live Sessions', year: '2023', score: 68 },
  ]
}

// ── Tag Field Row ─────────────────────────────────────────────────────────────

function TagFieldRow({ label, value, onChange, placeholder, multiline, readonly }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
  readonly?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <label
        className="w-28 shrink-0 text-right text-xs pt-1.5 font-medium"
        style={{ color: 'var(--ace-text-muted)' }}
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readonly}
          rows={3}
          className="flex-1 bg-transparent border rounded px-2 py-1 text-xs resize-y outline-none focus:border-[var(--ace-accent)] transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-primary)' }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readonly}
          className="flex-1 bg-transparent border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--ace-accent)] transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-primary)' }}
        />
      )}
    </div>
  )
}

// ── File List Item ────────────────────────────────────────────────────────────

function FileListItem({ file, selected, onClick }: {
  file: TagFile
  selected: boolean
  onClick: () => void
}) {
  const fileName = file.track.filePath.split(/[\\/]/).pop() ?? file.track.filePath
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-l-2',
        selected
          ? 'border-l-[var(--ace-accent)] bg-[var(--ace-accent)]/8'
          : 'border-l-transparent hover:bg-white/5',
      )}
    >
      <FileAudio size={13} style={{ color: file.dirty ? 'var(--ace-warning)' : 'var(--ace-text-muted)' }} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: 'var(--ace-text-primary)' }}>
          {file.edited.title || fileName}
        </div>
        <div className="text-[10px] truncate" style={{ color: 'var(--ace-text-muted)' }}>
          {file.edited.artist} — {file.edited.album}
        </div>
      </div>
      {file.dirty && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--ace-warning)] shrink-0" />
      )}
    </button>
  )
}

// ── Artwork Panel ─────────────────────────────────────────────────────────────

function ArtworkPanel({ artworkUrl, onReplace, onRemove }: {
  artworkUrl: string | null
  onReplace: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="w-full aspect-square rounded border flex items-center justify-center overflow-hidden"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-overlay)' }}
      >
        {artworkUrl ? (
          <img src={artworkUrl} alt="Album Art" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-4">
            <Image size={40} style={{ color: 'var(--ace-text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>No artwork embedded</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onReplace}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
        >
          <Upload size={12} /> Replace
        </button>
        <button
          onClick={onRemove}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-danger)' }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="text-[10px] space-y-0.5" style={{ color: 'var(--ace-text-muted)' }}>
        <p>Supported: JPEG, PNG (max 1500×1500 recommended)</p>
        <p>Drag & drop an image, or click Replace.</p>
      </div>
    </div>
  )
}

// ── Technical Info Panel ──────────────────────────────────────────────────────

function TechnicalPanel({ track }: { track: AudioTrack }) {
  const rows = [
    { label: 'File Path', value: track.filePath },
    { label: 'Codec', value: track.codec.toUpperCase() },
    { label: 'Sample Rate', value: formatSampleRate(track.sampleRate) },
    { label: 'Bit Depth', value: track.bitDepth ? `${track.bitDepth}-bit` : '—' },
    { label: 'Channels', value: track.channels === 1 ? 'Mono' : track.channels === 2 ? 'Stereo' : `${track.channels}ch` },
    { label: 'Bitrate', value: track.bitrateKbps ? `${track.bitrateKbps} kbps` : '—' },
    { label: 'Duration', value: formatDuration(track.durationMs) },
    { label: 'File Size', value: formatBytes(track.fileSizeBytes) },
    { label: 'MusicBrainz ID', value: track.musicBrainzId || '—' },
    { label: 'AcoustID', value: track.acoustId || '—' },
    { label: 'ReplayGain (Track)', value: track.replayGainTrack != null ? `${track.replayGainTrack.toFixed(2)} dB` : '—' },
    { label: 'ReplayGain (Album)', value: track.replayGainAlbum != null ? `${track.replayGainAlbum.toFixed(2)} dB` : '—' },
  ]
  return (
    <div className="flex flex-col gap-1">
      {rows.map(r => (
        <div key={r.label} className="flex items-start gap-2 text-xs">
          <span className="w-32 shrink-0 text-right font-medium" style={{ color: 'var(--ace-text-muted)' }}>
            {r.label}
          </span>
          <span className="flex-1 font-mono break-all" style={{ color: 'var(--ace-text-secondary)' }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── MusicBrainz Panel ─────────────────────────────────────────────────────────

function MusicBrainzPanel({ fields, onApply }: {
  fields: TagFields
  onApply: (result: MbResult) => void
}) {
  const [query, setQuery] = useState(fields.title || '')
  const [status, setStatus] = useState<LookupStatus>('idle')
  const [results, setResults] = useState<MbResult[]>([])
  const [fingerprintStatus, setFingerprintStatus] = useState<LookupStatus>('idle')

  const handleSearch = useCallback(async () => {
    setStatus('loading')
    await new Promise(r => setTimeout(r, 800))
    setResults(simulateMbSearch(query))
    setStatus('done')
  }, [query])

  const handleFingerprint = useCallback(async () => {
    setFingerprintStatus('loading')
    await new Promise(r => setTimeout(r, 1200))
    setResults(simulateMbSearch(fields.title || 'Fingerprint Match'))
    setFingerprintStatus('done')
    setStatus('done')
  }, [fields.title])

  return (
    <div className="flex flex-col gap-3">
      {/* Fingerprint button */}
      <button
        onClick={handleFingerprint}
        disabled={fingerprintStatus === 'loading'}
        className={cn(
          'flex items-center justify-center gap-2 px-3 py-2.5 rounded text-xs font-semibold border transition-all',
          fingerprintStatus === 'loading' ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90 active:scale-[0.98]',
        )}
        style={{ background: 'var(--ace-accent)', borderColor: 'var(--ace-accent)', color: '#fff' }}
      >
        {fingerprintStatus === 'loading' ? (
          <><Loader2 size={13} className="animate-spin" /> Computing AcoustID…</>
        ) : (
          <><Fingerprint size={14} /> Identify via AcoustID Fingerprint</>
        )}
      </button>

      <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>
        <span className="flex-1 h-px" style={{ background: 'var(--ace-border)' }} />
        or search manually
        <span className="flex-1 h-px" style={{ background: 'var(--ace-border)' }} />
      </div>

      {/* Manual search */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search by title, artist, or album..."
          className="flex-1 bg-transparent border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--ace-accent)] transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-primary)' }}
        />
        <button
          onClick={handleSearch}
          disabled={status === 'loading'}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
        >
          {status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Search
        </button>
      </div>

      {/* Results */}
      {status === 'done' && (
        <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
          {results.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: 'var(--ace-text-muted)' }}>
              No results found.
            </div>
          ) : (
            results.map(r => (
              <div
                key={r.id}
                className="flex items-center gap-2 px-3 py-2 rounded border hover:bg-white/5 transition-colors group cursor-pointer"
                style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
                onClick={() => onApply(r)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: 'var(--ace-text-primary)' }}>
                    {r.title}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--ace-text-muted)' }}>
                    {r.artist} — {r.album} ({r.year})
                  </div>
                </div>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{
                    color: r.score >= 90 ? 'var(--ace-success)' : r.score >= 70 ? 'var(--ace-warning)' : 'var(--ace-text-muted)',
                    background: r.score >= 90 ? 'rgba(76,175,130,0.12)' : 'transparent',
                  }}
                >
                  {r.score}%
                </span>
                <button
                  className="text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'var(--ace-accent)', color: '#fff' }}
                  onClick={e => { e.stopPropagation(); onApply(r) }}
                >
                  Apply
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Main TaggerView ───────────────────────────────────────────────────────────

export function TaggerView() {
  const [files, setFiles] = useState<TagFile[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [activePanel, setActivePanel] = useState<ActivePanel>('tags')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const selected = files[selectedIdx] ?? null
  const dirtyCount = files.filter(f => f.dirty).length

  // ── Load files ──
  const handleAddFiles = useCallback(async () => {
    const paths = await openAudioFiles()
    if (!paths.length) return
    const newFiles: TagFile[] = paths.map((p, i) => {
      const track = makeTrack(p, i)
      const fields = trackToFields(track)
      return { track, original: fields, edited: { ...fields }, artworkUrl: null, dirty: false }
    })
    setFiles(prev => [...prev, ...newFiles])
    if (files.length === 0) setSelectedIdx(0)
  }, [files.length])

  // ── Update a field ──
  const updateField = useCallback((key: keyof TagFields, value: string) => {
    setFiles(prev => prev.map((f, i) => {
      if (i !== selectedIdx) return f
      const edited = { ...f.edited, [key]: value }
      return { ...f, edited, dirty: !fieldsEqual(f.original, edited) }
    }))
  }, [selectedIdx])

  // ── Revert current file ──
  const revertCurrent = useCallback(() => {
    setFiles(prev => prev.map((f, i) => {
      if (i !== selectedIdx) return f
      return { ...f, edited: { ...f.original }, dirty: false }
    }))
  }, [selectedIdx])

  // ── Remove current file ──
  const removeCurrent = useCallback(() => {
    setFiles(prev => prev.filter((_, i) => i !== selectedIdx))
    setSelectedIdx(i => Math.max(0, Math.min(i, files.length - 2)))
  }, [selectedIdx, files.length])

  // ── Save all ──
  const handleSave = useCallback(async () => {
    setSaveStatus('saving')
    // Replace with invoke('write_tags', { files: ... })
    await new Promise(r => setTimeout(r, 800))
    setFiles(prev => prev.map(f => ({ ...f, original: { ...f.edited }, dirty: false })))
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }, [])

  // ── Apply MusicBrainz result ──
  const applyMbResult = useCallback((result: MbResult) => {
    setFiles(prev => prev.map((f, i) => {
      if (i !== selectedIdx) return f
      const edited: TagFields = {
        ...f.edited,
        title: result.title,
        artist: result.artist,
        album: result.album,
        year: result.year,
      }
      return { ...f, edited, dirty: !fieldsEqual(f.original, edited) }
    }))
    setActivePanel('tags')
  }, [selectedIdx])

  // ── Batch update (apply field to all files) ──
  const applyToAll = useCallback((key: keyof TagFields) => {
    if (!selected) return
    const val = selected.edited[key]
    setFiles(prev => prev.map(f => {
      const edited = { ...f.edited, [key]: val }
      return { ...f, edited, dirty: !fieldsEqual(f.original, edited) }
    }))
  }, [selected, selectedIdx])

  const PANELS: { id: ActivePanel; label: string }[] = [
    { id: 'tags', label: 'Tags' },
    { id: 'artwork', label: 'Artwork' },
    { id: 'technical', label: 'Technical' },
    { id: 'musicbrainz', label: 'MusicBrainz' },
  ]

  // ── Empty state ──
  if (files.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-5" style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-muted)' }}>
        <FileAudio size={48} />
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: 'var(--ace-text-secondary)' }}>
            No files loaded
          </p>
          <p className="text-xs mt-1">
            Add audio files to edit their metadata tags.
          </p>
        </div>
        <button
          onClick={handleAddFiles}
          className="flex items-center gap-2 px-5 py-2.5 rounded text-xs font-semibold transition-all hover:opacity-90 active:scale-95"
          style={{ background: 'var(--ace-accent)', color: '#fff' }}
        >
          <FolderOpen size={14} />
          Add Files
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)' }}>

      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
        style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}
      >
        <button
          onClick={handleAddFiles}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
        >
          <Plus size={13} /> Add Files
        </button>

        <div className="w-px h-5" style={{ background: 'var(--ace-border)' }} />

        <button
          onClick={revertCurrent}
          disabled={!selected?.dirty}
          className={cn('flex items-center gap-1 px-2 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors', !selected?.dirty && 'opacity-40')}
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
        >
          <Undo2 size={12} /> Revert
        </button>

        <button
          onClick={removeCurrent}
          disabled={!selected}
          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-danger)' }}
        >
          <X size={12} /> Remove
        </button>

        <span className="flex-1" />

        {dirtyCount > 0 && (
          <span className="text-[10px] font-mono" style={{ color: 'var(--ace-warning)' }}>
            {dirtyCount} unsaved
          </span>
        )}

        <button
          onClick={handleSave}
          disabled={dirtyCount === 0 || saveStatus === 'saving'}
          className={cn(
            'flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold border transition-all',
            dirtyCount === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90 active:scale-95',
          )}
          style={{
            background: saveStatus === 'saved' ? 'var(--ace-success)' : 'var(--ace-accent)',
            borderColor: saveStatus === 'saved' ? 'var(--ace-success)' : 'var(--ace-accent)',
            color: '#fff',
          }}
        >
          {saveStatus === 'saving' ? (
            <><Loader2 size={12} className="animate-spin" /> Saving…</>
          ) : saveStatus === 'saved' ? (
            <><CheckCircle2 size={12} /> Saved!</>
          ) : (
            <><Save size={12} /> Save All</>
          )}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: File list ── */}
        <div
          className="w-56 shrink-0 flex flex-col border-r overflow-hidden"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg)' }}
        >
          <div
            className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest border-b"
            style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-muted)' }}
          >
            Files ({files.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            {files.map((f, i) => (
              <FileListItem
                key={f.track.id}
                file={f}
                selected={i === selectedIdx}
                onClick={() => setSelectedIdx(i)}
              />
            ))}
          </div>
        </div>

        {/* ── Right: Editor ── */}
        {selected && (
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Panel tabs */}
            <div
              className="flex items-center border-b shrink-0"
              style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
            >
              {PANELS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActivePanel(p.id)}
                  className={cn(
                    'px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
                    activePanel === p.id
                      ? 'border-[var(--ace-accent)]'
                      : 'border-transparent hover:border-[var(--ace-border-strong)]',
                  )}
                  style={{
                    color: activePanel === p.id ? 'var(--ace-text-primary)' : 'var(--ace-text-muted)',
                  }}
                >
                  {p.label}
                  {p.id === 'tags' && selected.dirty && (
                    <span className="ml-1.5 w-1.5 h-1.5 inline-block rounded-full bg-[var(--ace-warning)]" />
                  )}
                </button>
              ))}
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-y-auto p-4">

              {activePanel === 'tags' && (
                <div className="max-w-xl flex flex-col gap-2.5">
                  <TagFieldRow label="Title" value={selected.edited.title} onChange={v => updateField('title', v)} placeholder="Track title" />
                  <TagFieldRow label="Artist" value={selected.edited.artist} onChange={v => updateField('artist', v)} placeholder="Artist name" />
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <TagFieldRow label="Album Artist" value={selected.edited.albumArtist} onChange={v => updateField('albumArtist', v)} placeholder="Album artist" />
                    </div>
                    <button
                      title="Apply to all files"
                      onClick={() => applyToAll('albumArtist')}
                      className="p-1 rounded hover:bg-white/10 transition-colors mt-0.5"
                      style={{ color: 'var(--ace-text-muted)' }}
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <TagFieldRow label="Album" value={selected.edited.album} onChange={v => updateField('album', v)} placeholder="Album name" />
                    </div>
                    <button
                      title="Apply to all files"
                      onClick={() => applyToAll('album')}
                      className="p-1 rounded hover:bg-white/10 transition-colors mt-0.5"
                      style={{ color: 'var(--ace-text-muted)' }}
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <TagFieldRow label="Genre" value={selected.edited.genre} onChange={v => updateField('genre', v)} placeholder="Genre" />
                    </div>
                    <button
                      title="Apply to all files"
                      onClick={() => applyToAll('genre')}
                      className="p-1 rounded hover:bg-white/10 transition-colors mt-0.5"
                      style={{ color: 'var(--ace-text-muted)' }}
                    >
                      <Copy size={11} />
                    </button>
                  </div>

                  {/* Number fields row */}
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <TagFieldRow label="Year" value={selected.edited.year} onChange={v => updateField('year', v)} placeholder="2024" />
                    </div>
                  </div>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <TagFieldRow label="Track #" value={selected.edited.trackNumber} onChange={v => updateField('trackNumber', v)} placeholder="1" />
                    </div>
                    <div className="w-20">
                      <input
                        type="text"
                        value={selected.edited.totalTracks}
                        onChange={e => updateField('totalTracks', e.target.value)}
                        placeholder="of"
                        className="w-full bg-transparent border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--ace-accent)] transition-colors"
                        style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-primary)' }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <TagFieldRow label="Disc #" value={selected.edited.discNumber} onChange={v => updateField('discNumber', v)} placeholder="1" />
                    </div>
                    <div className="w-20">
                      <input
                        type="text"
                        value={selected.edited.totalDiscs}
                        onChange={e => updateField('totalDiscs', e.target.value)}
                        placeholder="of"
                        className="w-full bg-transparent border rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--ace-accent)] transition-colors"
                        style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-primary)' }}
                      />
                    </div>
                  </div>

                  <TagFieldRow label="Comment" value={selected.edited.comment} onChange={v => updateField('comment', v)} placeholder="Comment..." multiline />
                </div>
              )}

              {activePanel === 'artwork' && (
                <div className="max-w-xs">
                  <ArtworkPanel
                    artworkUrl={selected.artworkUrl}
                    onReplace={() => {
                      // Replace with Tauri file dialog for images
                    }}
                    onRemove={() => {
                      setFiles(prev => prev.map((f, i) =>
                        i === selectedIdx ? { ...f, artworkUrl: null, dirty: true } : f
                      ))
                    }}
                  />
                </div>
              )}

              {activePanel === 'technical' && (
                <TechnicalPanel track={selected.track} />
              )}

              {activePanel === 'musicbrainz' && (
                <div className="max-w-lg">
                  <MusicBrainzPanel
                    fields={selected.edited}
                    onApply={applyMbResult}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
