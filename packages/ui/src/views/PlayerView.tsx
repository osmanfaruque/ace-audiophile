'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  SkipBack, Play, Pause, SkipForward, Square,
  Repeat, Repeat1, Shuffle, FolderOpen, ListMusic,
  Star, AlignLeft, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePlaybackStore } from '@/store/playbackStore'
import { useAppStore } from '@/store/appStore'
import { getAudioEngine } from '@/lib/audioEngine'
import { SeekBar } from '@/components/player/SeekBar'
import { VolumeSlider } from '@/components/player/VolumeSlider'
import { SpectrumBars } from '@/components/player/SpectrumBars'
import { LevelMeter } from '@/components/player/LevelMeter'
import { formatDuration, formatSampleRate } from '@/lib/utils'
import type { AudioTrack, AudioCodec } from '@ace/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function formatBadge(track: AudioTrack | null): string {
  if (!track) return ''
  const codec = track.codec.toUpperCase()
  const sr = track.sampleRate > 0 ? formatSampleRate(track.sampleRate) : ''
  const bd = track.bitDepth > 0 ? `${track.bitDepth}-bit` : ''
  return [codec, sr, bd].filter(Boolean).join(' · ')
}

function makeTrackFromPath(filePath: string, index: number): AudioTrack {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const title = fileName.replace(/\.[^.]+$/, '')
  const ext = (fileName.split('.').pop() ?? 'unknown').toLowerCase() as AudioCodec
  const validCodecs: AudioCodec[] = [
    'flac','wav','aiff','alac','aac','mp3','ogg','opus','dsf','dff','wma','ape','wavpack','tta','mp4',
  ]
  const codec: AudioCodec = validCodecs.includes(ext) ? ext : 'unknown'
  const now = Date.now()
  return {
    id: `local-${now}-${index}`,
    filePath, title,
    artist: 'Unknown Artist', albumArtist: 'Unknown Artist',
    album: 'Unknown Album', genre: '', year: null,
    trackNumber: null, totalTracks: null, discNumber: null,
    totalDiscs: null, comment: '',
    durationMs: 0, sampleRate: 0, bitDepth: 0, channels: 2,
    codec, bitrateKbps: 0, fileSizeBytes: 0,
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
  } catch {
    return []
  }
}

// ── Rating Stars ──────────────────────────────────────────────────────────────

function RatingStars({ value, onChange, size = 16 }: {
  value: number
  onChange: (v: number) => void
  size?: number
}) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          onMouseEnter={() => setHover(star)}
          onClick={() => onChange(value === star ? 0 : star)}
          className="transition-transform hover:scale-110"
        >
          <Star
            size={size}
            fill={(hover || value) >= star ? 'var(--ace-warning)' : 'none'}
            stroke={(hover || value) >= star ? 'var(--ace-warning)' : 'var(--ace-text-muted)'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  )
}

// ── Lyrics Panel ──────────────────────────────────────────────────────────────

interface LrcLine {
  timeMs: number
  text: string
}

/** Parse [mm:ss.xx] lines from LRC content */
function parseLrc(content: string): LrcLine[] {
  const lines: LrcLine[] = []
  for (const raw of content.split('\n')) {
    const match = raw.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/)
    if (match) {
      const min = parseInt(match[1], 10)
      const sec = parseInt(match[2], 10)
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
      lines.push({ timeMs: min * 60000 + sec * 1000 + ms, text: match[4] })
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}

const DEMO_LRC = `[00:00.00] 
[00:04.50] No lyrics loaded
[00:08.00] Play a track with an .lrc file
[00:12.00] or paste synced lyrics here
[00:16.00] Format: [mm:ss.xx] text
[00:20.00] 
[00:24.00] Lyrics will auto-scroll
[00:28.00] highlighting the current line
[00:32.00] as the track plays
[00:40.00] `

function LyricsPanel({ positionMs, compact }: { positionMs: number; compact?: boolean }) {
  const [lrcText, setLrcText] = useState(DEMO_LRC)
  const [editing, setEditing] = useState(false)
  const lines = useMemo(() => parseLrc(lrcText), [lrcText])

  // Find current line index
  const activeIdx = useMemo(() => {
    let idx = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeMs <= positionMs) idx = i
    }
    return idx
  }, [lines, positionMs])

  if (editing) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-1.5 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ace-text-muted)' }}>Edit Lyrics</span>
          <button onClick={() => setEditing(false)} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--ace-accent)', color: '#fff' }}>Done</button>
        </div>
        <textarea
          value={lrcText}
          onChange={e => setLrcText(e.target.value)}
          className="flex-1 bg-transparent px-3 py-2 text-xs outline-none resize-none font-mono"
          style={{ color: 'var(--ace-text-secondary)' }}
          placeholder="[00:00.00] First line...&#10;[00:04.00] Second line..."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b" style={{ borderColor: 'var(--ace-border)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ace-text-muted)' }}>Lyrics</span>
        <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: 'var(--ace-text-muted)' }}>
          <AlignLeft size={11} />
        </button>
      </div>
      <div className={`flex-1 overflow-y-auto ${compact ? 'px-3 py-2' : 'px-5 py-4'}`}>
        <div className="flex flex-col gap-1">
          {lines.map((line, i) => (
            <p
              key={i}
              className={`transition-all duration-300 ${compact ? 'text-xs' : 'text-sm'} ${i === activeIdx ? 'font-bold scale-[1.02] origin-left' : 'opacity-40'}`}
              style={{
                color: i === activeIdx ? 'var(--ace-accent)' : 'var(--ace-text-secondary)',
              }}
            >
              {line.text || '\u00A0'}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PlayerView() {
  const { uiMode } = useAppStore()
  return uiMode === 'technical' ? <TechnicalPlayer /> : <ElegantPlayer />
}

// ─────────────────────────────────────────────────────────────────────────────
//  ELEGANT PLAYER  (Oto / HiBy / UAPP-inspired — art-forward, minimal chrome)
// ─────────────────────────────────────────────────────────────────────────────

function ElegantPlayer() {
  const store = usePlaybackStore()
  const { status, currentTrack, positionMs, durationMs, volume, repeat, shuffle } = store

  // Event listeners are handled globally in AppProviders (A3.2)

  const handleOpenFiles = useCallback(async () => {
    const paths = await openAudioFiles()
    if (!paths.length) return
    const tracks = paths.map(makeTrackFromPath)
    store.addToQueue(tracks)
    try {
      await getAudioEngine().openFile(tracks[0].filePath)
      store._onTrackChange(tracks[0])
    } catch {}
    await store.play()
  }, [store])

  const handlePlayPause = useCallback(async () => {
    if (status === 'playing') store.pause()
    else await store.play()
  }, [status, store])

  const cycleRepeat = useCallback(() => {
    store.setRepeat(repeat === 'none' ? 'all' : repeat === 'all' ? 'one' : 'none')
  }, [repeat, store])

  const noTrack = !currentTrack
  const [rating, setRating] = useState(0)
  const [albumArtPath, setAlbumArtPath] = useState<string | null>(null)
  const [showLyrics, setShowLyrics] = useState(false)

  useEffect(() => {
    if (!currentTrack) {
      const timer = setTimeout(() => {
        setRating(0)
        setAlbumArtPath(null)
      }, 0)
      return () => clearTimeout(timer)
    }
    getAudioEngine()
      .getRatings()
      .then((rows) => {
        const hit = rows.find((r) => r.trackId === currentTrack.filePath || r.trackId === currentTrack.id)
        setRating(hit?.stars ?? 0)
      })
      .catch(() => setRating(0))
    getAudioEngine()
      .getAlbumArtPath(currentTrack.filePath)
      .then((p) => setAlbumArtPath(p ?? null))
      .catch(() => setAlbumArtPath(null))
  }, [currentTrack])

  const updateRating = useCallback(
    (v: number) => {
      setRating(v)
      if (!currentTrack) return
      getAudioEngine().setRating(currentTrack.filePath, v).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn('[PlayerView] Failed to persist rating:', msg)
      })
    },
    [currentTrack],
  )

  return (
    <div className="relative w-full h-full overflow-hidden select-none">

      {/* ── Background ─────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {noTrack ? (
          <motion.div key="empty-bg" className="absolute inset-0"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ background: 'linear-gradient(135deg, #0a0a1a 0%, #12082a 40%, #080d1a 70%, #0a0a1a 100%)' }}
          />
        ) : (
          <motion.div key={`bg-${currentTrack.id}`} className="absolute inset-0"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="absolute inset-0"
              style={{ background: 'linear-gradient(135deg, #1a0a2e 0%, #0a1628 50%, #0a0a1a 100%)' }}
            />
            {/* Bottom vignette */}
            <div className="absolute inset-0"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.65) 40%, rgba(0,0,0,0.2) 100%)' }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Empty state ─────────────────────────────────────── */}
      {noTrack && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
            className="w-36 h-36 rounded-full flex items-center justify-center"
            style={{
              background: 'radial-gradient(circle at 35% 35%, #1e1e2a 0%, #0a0a0f 70%)',
              boxShadow: '0 0 60px rgba(124,106,255,0.15)',
              border: '1px solid rgba(124,106,255,0.18)',
            }}
          >
            <div className="w-10 h-10 rounded-full" style={{ background: 'rgba(124,106,255,0.15)' }} />
          </motion.div>
          <p className="text-base font-medium" style={{ color: 'var(--ace-text-secondary)' }}>
            No track loaded
          </p>
          <button
            onClick={handleOpenFiles}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold transition-all hover:scale-105 active:scale-95"
            style={{ background: 'var(--ace-accent)', color: '#fff', boxShadow: '0 0 28px var(--ace-accent-glow)' }}
          >
            <FolderOpen size={16} />
            Open Audio Files
          </button>
        </div>
      )}

      {/* ── Format badge + lyrics toggle (top-right) ─────────── */}
      {currentTrack && (
        <div className="absolute top-8 right-4 flex items-center gap-2">
          <button
            onClick={() => setShowLyrics(!showLyrics)}
            className="px-2 py-1 rounded-md text-xs transition-all"
            style={{
              background: showLyrics ? 'rgba(124,106,255,0.25)' : 'rgba(0,0,0,0.55)',
              color: showLyrics ? 'var(--ace-accent)' : 'var(--ace-text-muted)',
              border: '1px solid rgba(124,106,255,0.25)', backdropFilter: 'blur(8px)',
            }}
            title="Toggle Lyrics"
          >
            <AlignLeft size={14} />
          </button>
          <div className="px-2.5 py-1 rounded-md text-xs tracking-wide"
            style={{
              background: 'rgba(0,0,0,0.55)', color: 'var(--ace-accent)',
              border: '1px solid rgba(124,106,255,0.25)', backdropFilter: 'blur(8px)',
              fontFamily: 'var(--ace-font-mono)',
            }}
          >
            {formatBadge(currentTrack)}
          </div>
        </div>
      )}

      {/* ── Lyrics overlay ─────────────────────────────────── */}
      {currentTrack && showLyrics && (
        <div
          className="absolute top-20 right-4 bottom-32 w-72 rounded-lg border overflow-hidden"
          style={{
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(20px)',
            borderColor: 'rgba(124,106,255,0.2)',
          }}
        >
          <LyricsPanel positionMs={positionMs} />
        </div>
      )}

      {/* ── Bottom player strip ─────────────────────────────── */}
      {currentTrack && (
        <div className="absolute bottom-0 left-0 right-0">
          {/* Full-width seek bar — at very bottom */}
          <div className="px-4 pb-1">
            <SeekBar positionMs={positionMs} durationMs={durationMs} onSeek={store.seek} />
          </div>

          {/* Control strip */}
          <div
            className="flex items-center gap-3 px-4 pt-2 pb-4"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(24px)' }}
          >
            {/* Album art */}
            <div
              className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, var(--ace-bg-elevated), var(--ace-surface))',
                border: '1px solid var(--ace-border)',
              }}
            >
              {albumArtPath ? (
                <img src={albumArtPath} alt="Album art" className="w-full h-full object-cover rounded-lg" />
              ) : (
                <span style={{ fontSize: 22, color: 'var(--ace-accent)' }}>♪</span>
              )}
            </div>

            {/* Track info + rating */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate" style={{ color: 'var(--ace-text-primary)' }}>
                {currentTrack.title}
              </p>
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--ace-text-secondary)' }}>
                {currentTrack.artist}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs truncate opacity-55" style={{ color: 'var(--ace-text-secondary)' }}>
                  {currentTrack.album}
                </p>
                <RatingStars value={rating} onChange={updateRating} size={12} />
              </div>
            </div>

            {/* Time */}
            <div className="shrink-0 text-right" style={{ fontFamily: 'var(--ace-font-mono)' }}>
              <p className="text-xs tabular-nums" style={{ color: 'var(--ace-text-primary)' }}>
                {formatDuration(positionMs)}
              </p>
              <p className="text-xs tabular-nums opacity-45" style={{ color: 'var(--ace-text-secondary)' }}>
                {formatDuration(durationMs)}
              </p>
            </div>

            {/* Transport */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={() => store.setShuffle(shuffle === 'off' ? 'on' : 'off')}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: shuffle === 'on' ? 'var(--ace-accent)' : 'var(--ace-text-muted)' }}>
                <Shuffle size={14} />
              </button>
              <button onClick={() => store.prev()}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: 'var(--ace-text-secondary)' }}>
                <SkipBack size={20} />
              </button>
              {/* Play/Pause */}
              <button onClick={handlePlayPause}
                className="w-10 h-10 rounded-full flex items-center justify-center mx-1 transition-all hover:scale-110 active:scale-95"
                style={{ background: 'var(--ace-accent)', boxShadow: '0 0 18px var(--ace-accent-glow)' }}>
                {status === 'playing'
                  ? <Pause size={18} fill="white" stroke="none" />
                  : <Play size={18} fill="white" stroke="none" className="ml-0.5" />}
              </button>
              <button onClick={() => store.next()}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: 'var(--ace-text-secondary)' }}>
                <SkipForward size={20} />
              </button>
              <button onClick={cycleRepeat}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: repeat !== 'none' ? 'var(--ace-accent)' : 'var(--ace-text-muted)' }}>
                {repeat === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
              </button>
            </div>

            <VolumeSlider volume={volume} onChange={store.setVolume} className="shrink-0" />

            {/* A3.3.7 — Level meter */}
            <LevelMeter height={36} compact className="shrink-0 w-20" />

            <button onClick={handleOpenFiles}
              className="p-2 rounded-lg hover:bg-white/10 shrink-0 transition-colors"
              style={{ color: 'var(--ace-text-muted)' }} title="Open files">
              <FolderOpen size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  TECHNICAL PLAYER  (Symfonium-inspired — info-dense, data-rich)
// ─────────────────────────────────────────────────────────────────────────────

function TechnicalPlayer() {
  const store = usePlaybackStore()
  const { status, currentTrack, positionMs, durationMs, volume, repeat, shuffle, queue } = store

  // Event listeners are handled globally in AppProviders (A3.2)

  const handleOpenFiles = useCallback(async () => {
    const paths = await openAudioFiles()
    if (!paths.length) return
    const tracks = paths.map(makeTrackFromPath)
    store.addToQueue(tracks)
    try {
      await getAudioEngine().openFile(tracks[0].filePath)
      store._onTrackChange(tracks[0])
    } catch {}
    await store.play()
  }, [store])

  const handlePlayPause = useCallback(async () => {
    if (status === 'playing') store.pause()
    else await store.play()
  }, [status, store])

  const cycleRepeat = useCallback(() => {
    store.setRepeat(repeat === 'none' ? 'all' : repeat === 'all' ? 'one' : 'none')
  }, [repeat, store])

  const [technicalRating, setTechnicalRating] = useState(0)
  const t = currentTrack

  useEffect(() => {
    if (!t) {
      const timer = setTimeout(() => {
        setTechnicalRating(0)
      }, 0)
      return () => clearTimeout(timer)
    }
    getAudioEngine()
      .getRatings()
      .then((rows) => {
        const hit = rows.find((r) => r.trackId === t.filePath || r.trackId === t.id)
        setTechnicalRating(hit?.stars ?? 0)
      })
      .catch(() => setTechnicalRating(0))
  }, [t])

  const updateTechnicalRating = useCallback(
    (v: number) => {
      setTechnicalRating(v)
      if (!t) return
      getAudioEngine().setRating(t.filePath, v).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn('[PlayerView] Failed to persist technical rating:', msg)
      })
    },
    [t],
  )
  const monoFont: React.CSSProperties = { fontFamily: 'var(--ace-font-mono)', fontSize: 12 }

  const metaRows: [string, string][] = t ? [
    ['Artist Name', t.artist],
    ['Track Title', t.title],
    ['Album Title', t.album],
    ['Album Artist', t.albumArtist],
    ['Genre',        t.genre || '—'],
    ['Date',         t.year?.toString() ?? '—'],
    ['Track #',      t.trackNumber != null ? `${t.trackNumber}${t.totalTracks ? ` / ${t.totalTracks}` : ''}` : '—'],
  ] : []

  const techRows: [string, string][] = t ? [
    ['Duration',     formatDuration(t.durationMs)],
    ['Sample Rate',  t.sampleRate > 0 ? formatSampleRate(t.sampleRate) : '—'],
    ['Bit Depth',    t.bitDepth > 0 ? `${t.bitDepth} bit` : '—'],
    ['Channels',     t.channels === 1 ? 'Mono' : t.channels === 2 ? 'Stereo' : `${t.channels} ch`],
    ['Codec',        t.codec.toUpperCase()],
    ['Bitrate',      t.bitrateKbps > 0 ? `${t.bitrateKbps} kbps` : 'Lossless'],
    ['DR Score',     t.dynamicRange != null ? `DR${t.dynamicRange}` : '—'],
    ['LUFS',         t.lufs != null ? `${t.lufs.toFixed(1)} LUFS` : '—'],
    ['True Peak',    t.truePeak != null ? `${t.truePeak.toFixed(2)} dBTP` : '—'],
  ] : []

  const fileRows: [string, string][] = t ? [
    ['File Name',    t.filePath.split(/[\\/]/).pop() ?? '—'],
    ['Folder',       t.filePath.split(/[\\/]/).slice(0, -1).join('/') || '—'],
    ['Full Path',    t.filePath],
  ] : []

  return (
    <div className="flex flex-col h-full" style={{ ...monoFont, color: 'var(--ace-text-primary)', background: 'var(--ace-bg)' }}>

      <div className="flex flex-1 min-h-0">
        {/* ── Left: Queue browser ─────────────────────────── */}
        <div className="w-52 shrink-0 flex flex-col border-r overflow-hidden"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
          <PanelHeader title={`Queue (${queue.length})`} />
          {queue.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
              <ListMusic size={28} style={{ color: 'var(--ace-text-muted)' }} />
              <button onClick={handleOpenFiles} className="text-xs underline" style={{ color: 'var(--ace-accent)' }}>
                Open files…
              </button>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              {queue.map((qi, idx) => (
                <button key={qi.queueId}
                  onClick={() => store.play(qi.trackId)}
                  className="w-full text-left px-3 py-1 text-xs truncate border-b transition-colors hover:bg-white/5"
                  style={{
                    borderColor: 'var(--ace-border)',
                    color: qi.trackId === store.currentTrackId ? 'var(--ace-accent)' : 'var(--ace-text-secondary)',
                    background: qi.trackId === store.currentTrackId ? 'rgba(124,106,255,0.08)' : 'transparent',
                  }}>
                  <span className="opacity-40 mr-1">{idx + 1}.</span>
                  {queue[idx] ? (t?.id === qi.trackId ? t.title : `Track ${idx + 1}`) : `Track ${idx + 1}`}
                </button>
              ))}
            </div>
          )}
          {queue.length > 0 && (
            <button onClick={handleOpenFiles}
              className="px-3 py-2 text-xs border-t text-left hover:bg-white/5 transition-colors"
              style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-accent)' }}>
              + Add More…
            </button>
          )}
        </div>

        {/* ── Right: metadata panels ──────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex flex-1 min-h-0">
            {/* Metadata + Rating */}
            <div className="flex-1 border-r overflow-auto" style={{ borderColor: 'var(--ace-border)' }}>
              <PanelHeader title="Metadata" />
              {metaRows.length > 0 ? (
                <>
                  <InfoTable rows={metaRows} />
                  {/* Rating row */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: 'var(--ace-border)' }}>
                    <span className="text-xs w-28" style={{ color: 'var(--ace-text-muted)', fontFamily: 'var(--ace-font-mono)' }}>Rating</span>
                    <RatingStars value={technicalRating} onChange={updateTechnicalRating} size={14} />
                  </div>
                </>
              ) : (
                <div className="p-3 text-xs" style={{ color: 'var(--ace-text-muted)' }}>No track loaded. Open a file to begin.</div>
              )}
            </div>

            {/* Lyrics */}
            <div className="w-52 shrink-0 border-r overflow-hidden" style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg)' }}>
              {t ? (
                <LyricsPanel positionMs={positionMs} compact />
              ) : (
                <>
                  <PanelHeader title="Lyrics" />
                  <div className="p-3 text-xs" style={{ color: 'var(--ace-text-muted)' }}>Lyrics appear here.</div>
                </>
              )}
            </div>

            {/* File info */}
            <div className="w-56 shrink-0 overflow-auto">
              {fileRows.length > 0 && (<><PanelHeader title="Location" /><InfoTable rows={fileRows} /></>)}
              {techRows.length > 0 && (<><PanelHeader title="General" /><InfoTable rows={techRows} /></>)}
              {!t && <div className="p-3 text-xs" style={{ color: 'var(--ace-text-muted)' }}>File details appear here.</div>}
            </div>
          </div>

          {/* Transport strip */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t"
            style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
            <button onClick={() => store.prev()} className="p-1 rounded hover:bg-white/10" style={{ color: 'var(--ace-text-secondary)' }}><SkipBack size={15} /></button>
            <button onClick={handlePlayPause} className="p-1 rounded hover:bg-white/10"
              style={{ color: status === 'playing' ? 'var(--ace-accent)' : 'var(--ace-text-primary)' }}>
              {status === 'playing' ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button onClick={() => store.stop()} className="p-1 rounded hover:bg-white/10" style={{ color: 'var(--ace-text-secondary)' }}><Square size={13} /></button>
            <button onClick={() => store.next()} className="p-1 rounded hover:bg-white/10" style={{ color: 'var(--ace-text-secondary)' }}><SkipForward size={15} /></button>
            <div className="flex-1 mx-2">
              <SeekBar positionMs={positionMs} durationMs={durationMs} onSeek={store.seek} thick />
            </div>
            <span className="text-xs tabular-nums shrink-0" style={{ color: 'var(--ace-text-secondary)' }}>
              {formatDuration(positionMs)} / {formatDuration(durationMs)}
            </span>
            <button onClick={cycleRepeat} className="p-1 rounded hover:bg-white/10"
              style={{ color: repeat !== 'none' ? 'var(--ace-accent)' : 'var(--ace-text-muted)' }}>
              {repeat === 'one' ? <Repeat1 size={13} /> : <Repeat size={13} />}
            </button>
            <button onClick={() => store.setShuffle(shuffle === 'off' ? 'on' : 'off')} className="p-1 rounded hover:bg-white/10"
              style={{ color: shuffle === 'on' ? 'var(--ace-accent)' : 'var(--ace-text-muted)' }}>
              <Shuffle size={13} />
            </button>
            <VolumeSlider volume={volume} onChange={store.setVolume} />
            <button onClick={handleOpenFiles} className="p-1 rounded hover:bg-white/10 ml-1" style={{ color: 'var(--ace-text-muted)' }}><FolderOpen size={14} /></button>
          </div>
        </div>
      </div>

      {/* ── Spectrum analyzer + Level meter (A3.3.7) ──── */}
      <div className="shrink-0 flex border-t" style={{ height: 68, borderColor: 'var(--ace-border)', background: '#050508' }}>
        <div className="flex-1">
          <SpectrumBars height={68} barCount={80} />
        </div>
        <div className="shrink-0 border-l" style={{ width: 140, borderColor: 'var(--ace-border)' }}>
          <LevelMeter height={68} />
        </div>
      </div>

      {/* ── Status bar ─────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-3 border-t"
        style={{ height: 20, borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-muted)', ...monoFont, fontSize: 11 }}>
        {t ? (
          <>
            <span>{t.codec.toUpperCase()}</span><span>|</span>
            <span>{t.bitrateKbps > 0 ? `${t.bitrateKbps} kbps` : 'Lossless'}</span><span>|</span>
            <span>{t.sampleRate > 0 ? formatSampleRate(t.sampleRate) : '—'}</span><span>|</span>
            <span>{t.channels === 2 ? 'stereo' : t.channels === 1 ? 'mono' : `${t.channels}ch`}</span><span>|</span>
            <span>{formatDuration(positionMs)} / {formatDuration(durationMs)}</span>
          </>
        ) : (
          <span>No track loaded</span>
        )}
        <span className="ml-auto">{queue.length} item{queue.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

// ── Shared micro-components ───────────────────────────────────────────────────

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="px-3 py-1 text-xs font-semibold uppercase tracking-widest border-b"
      style={{ color: 'var(--ace-accent)', borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)', fontFamily: 'var(--ace-font-mono)' }}>
      {title}
    </div>
  )
}

function InfoTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full" style={{ fontFamily: 'var(--ace-font-mono)', fontSize: 12, borderCollapse: 'collapse' }}>
      <tbody>
        {rows.map(([name, value]) => (
          <tr key={name} className="border-b" style={{ borderColor: 'var(--ace-border)' }}>
            <td className="px-3 py-1 whitespace-nowrap w-28" style={{ color: 'var(--ace-text-muted)' }}>{name}</td>
            <td className="px-3 py-1 truncate max-w-0" style={{ color: 'var(--ace-text-primary)' }} title={value}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
