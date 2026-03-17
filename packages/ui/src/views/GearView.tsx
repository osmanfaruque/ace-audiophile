'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Search, Plus, Headphones, Ear, Speaker, Bluetooth,
  Upload, ChevronDown, ChevronRight, Sliders,
  X, Zap, FileDown, RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAudioEngine } from '@/lib/audioEngine'
import { useDspStore } from '@/store/dspStore'
import type { EqBand, GearProfile, TargetCurve } from '@ace/types'
import {
  parseAutoEqCsv,
  parseRewTxt,
  parseSquigLinkProfile,
  toGearProfileFromFr,
} from '@/lib/frImport'
import {
  DEFAULT_CUSTOM_TARGET,
  getCurveAnchors,
  getTargetCurvePoints,
  type TargetAnchor,
} from '@/lib/targetCurves'

// ── Constants ─────────────────────────────────────────────────────────────────

const GEAR_TYPES = [
  { value: 'headphone' as const, label: 'Over-ear', icon: Headphones },
  { value: 'iem' as const, label: 'IEM', icon: Ear },
  { value: 'tws' as const, label: 'TWS', icon: Bluetooth },
  { value: 'speaker' as const, label: 'Speaker', icon: Speaker },
] as const

const TARGET_CURVES: { value: TargetCurve; label: string; desc: string }[] = [
  { value: 'harmanIE2018', label: 'Harman 2018 In-Ear', desc: 'Built-in in-ear preference target' },
  { value: 'harman2019', label: 'Harman 2019 Over-Ear', desc: 'Built-in over-ear preference target' },
  { value: 'diffuseField', label: 'Diffuse Field', desc: 'Flat response compensated for ear/head diffraction' },
  { value: 'freeField', label: 'Free Field', desc: 'Flat response in anechoic conditions' },
  { value: 'custom', label: 'Custom', desc: 'User-defined preference curve' },
]

/** Standard audiogram frequencies for FR display */
const FR_FREQUENCIES = [
  20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
  630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000, 20000,
]

// ── Sample data ───────────────────────────────────────────────────────────────

function generateSampleFR(type: GearProfile['type'], seed: number): number[] {
  return FR_FREQUENCIES.map((f, i) => {
    const x = f / 20000
    // Base response with characteristic curves per type
    let spl: number
    if (type === 'headphone') {
      spl = 80 + 8 * Math.sin(x * 6) - 4 * x + 12 * Math.exp(-((x - 0.15) ** 2) / 0.002)
    } else if (type === 'iem') {
      spl = 78 + 10 * Math.sin(x * 8) + 15 * Math.exp(-((x - 0.2) ** 2) / 0.003) - 3 * x
    } else if (type === 'tws') {
      spl = 76 + 6 * Math.sin(x * 5) + 10 * Math.exp(-((x - 0.15) ** 2) / 0.004) - 8 * x
    } else {
      spl = 82 + 4 * Math.sin(x * 4) - 2 * x
    }
    // Add pseudo-random variation using seed
    spl += 3 * Math.sin(seed * 7 + i * 0.8) + 2 * Math.cos(seed * 3 + i * 1.3)
    return Math.round(spl * 10) / 10
  })
}

const SAMPLE_GEAR: GearProfile[] = [
  { id: 'hd650', name: 'HD 650', brand: 'Sennheiser', type: 'headphone', frFrequencies: FR_FREQUENCIES, frSpl: generateSampleFR('headphone', 1), correctionPresetId: null, source: 'oratory' },
  { id: 'er2xr', name: 'ER2XR', brand: 'Etymotic', type: 'iem', frFrequencies: FR_FREQUENCIES, frSpl: generateSampleFR('iem', 2), correctionPresetId: null, source: 'crinacle' },
  { id: 'hd800s', name: 'HD 800 S', brand: 'Sennheiser', type: 'headphone', frFrequencies: FR_FREQUENCIES, frSpl: generateSampleFR('headphone', 3), correctionPresetId: null, source: 'oratory' },
  { id: 'bless2d', name: 'Blessing 2 Dusk', brand: 'Moondrop', type: 'iem', frFrequencies: FR_FREQUENCIES, frSpl: generateSampleFR('iem', 4), correctionPresetId: null, source: 'crinacle' },
  { id: 'sundara', name: 'Sundara', brand: 'HiFiMAN', type: 'headphone', frFrequencies: FR_FREQUENCIES, frSpl: generateSampleFR('headphone', 5), correctionPresetId: null, source: 'autoeq' },
  { id: 'galaxy-buds2p', name: 'Galaxy Buds2 Pro', brand: 'Samsung', type: 'tws', frFrequencies: FR_FREQUENCIES, frSpl: generateSampleFR('tws', 6), correctionPresetId: null, source: 'autoeq' },
]

// ── FR Chart (SVG) ────────────────────────────────────────────────────────────

function FRChart({
  gear,
  targetCurve,
  showCorrection,
  customAnchors,
  fittedBands,
  onChangeCustomAnchors,
}: {
  gear: GearProfile
  targetCurve: TargetCurve
  showCorrection: boolean
  customAnchors: TargetAnchor[]
  fittedBands: EqBand[]
  onChangeCustomAnchors: (anchors: TargetAnchor[]) => void
}) {
  const W = 780, H = 340
  const PAD = { top: 20, right: 30, bottom: 40, left: 50 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const targetFR = useMemo(
    () => getTargetCurvePoints(targetCurve, gear.frFrequencies, customAnchors),
    [targetCurve, gear.frFrequencies, customAnchors],
  )

  const correction = useMemo(
    () => gear.frSpl.map((spl, i) => targetFR[i] - spl),
    [gear.frSpl, targetFR],
  )

  const logMin = Math.log10(20)
  const logMax = Math.log10(20000)
  const xOf = (freq: number) => PAD.left + ((Math.log10(freq) - logMin) / (logMax - logMin)) * plotW
  const freqOfX = (x: number) => Math.pow(10, logMin + ((x - PAD.left) / plotW) * (logMax - logMin))

  const splMin = 50, splMax = 100
  const yOfSpl = (spl: number) => PAD.top + (1 - (spl - splMin) / (splMax - splMin)) * plotH
  const splOfY = (y: number) => splMin + (1 - (y - PAD.top) / plotH) * (splMax - splMin)

  const corrMin = -20, corrMax = 20
  const yOfCorr = (db: number) => PAD.top + (1 - (db - corrMin) / (corrMax - corrMin)) * plotH

  const pathOfData = (yMapper: (v: number) => number, data: number[]) =>
    data.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(gear.frFrequencies[i]).toFixed(1)},${yMapper(v).toFixed(1)}`).join(' ')

  const measuredPath = pathOfData(yOfSpl, gear.frSpl)
  const targetPath = pathOfData(yOfSpl, targetFR)
  const corrPath = pathOfData(yOfCorr, correction)
  const fittedPath = fittedBands.length
    ? fittedBands
        .map((b, i) => `${i === 0 ? 'M' : 'L'}${xOf(b.frequency).toFixed(1)},${yOfCorr(b.gainDb).toFixed(1)}`)
        .join(' ')
    : ''

  const editableAnchors = useMemo(
    () => getCurveAnchors(targetCurve, customAnchors),
    [targetCurve, customAnchors],
  )

  const updateFromEvent = useCallback((ev: MouseEvent) => {
    if (dragIdx == null || !svgRef.current || targetCurve !== 'custom') return

    const rect = svgRef.current.getBoundingClientRect()
    const x = ((ev.clientX - rect.left) / rect.width) * W
    const y = ((ev.clientY - rect.top) / rect.height) * H

    let f = Math.min(20000, Math.max(20, freqOfX(Math.min(PAD.left + plotW, Math.max(PAD.left, x)))))
    const s = Math.min(splMax, Math.max(splMin, splOfY(Math.min(PAD.top + plotH, Math.max(PAD.top, y)))))

    const next = [...editableAnchors]
    const prevF = dragIdx > 0 ? next[dragIdx - 1].frequencyHz : 20
    const nextF = dragIdx < next.length - 1 ? next[dragIdx + 1].frequencyHz : 20000
    f = Math.min(nextF * 0.98, Math.max(prevF * 1.02, f))

    next[dragIdx] = { frequencyHz: f, splDb: s }
    onChangeCustomAnchors(next)
  }, [dragIdx, editableAnchors, onChangeCustomAnchors, plotH, plotW, targetCurve])

  useEffect(() => {
    if (dragIdx == null) return
    const onMove = (ev: MouseEvent) => updateFromEvent(ev)
    const onUp = () => setDragIdx(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragIdx, updateFromEvent])

  const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
  const gridDb = showCorrection
    ? [-20, -15, -10, -5, 0, 5, 10, 15, 20]
    : [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]

  const fmtFreq = (f: number) => f >= 1000 ? `${f / 1000}k` : `${f}`

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ fontFamily: 'var(--ace-font-mono)' }}>
      <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="#08080c" rx="2" />

      {gridFreqs.map(f => (
        <g key={f}>
          <line x1={xOf(f)} y1={PAD.top} x2={xOf(f)} y2={PAD.top + plotH} stroke="rgba(255,255,255,0.06)" />
          <text x={xOf(f)} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">
            {fmtFreq(f)}
          </text>
        </g>
      ))}

      {gridDb.map(db => {
        const y = showCorrection ? yOfCorr(db) : yOfSpl(db)
        return (
          <g key={db}>
            <line x1={PAD.left} y1={y} x2={PAD.left + plotW} y2={y}
              stroke={db === 0 && showCorrection ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'} />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9">
              {showCorrection ? `${db > 0 ? '+' : ''}${db}` : db}
            </text>
          </g>
        )
      })}

      <text x={W / 2} y={H - 0} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9">
        Frequency (Hz)
      </text>
      <text x={12} y={H / 2} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9"
        transform={`rotate(-90, 12, ${H / 2})`}>
        {showCorrection ? 'Correction (dB)' : 'SPL (dB)'}
      </text>

      {showCorrection ? (
        <>
          <line x1={PAD.left} y1={yOfCorr(0)} x2={PAD.left + plotW} y2={yOfCorr(0)}
            stroke="rgba(255,255,255,0.12)" strokeDasharray="4 3" />
          <path d={corrPath} fill="none" stroke="var(--ace-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={corrPath + `L${xOf(20000)},${yOfCorr(0)} L${xOf(20)},${yOfCorr(0)} Z`}
            fill="var(--ace-accent)" opacity="0.08" />
          {fittedPath && (
            <path
              d={fittedPath}
              fill="none"
              stroke="rgba(255,180,90,0.95)"
              strokeWidth="1.8"
              strokeDasharray="4 3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </>
      ) : (
        <>
          <path d={targetPath} fill="none" stroke="rgba(76,175,130,0.75)" strokeWidth="1.8"
            strokeDasharray="6 3" strokeLinecap="round" />
          <path d={measuredPath} fill="none" stroke="var(--ace-accent)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" />
          <path d={measuredPath + `L${xOf(20000)},${PAD.top + plotH} L${xOf(20)},${PAD.top + plotH} Z`}
            fill="var(--ace-accent)" opacity="0.06" />
          {targetCurve === 'custom' && editableAnchors.map((a, idx) => (
            <circle
              key={`${a.frequencyHz}-${idx}`}
              cx={xOf(a.frequencyHz)}
              cy={yOfSpl(a.splDb)}
              r={5}
              fill="rgba(80,220,255,0.95)"
              stroke="#00131a"
              strokeWidth={1}
              style={{ cursor: 'grab' }}
              onMouseDown={() => setDragIdx(idx)}
            />
          ))}
        </>
      )}

      {!showCorrection && (
        <g transform={`translate(${PAD.left + 12}, ${PAD.top + 12})`}>
          <line x1="0" y1="0" x2="18" y2="0" stroke="var(--ace-accent)" strokeWidth="2.5" />
          <text x="24" y="3" fill="var(--ace-text-secondary)" fontSize="10">Measured</text>
          <line x1="0" y1="16" x2="18" y2="16" stroke="rgba(76,175,130,0.75)" strokeWidth="1.8" strokeDasharray="6 3" />
          <text x="24" y="19" fill="var(--ace-text-secondary)" fontSize="10">Target</text>
          {targetCurve === 'custom' && (
            <text x="0" y="34" fill="rgba(80,220,255,0.9)" fontSize="9">Drag cyan points to draw custom target</text>
          )}
        </g>
      )}
    </svg>
  )
}

// ── Gear List Item ────────────────────────────────────────────────────────────

function GearListItem({ gear, selected, onClick }: {
  gear: GearProfile
  selected: boolean
  onClick: () => void
}) {
  const TypeIcon = GEAR_TYPES.find(t => t.value === gear.type)?.icon ?? Headphones
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-l-2',
        selected
          ? 'border-l-(--ace-accent) bg-(--ace-accent)/8'
          : 'border-l-transparent hover:bg-white/5',
      )}
    >
      <TypeIcon size={14} style={{ color: selected ? 'var(--ace-accent)' : 'var(--ace-text-muted)' }} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: 'var(--ace-text-primary)' }}>
          {gear.name}
        </div>
        <div className="text-[10px] truncate" style={{ color: 'var(--ace-text-muted)' }}>
          {gear.brand} · {gear.source}
        </div>
      </div>
    </button>
  )
}

// ── EQ Band Table ─────────────────────────────────────────────────────────────

function EqCorrectionTable({
  gear,
  targetCurve,
  customAnchors,
  fittedBands,
}: {
  gear: GearProfile
  targetCurve: TargetCurve
  customAnchors: TargetAnchor[]
  fittedBands: EqBand[]
}) {
  const targetFR = useMemo(
    () => getTargetCurvePoints(targetCurve, gear.frFrequencies, customAnchors),
    [targetCurve, gear.frFrequencies, customAnchors],
  )

  const bands = useMemo(() => {
    if (fittedBands.length > 0) {
      return fittedBands.map((b) => ({ freq: b.frequency, gain: b.gainDb, q: b.q }))
    }
    return gear.frSpl.map((spl, i) => ({
      freq: gear.frFrequencies[i],
      gain: Math.round((targetFR[i] - spl) * 10) / 10,
      q: 1.0 + Math.abs(targetFR[i] - spl) * 0.15,
    }))
  }, [fittedBands, gear.frSpl, gear.frFrequencies, targetFR])

  return (
    <div className="border rounded overflow-hidden" style={{ borderColor: 'var(--ace-border)' }}>
      <div className="grid grid-cols-[80px_80px_80px_60px] gap-0 text-[10px] font-semibold uppercase tracking-widest px-3 py-1.5 border-b"
        style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-muted)', background: 'var(--ace-bg-overlay)' }}>
        <span>Freq</span>
        <span>Gain</span>
        <span>Q</span>
        <span>Type</span>
      </div>
      {bands.map((b, i) => (
        <div key={i} className="grid grid-cols-[80px_80px_80px_60px] gap-0 text-xs px-3 py-1.5 border-b last:border-b-0"
          style={{ borderColor: 'var(--ace-border)' }}>
          <span className="font-mono" style={{ color: 'var(--ace-text-secondary)' }}>
            {b.freq >= 1000 ? `${(b.freq / 1000).toFixed(1)}k` : `${b.freq}`} Hz
          </span>
          <span className="font-mono" style={{ color: b.gain > 0 ? 'var(--ace-success)' : b.gain < 0 ? 'var(--ace-danger)' : 'var(--ace-text-muted)' }}>
            {b.gain > 0 ? '+' : ''}{b.gain} dB
          </span>
          <span className="font-mono" style={{ color: 'var(--ace-text-muted)' }}>
            {(b.q ?? (1.0 + Math.abs(b.gain) * 0.15)).toFixed(2)}
          </span>
          <span style={{ color: 'var(--ace-text-muted)' }}>Peak</span>
        </div>
      ))}
      {bands.length === 0 && (
        <div className="text-xs text-center py-4" style={{ color: 'var(--ace-text-muted)' }}>
          No significant correction needed — already close to target.
        </div>
      )}
    </div>
  )
}

// ── Main GearView ─────────────────────────────────────────────────────────────

export function GearView() {
  const audioEngine = useMemo(() => getAudioEngine(), [])
  const dspState = useDspStore((s) => s.state)
  const updateBand = useDspStore((s) => s.updateBand)
  const setEqEnabled = useDspStore((s) => s.setEqEnabled)
  const [gearList, setGearList] = useState<GearProfile[]>(SAMPLE_GEAR)
  const [selectedId, setSelectedId] = useState<string>(SAMPLE_GEAR[0].id)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<GearProfile['type'] | 'all'>('all')
  const [targetCurve, setTargetCurve] = useState<TargetCurve>('harman2019')
  const [customAnchors, setCustomAnchors] = useState<TargetAnchor[]>(DEFAULT_CUSTOM_TARGET)
  const [showCorrection, setShowCorrection] = useState(false)
  const [showEqTable, setShowEqTable] = useState(true)
  const [importIssues, setImportIssues] = useState<string[]>([])
  const [fittedBands, setFittedBands] = useState<EqBand[]>([])
  const [fitStatus, setFitStatus] = useState<'idle' | 'running' | 'ready' | 'error'>('idle')
  const [fitError, setFitError] = useState<string>('')
  const [localOnlyScope, setLocalOnlyScope] = useState(true)
  const [hasLocalApply, setHasLocalApply] = useState(false)
  const localBypassSnapshot = useRef<{ bands: EqBand[]; eqEnabled: boolean } | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const selected = gearList.find(g => g.id === selectedId) ?? gearList[0]
  const targetFR = useMemo(() => {
    if (!selected) return []
    return getTargetCurvePoints(targetCurve, selected.frFrequencies, customAnchors)
  }, [selected, targetCurve, customAnchors])

  const filtered = useMemo(() => {
    let list = gearList
    if (filterType !== 'all') list = list.filter(g => g.type === filterType)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.brand.toLowerCase().includes(q),
      )
    }
    return list
  }, [gearList, filterType, searchQuery])

  const handleImportFr = useCallback(async (file: File) => {
    const text = await file.text()
    const lower = file.name.toLowerCase()

    let parsed = parseAutoEqCsv(text)
    let source: GearProfile['source'] = 'autoeq'
    if (lower.endsWith('.txt')) {
      parsed = parseRewTxt(text)
      source = 'custom'
    } else if (lower.includes('squig') || lower.endsWith('.json')) {
      parsed = parseSquigLinkProfile(text)
      source = 'crinacle'
    }

    if (parsed.points.length === 0) {
      setImportIssues(['Import failed: no valid FR points found.'])
      return
    }

    const base = file.name.replace(/\.[^.]+$/, '')
    const id = `import-${Date.now()}`
    const profile = toGearProfileFromFr(id, base, 'Imported', 'iem', source, parsed.points)
    setGearList((prev) => [profile, ...prev])
    setSelectedId(id)
    setImportIssues(parsed.issues)
  }, [])

  useEffect(() => {
    if (!selected) {
      const timer = setTimeout(() => {
        setFittedBands([])
        setFitStatus('idle')
        setFitError('')
      }, 0)
      return () => clearTimeout(timer)
    }
    if (selected.frFrequencies.length === 0 || selected.frSpl.length === 0 || targetFR.length === 0) {
      const timer = setTimeout(() => {
        setFittedBands([])
        setFitStatus('idle')
        setFitError('')
      }, 0)
      return () => clearTimeout(timer)
    }

    let cancelled = false
    const statusTimer = setTimeout(() => {
      setFitStatus('running')
      setFitError('')
    }, 0)

    audioEngine
      .fitAutoEqBands(
        selected.frFrequencies,
        selected.frSpl,
        selected.frFrequencies,
        targetFR,
        60,
      )
      .then((bands) => {
        if (cancelled) return
        setFittedBands(bands)
        setFitStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('Auto-EQ fit failed:', msg)
        setFittedBands([])
        setFitStatus('error')
        setFitError('Failed to compute correction bands from measured FR.')
      })

    return () => {
      clearTimeout(statusTimer)
      cancelled = true
    }
  }, [audioEngine, selected, targetFR])

  const handleApplyToPeq = useCallback(() => {
    if (fittedBands.length === 0) return

    if (localOnlyScope && !hasLocalApply) {
      localBypassSnapshot.current = {
        bands: dspState.bands.map((b) => ({ ...b })),
        eqEnabled: dspState.eqEnabled,
      }
    }

    fittedBands.forEach((band, index) => {
      updateBand(index, {
        enabled: true,
        frequency: band.frequency,
        gainDb: band.gainDb,
        q: band.q,
        type: 'peaking',
      })
    })
    setEqEnabled(true)

    if (localOnlyScope) {
      setHasLocalApply(true)
    }
  }, [dspState.bands, dspState.eqEnabled, fittedBands, hasLocalApply, localOnlyScope, setEqEnabled, updateBand])

  const handleBypassAutoEq = useCallback(() => {
    if (localOnlyScope && hasLocalApply && localBypassSnapshot.current) {
      localBypassSnapshot.current.bands.forEach((band, index) => {
        updateBand(index, {
          enabled: band.enabled,
          frequency: band.frequency,
          gainDb: band.gainDb,
          q: band.q,
          type: band.type,
        })
      })
      setEqEnabled(localBypassSnapshot.current.eqEnabled)
      setHasLocalApply(false)
      return
    }

    setEqEnabled(!dspState.eqEnabled)
  }, [dspState.eqEnabled, hasLocalApply, localOnlyScope, setEqEnabled, updateBand])

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)' }}>

      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
        style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}
      >
        <Headphones size={15} style={{ color: 'var(--ace-accent)' }} />
        <span className="text-sm font-semibold">Gear Match</span>
        <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
          — FR measurement + Auto-EQ correction
        </span>
        <span className="flex-1" />

        {/* Target curve selector */}
        <label className="text-[10px] font-medium mr-1" style={{ color: 'var(--ace-text-muted)' }}>Target:</label>
        <select
          value={targetCurve}
          onChange={e => setTargetCurve(e.target.value as TargetCurve)}
          className="bg-transparent border rounded px-2 py-1 text-xs outline-none"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
        >
          {TARGET_CURVES.map(tc => (
            <option key={tc.value} value={tc.value}>{tc.label}</option>
          ))}
        </select>

        {targetCurve === 'custom' && (
          <button
            onClick={() => setCustomAnchors(DEFAULT_CUSTOM_TARGET)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border hover:bg-white/5 transition-colors"
            style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
            title="Reset custom target curve"
          >
            <RotateCcw size={11} /> Reset Curve
          </button>
        )}

        <div className="w-px h-5 mx-1" style={{ background: 'var(--ace-border)' }} />

        <button
          onClick={() => importInputRef.current?.click()}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
          title="Import AutoEQ CSV, REW TXT, or squig profile"
        >
          <Upload size={12} /> Import FR
        </button>

        <input
          ref={importInputRef}
          type="file"
          accept=".csv,.txt,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0]
            if (f) {
              handleImportFr(f).catch((err) => {
                console.error('FR import failed', err)
                setImportIssues(['Import failed unexpectedly.'])
              })
            }
            e.currentTarget.value = ''
          }}
        />

        {/* FR / Correction toggle */}
        <div className="flex rounded overflow-hidden border" style={{ borderColor: 'var(--ace-border)' }}>
          <button
            onClick={() => setShowCorrection(false)}
            className={cn('px-3 py-1 text-[10px] font-medium transition-colors', !showCorrection ? 'bg-(--ace-accent)/15 text-(--ace-accent)' : 'hover:bg-white/5')}
            style={{ color: !showCorrection ? undefined : 'var(--ace-text-muted)' }}
          >
            FR Curve
          </button>
          <button
            onClick={() => setShowCorrection(true)}
            className={cn('px-3 py-1 text-[10px] font-medium transition-colors', showCorrection ? 'bg-(--ace-accent)/15 text-(--ace-accent)' : 'hover:bg-white/5')}
            style={{ color: showCorrection ? undefined : 'var(--ace-text-muted)' }}
          >
            Correction
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Gear list ── */}
        <div
          className="w-56 shrink-0 flex flex-col border-r overflow-hidden"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg)' }}
        >
          {/* Search */}
          <div className="px-2 py-2 border-b" style={{ borderColor: 'var(--ace-border)' }}>
            <div className="flex items-center gap-1.5 border rounded px-2 py-1" style={{ borderColor: 'var(--ace-border)' }}>
              <Search size={12} style={{ color: 'var(--ace-text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search gear..."
                className="flex-1 bg-transparent text-xs outline-none"
                style={{ color: 'var(--ace-text-primary)' }}
              />
            </div>
          </div>

          {/* Type filter chips */}
          <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b" style={{ borderColor: 'var(--ace-border)' }}>
            <button
              onClick={() => setFilterType('all')}
              className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-colors', filterType === 'all' ? 'bg-(--ace-accent)/15 text-(--ace-accent)' : '')}
              style={{ color: filterType === 'all' ? undefined : 'var(--ace-text-muted)' }}
            >
              All
            </button>
            {GEAR_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setFilterType(t.value)}
                className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-colors', filterType === t.value ? 'bg-(--ace-accent)/15 text-(--ace-accent)' : '')}
                style={{ color: filterType === t.value ? undefined : 'var(--ace-text-muted)' }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.map(g => (
              <GearListItem
                key={g.id}
                gear={g}
                selected={g.id === selectedId}
                onClick={() => setSelectedId(g.id)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="text-xs text-center py-6" style={{ color: 'var(--ace-text-muted)' }}>
                No gear found
              </div>
            )}
          </div>

          {/* Add button */}
          <div className="px-2 py-2 border-t" style={{ borderColor: 'var(--ace-border)' }}>
            <button className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded text-xs border hover:bg-white/5 transition-colors"
              style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}>
              <Plus size={12} /> Add Custom Gear
            </button>
          </div>
        </div>

        {/* ── Right: Chart + Details ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Gear info strip */}
          {selected && (
            <div
              className="flex items-center gap-4 px-4 py-2.5 border-b shrink-0"
              style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
            >
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--ace-text-primary)' }}>
                  {selected.brand} {selected.name}
                </div>
                <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>
                  <span className="capitalize">{selected.type}</span>
                  <span>·</span>
                  <span>Source: {selected.source}</span>
                  <span>·</span>
                  <span>{selected.frFrequencies.length} data points</span>
                </div>
              </div>
              <span className="flex-1" />
              <button
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
                title="Export Auto-EQ preset"
              >
                <FileDown size={12} /> Export EQ
              </button>
              <button
                onClick={handleApplyToPeq}
                disabled={fitStatus !== 'ready' || fittedBands.length === 0}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold transition-all hover:opacity-90 active:scale-95"
                style={{
                  background: fitStatus === 'ready' && fittedBands.length > 0 ? 'var(--ace-accent)' : 'rgba(120,120,120,0.35)',
                  color: '#fff',
                  cursor: fitStatus === 'ready' && fittedBands.length > 0 ? 'pointer' : 'not-allowed',
                }}
                title="Apply correction to Audiophile Ace PEQ"
              >
                <Zap size={12} /> Apply to PEQ
              </button>
              <button
                onClick={handleBypassAutoEq}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
                style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
                title="Bypass current Auto-EQ quickly"
              >
                <X size={12} /> {dspState.eqEnabled ? 'Bypass Auto-EQ' : 'Enable Auto-EQ'}
              </button>
            </div>
          )}

          {/* Chart */}
          <div className="flex-1 overflow-hidden p-3" style={{ background: '#050508' }}>
            {selected ? (
              <div className="h-full flex flex-col gap-2">
                {importIssues.length > 0 && (
                  <div className="text-[10px] px-2 py-1 border rounded" style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-warning)' }}>
                    {importIssues.join(' | ')}
                  </div>
                )}
                <div className="text-[10px] px-2" style={{ color: 'var(--ace-text-muted)' }}>
                  {TARGET_CURVES.find((t) => t.value === targetCurve)?.desc}
                </div>
                <div className="flex items-center gap-2 px-2 text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>
                  <button
                    onClick={() => setLocalOnlyScope((v) => !v)}
                    className="px-2 py-0.5 border rounded hover:bg-white/5 transition-colors"
                    style={{ borderColor: 'var(--ace-border)', color: localOnlyScope ? 'var(--ace-accent)' : 'var(--ace-text-secondary)' }}
                    title="When enabled, Auto-EQ can be bypassed back to previous bands in one click"
                  >
                    Scope: {localOnlyScope ? 'Local-only' : 'Persistent'}
                  </button>
                  <span>
                    {fitStatus === 'running' && 'Computing 60-band correction...'}
                    {fitStatus === 'ready' && `${fittedBands.length} correction bands ready`}
                    {fitStatus === 'error' && fitError}
                  </span>
                </div>
                <div className="flex-1">
                  <FRChart
                    gear={selected}
                    targetCurve={targetCurve}
                    showCorrection={showCorrection}
                    customAnchors={customAnchors}
                    fittedBands={fittedBands}
                    onChangeCustomAnchors={setCustomAnchors}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--ace-text-muted)' }}>
                Select a gear profile from the left panel
              </div>
            )}
          </div>

          {/* Bottom: EQ correction table */}
          {selected && (
            <div
              className="border-t shrink-0 overflow-y-auto"
              style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)', maxHeight: '220px' }}
            >
              <button
                onClick={() => setShowEqTable(!showEqTable)}
                className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold hover:bg-white/5 transition-colors"
                style={{ color: 'var(--ace-text-secondary)' }}
              >
                <Sliders size={12} />
                Auto-EQ Correction Bands
                {showEqTable ? <ChevronDown size={12} className="ml-auto" /> : <ChevronRight size={12} className="ml-auto" />}
              </button>
              {showEqTable && (
                <div className="px-4 pb-3">
                  <EqCorrectionTable gear={selected} targetCurve={targetCurve} customAnchors={customAnchors} fittedBands={fittedBands} />
                  <p className="text-[10px] mt-2" style={{ color: 'var(--ace-text-muted)' }}>
                    Generated PEQ bands to match selected target curve. Click Apply to PEQ to load into the Equalizer.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
