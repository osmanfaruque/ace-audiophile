'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Search, Plus, Headphones, Ear, Speaker, Bluetooth, Trash2,
  Download, Upload, ChevronDown, ChevronRight, Sliders, BarChart3,
  Check, X, Zap, FileDown, RotateCcw, Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GearProfile, TargetCurve } from '@ace/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const GEAR_TYPES = [
  { value: 'headphone' as const, label: 'Over-ear', icon: Headphones },
  { value: 'iem' as const, label: 'IEM', icon: Ear },
  { value: 'tws' as const, label: 'TWS', icon: Bluetooth },
  { value: 'speaker' as const, label: 'Speaker', icon: Speaker },
] as const

const TARGET_CURVES: { value: TargetCurve; label: string; desc: string }[] = [
  { value: 'harman2019', label: 'Harman 2019 (Over-ear)', desc: 'Industry-standard preference target for over-ear headphones' },
  { value: 'harmanIE2019', label: 'Harman IE 2019', desc: 'Preference target for in-ear monitors' },
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

function generateTargetFR(target: TargetCurve): number[] {
  return FR_FREQUENCIES.map((f) => {
    const x = f / 20000
    switch (target) {
      case 'harman2019':
        return 80 + 6 * Math.exp(-((x - 0.005) ** 2) / 0.0001) + 8 * Math.exp(-((x - 0.15) ** 2) / 0.003) - 4 * x
      case 'harmanIE2019':
        return 78 + 8 * Math.exp(-((x - 0.005) ** 2) / 0.00015) + 12 * Math.exp(-((x - 0.2) ** 2) / 0.004) - 5 * x
      case 'diffuseField':
        return 80 + 10 * Math.exp(-((x - 0.15) ** 2) / 0.005) - 2 * x
      case 'freeField':
        return 80 - 1.5 * x
      default:
        return 80
    }
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

function FRChart({ gear, targetCurve, showCorrection }: {
  gear: GearProfile
  targetCurve: TargetCurve
  showCorrection: boolean
}) {
  const W = 780, H = 340
  const PAD = { top: 20, right: 30, bottom: 40, left: 50 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const targetFR = useMemo(() => generateTargetFR(targetCurve), [targetCurve])

  // Correction = target - measured
  const correction = useMemo(() =>
    gear.frSpl.map((spl, i) => targetFR[i] - spl),
    [gear.frSpl, targetFR],
  )

  // Log-scale X mapping
  const logMin = Math.log10(20)
  const logMax = Math.log10(20000)
  const xOf = (freq: number) => PAD.left + ((Math.log10(freq) - logMin) / (logMax - logMin)) * plotW

  // Y mapping — SPL range
  const splMin = 50, splMax = 100
  const yOfSpl = (spl: number) => PAD.top + (1 - (spl - splMin) / (splMax - splMin)) * plotH

  // Correction Y — ±20 dB
  const corrMin = -20, corrMax = 20
  const yOfCorr = (db: number) => PAD.top + (1 - (db - corrMin) / (corrMax - corrMin)) * plotH

  const pathOfData = (yMapper: (v: number) => number, data: number[]) =>
    data.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(FR_FREQUENCIES[i]).toFixed(1)},${yMapper(v).toFixed(1)}`).join(' ')

  const measuredPath = pathOfData(yOfSpl, gear.frSpl)
  const targetPath = pathOfData(yOfSpl, targetFR)
  const corrPath = pathOfData(yOfCorr, correction)

  // Grid frequencies
  const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
  const gridDb = showCorrection
    ? [-20, -15, -10, -5, 0, 5, 10, 15, 20]
    : [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]

  const fmtFreq = (f: number) => f >= 1000 ? `${f / 1000}k` : `${f}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ fontFamily: 'var(--ace-font-mono)' }}>
      {/* Background */}
      <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="#08080c" rx="2" />

      {/* Vertical grid (frequency) */}
      {gridFreqs.map(f => (
        <g key={f}>
          <line x1={xOf(f)} y1={PAD.top} x2={xOf(f)} y2={PAD.top + plotH} stroke="rgba(255,255,255,0.06)" />
          <text x={xOf(f)} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">
            {fmtFreq(f)}
          </text>
        </g>
      ))}

      {/* Horizontal grid (dB) */}
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

      {/* Axis labels */}
      <text x={W / 2} y={H - 0} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9">
        Frequency (Hz)
      </text>
      <text x={12} y={H / 2} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9"
        transform={`rotate(-90, 12, ${H / 2})`}>
        {showCorrection ? 'Correction (dB)' : 'SPL (dB)'}
      </text>

      {showCorrection ? (
        <>
          {/* Zero line */}
          <line x1={PAD.left} y1={yOfCorr(0)} x2={PAD.left + plotW} y2={yOfCorr(0)}
            stroke="rgba(255,255,255,0.12)" strokeDasharray="4 3" />
          {/* Correction curve */}
          <path d={corrPath} fill="none" stroke="var(--ace-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* Fill above/below zero */}
          <path d={corrPath + `L${xOf(20000)},${yOfCorr(0)} L${xOf(20)},${yOfCorr(0)} Z`}
            fill="var(--ace-accent)" opacity="0.08" />
        </>
      ) : (
        <>
          {/* Target curve */}
          <path d={targetPath} fill="none" stroke="rgba(76,175,130,0.6)" strokeWidth="1.5"
            strokeDasharray="6 3" strokeLinecap="round" />
          {/* Measured FR */}
          <path d={measuredPath} fill="none" stroke="var(--ace-accent)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" />
          {/* Fill under measured */}
          <path d={measuredPath + `L${xOf(20000)},${PAD.top + plotH} L${xOf(20)},${PAD.top + plotH} Z`}
            fill="var(--ace-accent)" opacity="0.06" />
        </>
      )}

      {/* Legend */}
      {!showCorrection && (
        <g transform={`translate(${PAD.left + 12}, ${PAD.top + 12})`}>
          <line x1="0" y1="0" x2="18" y2="0" stroke="var(--ace-accent)" strokeWidth="2.5" />
          <text x="24" y="3" fill="var(--ace-text-secondary)" fontSize="10">Measured</text>
          <line x1="0" y1="16" x2="18" y2="16" stroke="rgba(76,175,130,0.6)" strokeWidth="1.5" strokeDasharray="6 3" />
          <text x="24" y="19" fill="var(--ace-text-secondary)" fontSize="10">Target</text>
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
          ? 'border-l-[var(--ace-accent)] bg-[var(--ace-accent)]/8'
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

function EqCorrectionTable({ gear, targetCurve }: { gear: GearProfile; targetCurve: TargetCurve }) {
  const targetFR = useMemo(() => generateTargetFR(targetCurve), [targetCurve])

  // Pick ~10 bands for PEQ correction display
  const bands = useMemo(() => {
    const correction = gear.frSpl.map((spl, i) => ({ freq: FR_FREQUENCIES[i], gain: Math.round((targetFR[i] - spl) * 10) / 10 }))
    // Filter to significant deviations and downsample
    const sig = correction.filter(b => Math.abs(b.gain) >= 1.5)
    // Pick up to 10 evenly spaced
    if (sig.length <= 10) return sig
    const step = Math.ceil(sig.length / 10)
    return sig.filter((_, i) => i % step === 0).slice(0, 10)
  }, [gear.frSpl, targetFR])

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
            {(1.0 + Math.abs(b.gain) * 0.15).toFixed(2)}
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
  const [gearList, setGearList] = useState<GearProfile[]>(SAMPLE_GEAR)
  const [selectedId, setSelectedId] = useState<string>(SAMPLE_GEAR[0].id)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<GearProfile['type'] | 'all'>('all')
  const [targetCurve, setTargetCurve] = useState<TargetCurve>('harman2019')
  const [showCorrection, setShowCorrection] = useState(false)
  const [showEqTable, setShowEqTable] = useState(true)

  const selected = gearList.find(g => g.id === selectedId) ?? gearList[0]

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

  const handleDelete = useCallback((id: string) => {
    setGearList(prev => prev.filter(g => g.id !== id))
    if (selectedId === id) setSelectedId(gearList[0]?.id ?? '')
  }, [selectedId, gearList])

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

        <div className="w-px h-5 mx-1" style={{ background: 'var(--ace-border)' }} />

        {/* FR / Correction toggle */}
        <div className="flex rounded overflow-hidden border" style={{ borderColor: 'var(--ace-border)' }}>
          <button
            onClick={() => setShowCorrection(false)}
            className={cn('px-3 py-1 text-[10px] font-medium transition-colors', !showCorrection ? 'bg-[var(--ace-accent)]/15 text-[var(--ace-accent)]' : 'hover:bg-white/5')}
            style={{ color: !showCorrection ? undefined : 'var(--ace-text-muted)' }}
          >
            FR Curve
          </button>
          <button
            onClick={() => setShowCorrection(true)}
            className={cn('px-3 py-1 text-[10px] font-medium transition-colors', showCorrection ? 'bg-[var(--ace-accent)]/15 text-[var(--ace-accent)]' : 'hover:bg-white/5')}
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
              className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-colors', filterType === 'all' ? 'bg-[var(--ace-accent)]/15 text-[var(--ace-accent)]' : '')}
              style={{ color: filterType === 'all' ? undefined : 'var(--ace-text-muted)' }}
            >
              All
            </button>
            {GEAR_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setFilterType(t.value)}
                className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-colors', filterType === t.value ? 'bg-[var(--ace-accent)]/15 text-[var(--ace-accent)]' : '')}
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
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold transition-all hover:opacity-90 active:scale-95"
                style={{ background: 'var(--ace-accent)', color: '#fff' }}
                title="Apply correction to Audiophile Ace PEQ"
              >
                <Zap size={12} /> Apply to PEQ
              </button>
            </div>
          )}

          {/* Chart */}
          <div className="flex-1 overflow-hidden p-3" style={{ background: '#050508' }}>
            {selected ? (
              <FRChart gear={selected} targetCurve={targetCurve} showCorrection={showCorrection} />
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
                  <EqCorrectionTable gear={selected} targetCurve={targetCurve} />
                  <p className="text-[10px] mt-2" style={{ color: 'var(--ace-text-muted)' }}>
                    Generated PEQ bands to match selected target curve. Click "Apply to PEQ" to load into the Equalizer.
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
