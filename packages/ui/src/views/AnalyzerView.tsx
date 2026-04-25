'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FolderOpen, Activity, BarChart3, CheckCircle2, XCircle,
  AlertTriangle, Info, Loader2, RefreshCw, ChevronDown, ChevronRight,
  AudioWaveform,
} from 'lucide-react'
import { usePlaybackStore } from '@/store/playbackStore'
import { getAudioEngine } from '@/lib/audioEngine'
import { cn, formatDuration, formatSampleRate } from '@/lib/utils'
import type {
  AudioTrack,
  FileAnalysisResult as EngineAnalysisResult,
  MasteringComparisonResult,
} from '@ace/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'
type VerdictLevel = 'pass' | 'warn' | 'fail' | 'info'
type ActiveTab = 'spectrogram' | 'waveform' | 'spectrum'

interface VerdictCard {
  id: string
  label: string
  verdict: VerdictLevel
  value: string
  detail: string
  expanded?: boolean
}

interface AnalysisResult {
  hiRes: VerdictCard
  lossyTranscode: VerdictCard
  dynamicRange: VerdictCard
  loudness: VerdictCard
  bitDepth: VerdictCard
  clipping: VerdictCard
  dcOffset: VerdictCard
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openAudioFile(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({
      multiple: false,
      filters: [{ name: 'Audio Files', extensions: ['flac','wav','aiff','aif','mp3','aac','m4a','opus','ogg','dsf','dff','ape','wv','wma'] }],
    })
    if (!result) return null
    return typeof result === 'string' ? result : result[0] ?? null
  } catch { return null }
}

function buildTrackFromPath(path: string): AudioTrack {
  const fileName = path.split(/[\\/]/).pop() ?? path
  const title = fileName.replace(/\.[^.]+$/, '')
  const ext = (fileName.split('.').pop() ?? 'unknown').toLowerCase()
  const validCodecs = ['flac','wav','aiff','alac','aac','mp3','ogg','opus','dsf','dff','wma','ape','wavpack','tta','mp4'] as const
  type AC = typeof validCodecs[number]
  const codec: AC = validCodecs.includes(ext as AC) ? (ext as AC) : 'flac'
  const now = Date.now()
  return {
    id: `analyzer-${now}`,
    filePath: path,
    title,
    artist: 'Unknown',
    albumArtist: 'Unknown',
    album: 'Unknown',
    genre: '',
    year: null,
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    comment: '',
    durationMs: 0,
    sampleRate: 44100,
    bitDepth: 16,
    channels: 2,
    codec,
    bitrateKbps: 0,
    fileSizeBytes: 0,
    effectiveBitDepth: null,
    dynamicRange: null,
    lufs: null,
    truePeak: null,
    isLossyTranscode: null,
    lossyConfidence: null,
    replayGainTrack: null,
    replayGainAlbum: null,
    musicBrainzId: null,
    acoustId: null,
    albumId: `alb-${now}`,
    dateAdded: now,
    dateModified: now,
    lastPlayed: null,
    playCount: 0,
  }
}

function mapVerdictLevel(verdict: string): VerdictLevel {
  if (verdict === 'lossy' || verdict === 'lossy_transcode') return 'fail'
  if (verdict === 'suspect') return 'warn'
  if (verdict === 'lossless' || verdict === 'genuine') return 'pass'
  return 'info'
}

function mapAnalysisToCards(track: AudioTrack, analysis: EngineAnalysisResult): AnalysisResult {
  const isSuspectHiRes = track.sampleRate > 44100 && track.bitDepth > 16
  const hiResVerdict: VerdictLevel = analysis.isFakeBitDepth
    ? 'warn'
    : isSuspectHiRes
    ? 'info'
    : 'pass'

  const lossyVerdict: VerdictLevel = analysis.isLossyTranscode ? 'fail' : mapVerdictLevel(analysis.verdict)
  const dr = Number.isFinite(analysis.drValue) ? analysis.drValue : 0
  const drVerdict: VerdictLevel = dr >= 14 ? 'pass' : dr >= 8 ? 'warn' : 'fail'

  const lufs = Number.isFinite(analysis.lufsIntegrated) ? analysis.lufsIntegrated : -23
  const truePeak = Number.isFinite(analysis.truePeakDb) ? analysis.truePeakDb : -1
  const loudnessVerdict: VerdictLevel = truePeak > 0 ? 'fail' : lufs <= -16 ? 'pass' : 'warn'
  const bitVerdict: VerdictLevel = analysis.isFakeBitDepth ? 'warn' : 'pass'
  const clipping: VerdictLevel = truePeak > 0.3 ? 'fail' : truePeak > 0 ? 'warn' : 'pass'

  return {
    hiRes: {
      id: 'hiRes',
      label: 'Hi-Res Legitimacy',
      verdict: hiResVerdict,
      value: `${formatSampleRate(track.sampleRate)} / ${track.bitDepth}-bit`,
      detail: hiResVerdict === 'warn'
        ? `Container reports ${track.bitDepth}-bit but effective depth looks closer to ${analysis.effectiveBitDepth}-bit.`
        : hiResVerdict === 'info'
        ? 'Hi-res source detected; spectral ceiling checks are pending in next analysis stage.'
        : 'No immediate sign of fake hi-res from current bit-depth integrity checks.',
    },
    lossyTranscode: {
      id: 'lossyTranscode',
      label: 'Lossy Transcode Detection',
      verdict: lossyVerdict,
      value: lossyVerdict === 'fail'
        ? `Transcoded (${analysis.lossyConfidence}% conf.)`
        : lossyVerdict === 'pass'
        ? 'Clean'
        : 'Unknown',
      detail: lossyVerdict === 'fail'
        ? `Engine verdict indicates lossy transcode. Confidence: ${analysis.lossyConfidence}%.`
        : lossyVerdict === 'pass'
        ? analysis.verdictExplanation || 'No lossy transcode signal detected in current pass.'
        : analysis.verdictExplanation || 'Lossy verdict currently inconclusive.',
    },
    dynamicRange: {
      id: 'dynamicRange',
      label: 'Dynamic Range',
      verdict: drVerdict,
      value: `DR${dr.toFixed(1)}`,
      detail: drVerdict === 'pass'
        ? `DR${dr.toFixed(1)} — Wide crest factor and strong dynamic contrast.`
        : drVerdict === 'warn'
        ? `DR${dr.toFixed(1)} — Moderate dynamic compression detected.`
        : `DR${dr.toFixed(1)} — Heavy loudness compression likely.`,
    },
    loudness: {
      id: 'loudness',
      label: 'Integrated Loudness',
      verdict: loudnessVerdict,
      value: `${lufs.toFixed(1)} LUFS  /  ${truePeak >= 0 ? '+' : ''}${truePeak.toFixed(2)} dBTP`,
      detail: loudnessVerdict === 'fail'
        ? `True peak exceeds 0 dBFS (${truePeak.toFixed(2)} dBTP). Intersample clipping likely.`
        : loudnessVerdict === 'warn'
        ? `Louder than conservative broadcast targets; normalization will likely attenuate playback.`
        : 'Integrated loudness and true peak are within safe range.',
    },
    bitDepth: {
      id: 'bitDepth',
      label: 'Bit Depth Integrity',
      verdict: bitVerdict,
      value: `${analysis.declaredBitDepth}-bit${analysis.isFakeBitDepth ? ` (eff. ${analysis.effectiveBitDepth})` : ''}`,
      detail: bitVerdict === 'warn'
        ? `Declared ${analysis.declaredBitDepth}-bit but effective depth appears near ${analysis.effectiveBitDepth}-bit.`
        : 'Bit depth appears genuine — no zero-padding artifacts detected.',
    },
    clipping: {
      id: 'clipping',
      label: 'Clipping / Distortion',
      verdict: clipping,
      value: truePeak >= 0 ? `${truePeak.toFixed(2)} dBTP (clipped)` : 'None detected',
      detail: clipping === 'fail'
        ? 'Hard or intersample clipping detected. Source may be damaged.'
        : clipping === 'warn'
        ? 'True peak marginally above 0 dBFS. Intersample clipping possible.'
        : 'No clipping detected. All samples within safe range.',
    },
    dcOffset: {
      id: 'dcOffset',
      label: 'DC Offset',
      verdict: 'info',
      value: 'Pending A7.2.5',
      detail: 'DC offset metric is planned in A7.2.5 and is not yet calculated by the backend.',
    },
  }
}

// ── Verdict Badge ─────────────────────────────────────────────────────────────

function VerdictBadge({ level }: { level: VerdictLevel }) {
  const map: Record<VerdictLevel, { label: string; cls: string }> = {
    pass: { label: 'PASS', cls: 'text-[var(--ace-success)] bg-[var(--ace-success)]/10 border-[var(--ace-success)]/30' },
    warn: { label: 'WARN', cls: 'text-[var(--ace-warning)] bg-[var(--ace-warning)]/10 border-[var(--ace-warning)]/30' },
    fail: { label: 'FAIL', cls: 'text-[var(--ace-danger)] bg-[var(--ace-danger)]/10 border-[var(--ace-danger)]/30' },
    info: { label: 'INFO', cls: 'text-[var(--ace-info)] bg-[var(--ace-info)]/10 border-[var(--ace-info)]/30' },
  }
  const { label, cls } = map[level]
  return (
    <span className={cn('inline-flex items-center border px-1.5 py-0.5 rounded text-[10px] font-bold tracking-widest', cls)}>
      {label}
    </span>
  )
}

function VerdictIcon({ level, size = 16 }: { level: VerdictLevel; size?: number }) {
  if (level === 'pass') return <CheckCircle2 size={size} style={{ color: 'var(--ace-success)' }} />
  if (level === 'fail') return <XCircle size={size} style={{ color: 'var(--ace-danger)' }} />
  if (level === 'warn') return <AlertTriangle size={size} style={{ color: 'var(--ace-warning)' }} />
  return <Info size={size} style={{ color: 'var(--ace-info)' }} />
}

// ── Verdict Card Row ──────────────────────────────────────────────────────────

function VerdictRow({ card, expanded, onToggle }: {
  card: VerdictCard
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      className="border rounded overflow-hidden"
      style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <VerdictIcon level={card.verdict} size={15} />
        <span className="flex-1 text-sm font-medium" style={{ color: 'var(--ace-text-primary)' }}>
          {card.label}
        </span>
        <span className="text-xs font-mono mr-2" style={{ color: 'var(--ace-text-secondary)' }}>
          {card.value}
        </span>
        <VerdictBadge level={card.verdict} />
        {expanded ? (
          <ChevronDown size={13} style={{ color: 'var(--ace-text-muted)' }} className="ml-1 shrink-0" />
        ) : (
          <ChevronRight size={13} style={{ color: 'var(--ace-text-muted)' }} className="ml-1 shrink-0" />
        )}
      </button>
      {expanded && (
        <div
          className="px-3 pb-3 pt-1 text-xs border-t"
          style={{ color: 'var(--ace-text-secondary)', borderColor: 'var(--ace-border)' }}
        >
          {card.detail}
        </div>
      )}
    </div>
  )
}

// ── Spectrogram Canvas ────────────────────────────────────────────────────────

function SpectrogramCanvas({ track }: { track: AudioTrack | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H)
    bgGrad.addColorStop(0, '#050508')
    bgGrad.addColorStop(1, '#0a0a12')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, W, H)

    if (!track) {
      ctx.fillStyle = '#606080'
      ctx.font = '13px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Load a file to view spectrogram', W / 2, H / 2)
      return
    }

    // Setup engine hook
    const engine = getAudioEngine()
    let latestBins: Float32Array | null = null
    let unlisten: (() => void) | null = null

    engine.onFftFrame((frame) => {
      latestBins = frame.bins
    }).then(u => unlisten = u)

    const nyquist = track.sampleRate / 2
    const maxFreq = Math.min(nyquist, 48000)
    let animId = 0

    const draw = () => {
      if (latestBins) {
        // Shift image left by 2px
        const imgData = ctx.getImageData(2, 0, W - 2, H)
        ctx.putImageData(imgData, 0, 0)

        // Draw new column
        const binCount = latestBins.length
        for (let y = 0; y < H; y++) {
          const freq = maxFreq * (1 - y / H)
          const binIdx = Math.floor((freq / nyquist) * binCount)
          const db = latestBins[binIdx] ?? -120

          // Map dB to magnitude 0-1
          const mag = Math.min(1, Math.max(0, (db + 90) / 90))
          
          // Color mapping
          const r = Math.round(mag < 0.5 ? mag * 2 * 100 : 100 + (mag - 0.5) * 2 * 155)
          const g = Math.round(mag < 0.33 ? 0 : mag < 0.66 ? (mag - 0.33) / 0.33 * 200 : 200)
          const b = Math.round(mag < 0.5 ? 200 - mag * 2 * 200 : 0)
          
          ctx.fillStyle = `rgba(${r},${g},${b},1)`
          ctx.fillRect(W - 2, y, 2, 1)
        }

        // Draw frequency grid lines (redraw so they aren't smeared)
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 1
        const gridFreqs = [1000, 2000, 4000, 8000, 16000, 20000, 40000]
        gridFreqs.forEach(f => {
          if (f > maxFreq) return
          const y = Math.round(H * (1 - f / maxFreq))
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(W, y)
          ctx.stroke()
          ctx.fillStyle = 'rgba(255,255,255,0.35)'
          ctx.font = '10px monospace'
          ctx.textAlign = 'left'
          ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 4, y - 2)
        })

        latestBins = null // Consume
      }
      animId = requestAnimationFrame(draw)
    }
    
    draw()

    return () => {
      cancelAnimationFrame(animId)
      if (unlisten) unlisten()
    }
  }, [track])

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={300}
      className="w-full h-full"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

// ── Waveform Canvas ───────────────────────────────────────────────────────────

function WaveformCanvas({ track }: { track: AudioTrack | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#050508'
    ctx.fillRect(0, 0, W, H)

    if (!track) {
      ctx.fillStyle = '#606080'
      ctx.font = '13px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Load a file to view waveform', W / 2, H / 2)
      return
    }

    // Setup engine hook
    const engine = getAudioEngine()
    let latestPeak = 0
    let latestRms = 0
    let unlisten: (() => void) | null = null

    engine.onLevelMeter((meter) => {
      // average channels for display
      let peakSum = 0
      let rmsSum = 0
      for (const ch of meter.channels) {
        // map dB (-90 to 0) to linear 0-1
        peakSum += Math.max(0, (ch.peakDb + 90) / 90)
        rmsSum += Math.max(0, (ch.rmsDb + 90) / 90)
      }
      latestPeak = peakSum / meter.channels.length
      latestRms = rmsSum / meter.channels.length
    }).then(u => unlisten = u)

    let animId = 0
    const mid = H / 2

    const draw = () => {
      // Shift image left by 2px
      const imgData = ctx.getImageData(2, 0, W - 2, H)
      ctx.putImageData(imgData, 0, 0)
      
      // Clear new column area
      ctx.fillStyle = '#050508'
      ctx.fillRect(W - 2, 0, 2, H)

      // Center line
      ctx.fillStyle = 'rgba(124,106,255,0.2)'
      ctx.fillRect(W - 2, mid, 2, 1)

      const peakH = latestPeak * mid * 0.95
      const rmsH = latestRms * mid * 0.95

      ctx.fillStyle = 'rgba(124,106,255,0.25)'
      ctx.fillRect(W - 2, mid - peakH, 2, peakH * 2)

      ctx.fillStyle = 'rgba(124,106,255,0.7)'
      ctx.fillRect(W - 2, mid - rmsH, 2, rmsH * 2)

      // Decay
      latestPeak *= 0.9
      latestRms *= 0.9

      animId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animId)
      if (unlisten) unlisten()
    }
  }, [track])

  return <canvas ref={canvasRef} width={800} height={200} className="w-full h-full" />
}

// ── Spectrum Canvas ───────────────────────────────────────────────────────────

function SpectrumCanvas({ track }: { track: AudioTrack | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height

    if (!track) {
      ctx.fillStyle = '#050508'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#606080'
      ctx.font = '13px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Load a file to view spectrum', W / 2, H / 2)
      return
    }

    const BARS = 128
    const barW = W / BARS

    const engine = getAudioEngine()
    let latestBins: Float32Array | null = null
    let unlisten: (() => void) | null = null

    engine.onFftFrame((frame) => {
      latestBins = frame.bins
    }).then(u => unlisten = u)

    let frameCount = 0
    const draw = () => {
      ctx.fillStyle = '#050508'
      ctx.fillRect(0, 0, W, H)

      // dB grid
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      for (let db = -60; db <= 0; db += 10) {
        const y = H * (1 - (db + 60) / 60)
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
        ctx.font = '9px monospace'
        ctx.textAlign = 'right'
        ctx.fillText(`${db}`, W - 4, y - 2)
      }

      if (latestBins) {
        const binCount = latestBins.length
        const binsPerBar = Math.max(1, Math.floor(binCount / BARS))
        
        for (let i = 0; i < BARS; i++) {
          let sum = 0
          for (let j = 0; j < binsPerBar; j++) {
            const idx = Math.min(binCount - 1, i * binsPerBar + j)
            // convert dB (-90 to 0) to approx 0-1
            const db = latestBins[idx]
            sum += Math.max(0, (db + 90) / 90)
          }
          const mag = Math.min(1, sum / binsPerBar)

          const barH = mag * (H - 20)
          const x = i * barW

          const grad = ctx.createLinearGradient(0, H - barH, 0, H)
          grad.addColorStop(0, `rgba(124,106,255,${0.5 + mag * 0.5})`)
          grad.addColorStop(0.7, 'rgba(124,106,255,0.6)')
          grad.addColorStop(1, 'rgba(80,220,255,0.8)')
          ctx.fillStyle = grad
          ctx.fillRect(x + 1, H - 20 - barH, barW - 2, barH)
        }
      }

      frameCount++
      animRef.current = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(animRef.current)
      if (unlisten) unlisten()
    }
  }, [track])

  return <canvas ref={canvasRef} width={800} height={280} className="w-full h-full" />
}

// ── Track Info Strip ──────────────────────────────────────────────────────────

function TrackInfoStrip({ track }: { track: AudioTrack }) {
  const fields = [
    { label: 'Codec', value: track.codec.toUpperCase() },
    { label: 'Sample Rate', value: formatSampleRate(track.sampleRate) },
    { label: 'Bit Depth', value: track.bitDepth ? `${track.bitDepth}-bit` : '—' },
    { label: 'Channels', value: track.channels === 1 ? 'Mono' : track.channels === 2 ? 'Stereo' : `${track.channels}ch` },
    { label: 'Bitrate', value: track.bitrateKbps ? `${track.bitrateKbps} kbps` : '—' },
    { label: 'Duration', value: formatDuration(track.durationMs) },
    { label: 'File Size', value: track.fileSizeBytes ? `${(track.fileSizeBytes / 1048576).toFixed(1)} MB` : '—' },
  ]
  return (
    <div
      className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-2 border-b text-xs font-mono"
      style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-secondary)' }}
    >
      <span className="font-semibold truncate max-w-50" style={{ color: 'var(--ace-text-primary)' }}>
        {track.title}
      </span>
      {track.artist && <span style={{ color: 'var(--ace-text-muted)' }}>{track.artist}</span>}
      {fields.map(f => (
        <span key={f.label}>
          <span style={{ color: 'var(--ace-text-muted)' }}>{f.label}: </span>
          <span style={{ color: 'var(--ace-text-secondary)' }}>{f.value}</span>
        </span>
      ))}
    </div>
  )
}

// ── Overall Score ─────────────────────────────────────────────────────────────

function OverallScore({ result }: { result: AnalysisResult }) {
  const cards = Object.values(result)
  const fails = cards.filter(c => c.verdict === 'fail').length
  const warns = cards.filter(c => c.verdict === 'warn').length
  const score = Math.max(0, 100 - fails * 20 - warns * 8)
  const color = score >= 80 ? 'var(--ace-success)' : score >= 50 ? 'var(--ace-warning)' : 'var(--ace-danger)'
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor'

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded border"
      style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}
    >
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 52 52" className="w-full h-full -rotate-90">
          <circle cx="26" cy="26" r="22" fill="none" stroke="var(--ace-border)" strokeWidth="4" />
          <circle
            cx="26" cy="26" r="22" fill="none"
            stroke={color} strokeWidth="4"
            strokeDasharray={`${score * 1.382} 138.2`}
            strokeLinecap="round"
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-sm font-bold"
          style={{ color }}
        >
          {score}
        </span>
      </div>
      <div>
        <div className="text-base font-bold" style={{ color }}>{label}</div>
        <div className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
          {fails > 0 && <span className="text-(--ace-danger)">{fails} fail{fails > 1 ? 's' : ''}  </span>}
          {warns > 0 && <span className="text-(--ace-warning)">{warns} warning{warns > 1 ? 's' : ''}</span>}
          {fails === 0 && warns === 0 && <span style={{ color: 'var(--ace-success)' }}>All checks passed</span>}
        </div>
      </div>
    </div>
  )
}

function SpectralDeltaHeat({ data }: { data: number[] }) {
  if (!data.length) {
    return (
      <div className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
        No spectral delta data.
      </div>
    )
  }

  const maxAbs = Math.max(1, ...data.map(v => Math.abs(v)))
  return (
    <div className="grid grid-cols-16 gap-1">
      {data.map((v, i) => {
        const t = Math.min(1, Math.abs(v) / maxAbs)
        const color = v >= 0
          ? `rgba(255, 90, 80, ${0.25 + t * 0.75})`
          : `rgba(80, 170, 255, ${0.25 + t * 0.75})`
        return (
          <div
            key={i}
            className="h-3 rounded-sm"
            title={`Bin ${i}: ${v.toFixed(2)} dB`}
            style={{ background: color }}
          />
        )
      })}
    </div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function AnalyzerView() {
  const currentTrack = usePlaybackStore(s => s.currentTrack)
  const [track, setTrack] = useState<AudioTrack | null>(currentTrack)
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [compareA, setCompareA] = useState<AudioTrack | null>(null)
  const [compareB, setCompareB] = useState<AudioTrack | null>(null)
  const [compareStatus, setCompareStatus] = useState<AnalysisStatus>('idle')
  const [compareResult, setCompareResult] = useState<MasteringComparisonResult | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('spectrogram')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Sync with now-playing track
  useEffect(() => {
    if (currentTrack && currentTrack.id !== track?.id) {
      const timer = setTimeout(() => {
        setTrack(currentTrack)
        setResult(null)
        setStatus('idle')
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [currentTrack, track])

  const handleLoadFile = useCallback(async () => {
    const path = await openAudioFile()
    if (!path) return
    const newTrack = buildTrackFromPath(path)
    setTrack(newTrack)
    setResult(null)
    setStatus('idle')
  }, [])

  const handleLoadCompare = useCallback(async (slot: 'a' | 'b') => {
    const path = await openAudioFile()
    if (!path) return
    const t = buildTrackFromPath(path)
    if (slot === 'a') setCompareA(t)
    else setCompareB(t)
    setCompareResult(null)
    setCompareStatus('idle')
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!track) return
    setStatus('analyzing')
    setResult(null)
    try {
      const analysis = await getAudioEngine().analyzeFile(track.filePath)
      setResult(mapAnalysisToCards(track, analysis))
      setStatus('done')
      setExpanded(new Set())
    } catch (err) {
      console.error('Analysis failed', err)
      setStatus('error')
    }
  }, [track])

  const handleCompareMastering = useCallback(async () => {
    if (!compareA || !compareB) return
    setCompareStatus('analyzing')
    setCompareResult(null)
    try {
      const res = await getAudioEngine().compareMastering(compareA.filePath, compareB.filePath)
      setCompareResult(res)
      setCompareStatus('done')
    } catch (err) {
      console.error('Mastering comparison failed', err)
      setCompareStatus('error')
    }
  }, [compareA, compareB])

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const TABS: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'spectrogram', label: 'Spectrogram', icon: <Activity size={14} /> },
    { id: 'waveform',    label: 'Waveform',    icon: <AudioWaveform size={14} /> },
    { id: 'spectrum',    label: 'Real-Time Spectrum', icon: <BarChart3 size={14} /> },
  ]

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)' }}>

      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0"
        style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}
      >
        <button
          onClick={handleLoadFile}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium hover:bg-white/10 transition-colors border"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
        >
          <FolderOpen size={13} />
          Load File
        </button>

        <div className="w-px h-5" style={{ background: 'var(--ace-border)' }} />

        {track ? (
          <span className="flex-1 text-xs truncate" style={{ color: 'var(--ace-text-secondary)' }}>
            {track.filePath}
          </span>
        ) : (
          <span className="flex-1 text-xs" style={{ color: 'var(--ace-text-muted)' }}>
            No file loaded — load a file or play a track
          </span>
        )}

        <button
          onClick={handleAnalyze}
          disabled={!track || status === 'analyzing'}
          className={cn(
            'flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold transition-all border',
            !track || status === 'analyzing'
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:opacity-90 active:scale-95',
          )}
          style={{
            background: 'var(--ace-accent)',
            borderColor: 'var(--ace-accent)',
            color: '#fff',
          }}
        >
          {status === 'analyzing' ? (
            <><Loader2 size={13} className="animate-spin" /> Analyzing…</>
          ) : (
            <><RefreshCw size={13} /> Analyze</>
          )}
        </button>
      </div>

      {/* ── Track info strip ── */}
      {track && <TrackInfoStrip track={track} />}

      {/* ── Main body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Verdicts panel ── */}
        <div
          className="w-72 shrink-0 flex flex-col border-r overflow-y-auto"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg)' }}
        >
          <div
            className="px-3 py-2 text-xs font-semibold uppercase tracking-widest border-b"
            style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-muted)' }}
          >
            Analysis Results
          </div>

          {status === 'idle' && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
              <Activity size={32} style={{ color: 'var(--ace-text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
                {track ? 'Press Analyze to run full diagnostic scan.' : 'Load a file first.'}
              </p>
            </div>
          )}

          {status === 'analyzing' && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--ace-accent)' }} />
              <p className="text-xs" style={{ color: 'var(--ace-text-secondary)' }}>
                Scanning audio content…
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
              <XCircle size={28} style={{ color: 'var(--ace-danger)' }} />
              <p className="text-xs" style={{ color: 'var(--ace-text-secondary)' }}>
                Analysis failed. Check engine logs and try again.
              </p>
            </div>
          )}

          {status === 'done' && result && (
            <div className="flex flex-col gap-2 p-3 overflow-y-auto">
              <OverallScore result={result} />
              {Object.values(result).map(card => (
                <VerdictRow
                  key={card.id}
                  card={card}
                  expanded={expanded.has(card.id)}
                  onToggle={() => toggleExpanded(card.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Visual tabs ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Tab bar */}
          <div
            className="flex items-center gap-0 border-b shrink-0"
            style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
          >
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-(--ace-accent) text-(--ace-text-primary)'
                    : 'border-transparent hover:border-(--ace-border-strong)',
                )}
                style={{
                  color: activeTab === tab.id ? 'var(--ace-text-primary)' : 'var(--ace-text-muted)',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Canvas area */}
          <div className="flex-1 overflow-hidden p-3" style={{ background: '#050508' }}>
            {activeTab === 'spectrogram' && (
              <div className="w-full h-full flex flex-col gap-3">
                <div className="flex-[2] min-h-0 relative">
                  <div className="absolute top-2 left-2 text-[10px] text-white/40 uppercase tracking-widest z-10 font-medium bg-black/40 px-2 py-0.5 rounded">
                    Spectrogram
                  </div>
                  <SpectrogramCanvas track={track} />
                </div>
                <div className="flex-1 min-h-0 relative border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="absolute top-2 left-2 text-[10px] text-white/40 uppercase tracking-widest z-10 font-medium bg-black/40 px-2 py-0.5 rounded">
                    Linear Frequency-Energy
                  </div>
                  <SpectrumCanvas track={track} />
                </div>
              </div>
            )}
            {activeTab === 'waveform' && (
              <div className="w-full h-full">
                <WaveformCanvas track={track} />
              </div>
            )}
            {activeTab === 'spectrum' && (
              <div className="w-full h-full">
                <SpectrumCanvas track={track} />
              </div>
            )}
          </div>

          {/* Footer legend */}
          <div
            className="px-4 py-1.5 text-xs border-t flex items-center gap-4"
            style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-muted)' }}
          >
            <span>Spectrogram: color = energy (blue → yellow → red)</span>
            <span className="ml-auto">
              {track
                ? `${track.sampleRate ? formatSampleRate(track.sampleRate) : '?'} / ${track.bitDepth || '?'}-bit  ·  ${track.codec.toUpperCase()}`
                : 'No file loaded'}
            </span>
          </div>

          <div className="border-t p-3" style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
            <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--ace-text-muted)' }}>
              Mastering Comparison
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                onClick={() => handleLoadCompare('a')}
                className="px-2 py-1.5 rounded border text-xs text-left"
                style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
              >
                A: {compareA?.title ?? 'Load Version A'}
              </button>
              <button
                onClick={() => handleLoadCompare('b')}
                className="px-2 py-1.5 rounded border text-xs text-left"
                style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
              >
                B: {compareB?.title ?? 'Load Version B'}
              </button>
            </div>
            <button
              onClick={handleCompareMastering}
              disabled={!compareA || !compareB || compareStatus === 'analyzing'}
              className={cn(
                'px-3 py-1.5 rounded text-xs font-semibold border',
                !compareA || !compareB || compareStatus === 'analyzing' ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'
              )}
              style={{ background: 'var(--ace-accent)', borderColor: 'var(--ace-accent)', color: '#fff' }}
            >
              {compareStatus === 'analyzing' ? 'Comparing…' : 'Compare Mastering'}
            </button>

            {compareResult && (
              <div className="mt-3 space-y-2 text-xs" style={{ color: 'var(--ace-text-secondary)' }}>
                <div>Auto alignment offset: {compareResult.timeOffsetMs} ms</div>
                <div className="grid grid-cols-3 gap-2">
                  <div style={{ color: 'var(--ace-text-muted)' }}>Metric</div>
                  <div>A</div>
                  <div>B</div>
                  <div style={{ color: 'var(--ace-text-muted)' }}>DR</div>
                  <div>{compareResult.drA.toFixed(1)}</div>
                  <div>{compareResult.drB.toFixed(1)}</div>
                  <div style={{ color: 'var(--ace-text-muted)' }}>LUFS</div>
                  <div>{compareResult.lufsA.toFixed(1)}</div>
                  <div>{compareResult.lufsB.toFixed(1)}</div>
                  <div style={{ color: 'var(--ace-text-muted)' }}>True Peak</div>
                  <div>{compareResult.truePeakA.toFixed(2)} dBTP</div>
                  <div>{compareResult.truePeakB.toFixed(2)} dBTP</div>
                </div>
                <div style={{ color: 'var(--ace-text-muted)' }}>Spectral delta (A-B)</div>
                <SpectralDeltaHeat data={compareResult.spectralDeltaDb} />
              </div>
            )}

            {compareStatus === 'error' && (
              <div className="mt-2 text-xs" style={{ color: 'var(--ace-danger)' }}>
                Mastering comparison failed.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

