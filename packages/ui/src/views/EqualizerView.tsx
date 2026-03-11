'use client'

import { useCallback, useRef, useState, useMemo } from 'react'
import { Power, RotateCcw, Save, ChevronDown, Download, Upload, Layers } from 'lucide-react'
import { useDspStore } from '@/store/dspStore'
import { useAppStore } from '@/store/appStore'
import type { EqBand } from '@ace/types'
import { cn } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const SVG_W  = 800
const SVG_H  = 260
const PAD_L  = 44   // left axis labels
const PAD_R  = 12
const PAD_T  = 16
const PAD_B  = 28   // bottom freq labels
const GW     = SVG_W - PAD_L - PAD_R
const GH     = SVG_H - PAD_T - PAD_B
const MIN_DB = -20
const MAX_DB =  20
const DB_RANGE = MAX_DB - MIN_DB

const FREQ_MIN = 20
const FREQ_MAX = 20000
const LOG_MIN  = Math.log10(FREQ_MIN)
const LOG_MAX  = Math.log10(FREQ_MAX)

function freqToX(f: number): number {
  return PAD_L + GW * (Math.log10(f) - LOG_MIN) / (LOG_MAX - LOG_MIN)
}
function dbToY(db: number): number {
  return PAD_T + GH * (1 - (db - MIN_DB) / DB_RANGE)
}
function yToDb(y: number): number {
  return MAX_DB - ((y - PAD_T) / GH) * DB_RANGE
}

const GRID_DB    = [-18, -12, -6, 0, 6, 12, 18]
const GRID_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]

function formatFreq(f: number): string {
  return f >= 1000 ? `${f / 1000}k` : String(f)
}

/** Cardinal spline through points */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    const tension = 0.4
    const cp1x = p1.x + (p2.x - p0.x) / 6 * tension * 3
    const cp1y = p1.y + (p2.y - p0.y) / 6 * tension * 3
    const cp2x = p2.x - (p3.x - p1.x) / 6 * tension * 3
    const cp2y = p2.y - (p3.y - p1.y) / 6 * tension * 3
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EqualizerView() {
  const dspStore   = useDspStore()
  const { uiMode } = useAppStore()
  const technical  = uiMode === 'technical'

  const { state, updateBand, resetAllBands, setEqEnabled, setPreampDb, savePreset, loadPreset, deletePreset, allPresets, allProfiles, loadProfile, activeProfileId } = dspStore
  const { eqEnabled, bands, preampDb } = state

  const svgRef  = useRef<SVGSVGElement>(null)
  const dragging = useRef<{ bandId: number; startY: number; startDb: number } | null>(null)
  const [hoveredBand, setHoveredBand] = useState<number | null>(null)
  const [presetName, setPresetName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  const presets  = allPresets()
  const profiles = allProfiles()

  // Compute SVG points for curve
  const curvePoints = useMemo(() =>
    bands
      .filter((b) => b.enabled)
      .map((b) => ({ x: freqToX(b.frequency), y: dbToY(b.gainDb) })),
    [bands],
  )

  const curvePath = useMemo(() => smoothPath(curvePoints), [curvePoints])

  // Drag handlers
  const handleBandMouseDown = useCallback(
    (e: React.MouseEvent<SVGCircleElement>, bandId: number, currentDb: number) => {
      e.preventDefault()
      e.stopPropagation()
      dragging.current = { bandId, startY: e.clientY, startDb: currentDb }

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return
        const { bandId: id, startY, startDb } = dragging.current
        const svgEl = svgRef.current
        if (!svgEl) return
        const rect = svgEl.getBoundingClientRect()
        const scaleY = SVG_H / rect.height
        const deltaY = (ev.clientY - startY) * scaleY
        const deltaDb = -(deltaY / GH) * DB_RANGE
        const newDb = Math.max(MIN_DB, Math.min(MAX_DB, startDb + deltaDb))
        updateBand(id, { gainDb: Math.round(newDb * 10) / 10 })
      }

      const onUp = () => {
        dragging.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [updateBand],
  )

  const handleSavePreset = useCallback(() => {
    if (!presetName.trim()) return
    savePreset(presetName.trim())
    setPresetName('')
    setShowSaveInput(false)
  }, [presetName, savePreset])

  const accent    = technical ? 'var(--ace-accent)' : 'var(--ace-accent)'
  const gridColor = 'rgba(255,255,255,0.06)'
  const zeroColor = 'rgba(255,255,255,0.18)'

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)' }}
    >
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
      >
        {/* Power toggle */}
        <button
          onClick={() => setEqEnabled(!eqEnabled)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
            eqEnabled ? 'shadow-lg' : 'opacity-60',
          )}
          style={{
            background: eqEnabled ? 'var(--ace-accent)' : 'var(--ace-surface)',
            color: eqEnabled ? '#fff' : 'var(--ace-text-secondary)',
            boxShadow: eqEnabled ? '0 0 14px var(--ace-accent-glow)' : 'none',
          }}
        >
          <Power size={14} />
          EQ {eqEnabled ? 'On' : 'Off'}
        </button>

        {/* Preset selector (A3.3.5 — full catalog) */}
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>Preset</span>
          <div className="relative">
            <select
              className="appearance-none pl-3 pr-8 py-1.5 rounded-lg text-xs cursor-pointer focus:outline-none"
              style={{
                background: 'var(--ace-surface)',
                color: 'var(--ace-text-primary)',
                border: '1px solid var(--ace-border)',
                fontFamily: technical ? 'var(--ace-font-mono)' : undefined,
              }}
              value={state.eqPresetId ?? ''}
              onChange={(e) => {
                const preset = presets.find((p) => p.id === e.target.value)
                if (preset) loadPreset(preset)
              }}
            >
              <option value="" disabled>— Select —</option>
              <optgroup label="System Presets">
                {presets.filter((p) => p.isSystem).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              {presets.some((p) => !p.isSystem) && (
                <optgroup label="User Presets">
                  {presets.filter((p) => !p.isSystem).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--ace-text-muted)' }} />
          </div>
          {/* Delete user preset */}
          {state.eqPresetId && !presets.find((p) => p.id === state.eqPresetId)?.isSystem && (
            <button
              onClick={() => { if (state.eqPresetId) deletePreset(state.eqPresetId) }}
              className="text-xs px-1.5 py-0.5 rounded hover:bg-red-500/20 transition-colors"
              style={{ color: 'var(--ace-error)' }}
              title="Delete preset"
            >✕</button>
          )}
        </div>

        {/* Preamp */}
        <div className="flex items-center gap-2 ml-3">
          <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>Pre-amp</span>
          <input
            type="range" min={-20} max={20} step={0.5}
            value={preampDb}
            onChange={(e) => setPreampDb(Number(e.target.value))}
            className="w-24 cursor-pointer" style={{ accentColor: accent }}
          />
          <span className="text-xs tabular-nums w-10" style={{ color: 'var(--ace-accent)', fontFamily: 'var(--ace-font-mono)' }}>
            {preampDb > 0 ? '+' : ''}{preampDb.toFixed(1)} dB
          </span>
        </div>

        <div className="flex-1" />

        {/* Reset */}
        <button
          onClick={() => resetAllBands()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/10"
          style={{ color: 'var(--ace-text-secondary)' }}
        >
          <RotateCcw size={13} />
          Reset
        </button>

        {/* Save preset */}
        {showSaveInput ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setShowSaveInput(false) }}
              placeholder="Preset name…"
              className="px-2 py-1 rounded text-xs focus:outline-none"
              style={{ background: 'var(--ace-surface)', color: 'var(--ace-text-primary)', border: '1px solid var(--ace-border)', width: 130 }}
            />
            <button onClick={handleSavePreset} className="px-3 py-1 rounded text-xs" style={{ background: 'var(--ace-accent)', color: '#fff' }}>Save</button>
            <button onClick={() => setShowSaveInput(false)} className="px-2 py-1 rounded text-xs hover:bg-white/10" style={{ color: 'var(--ace-text-muted)' }}>✕</button>
          </div>
        ) : (
          <button
            onClick={() => setShowSaveInput(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/10"
            style={{ color: 'var(--ace-text-secondary)' }}
          >
            <Save size={13} />
            Save
          </button>
        )}

        {/* Import/Export (A3.3.5) */}
        <button
          onClick={() => {
            const json = dspStore.exportPresetJson(state.eqPresetId ?? 'flat')
            if (json) {
              navigator.clipboard.writeText(json)
              console.log('[EQ] Preset exported to clipboard')
            }
          }}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/10"
          style={{ color: 'var(--ace-text-secondary)' }}
          title="Export current preset to clipboard"
        >
          <Download size={12} />
        </button>

        <button
          onClick={() => setShowImport(!showImport)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/10"
          style={{ color: showImport ? 'var(--ace-accent)' : 'var(--ace-text-secondary)' }}
          title="Import preset from JSON"
        >
          <Upload size={12} />
        </button>
      </div>

      {/* Import panel */}
      {showImport && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}>
          <input
            autoFocus
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste preset JSON…"
            className="flex-1 px-2 py-1 rounded text-xs focus:outline-none"
            style={{ background: 'var(--ace-surface)', color: 'var(--ace-text-primary)', border: '1px solid var(--ace-border)' }}
          />
          <button
            onClick={() => {
              const preset = dspStore.importPresetJson(importText)
              if (preset) { loadPreset(preset); setShowImport(false); setImportText('') }
            }}
            className="px-3 py-1 rounded text-xs"
            style={{ background: 'var(--ace-accent)', color: '#fff' }}
          >Import</button>
          <button onClick={() => { setShowImport(false); setImportText('') }}
            className="px-2 py-1 rounded text-xs hover:bg-white/10"
            style={{ color: 'var(--ace-text-muted)' }}>✕</button>
        </div>
      )}

      {/* ── DSP Profile Quick-Toggle (A3.3.6) ───────────── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg)' }}>
        <Layers size={13} style={{ color: 'var(--ace-text-muted)' }} />
        <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>Profile</span>
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => loadProfile(p.id)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-all',
              activeProfileId === p.id ? 'shadow-md' : 'opacity-60 hover:opacity-100',
            )}
            style={{
              background: activeProfileId === p.id ? 'var(--ace-accent)' : 'var(--ace-surface)',
              color: activeProfileId === p.id ? '#fff' : 'var(--ace-text-secondary)',
              border: `1px solid ${activeProfileId === p.id ? 'var(--ace-accent)' : 'var(--ace-border)'}`,
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* ── EQ Graph ─────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 px-4 py-4">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-full"
          style={{ userSelect: 'none', opacity: eqEnabled ? 1 : 0.4, transition: 'opacity 0.2s' }}
        >
          {/* Grid lines — dB */}
          {GRID_DB.map((db) => (
            <g key={db}>
              <line
                x1={PAD_L} y1={dbToY(db)} x2={SVG_W - PAD_R} y2={dbToY(db)}
                stroke={db === 0 ? zeroColor : gridColor}
                strokeWidth={db === 0 ? 1.5 : 1}
                strokeDasharray={db === 0 ? undefined : '4 6'}
              />
              <text x={PAD_L - 6} y={dbToY(db) + 4}
                textAnchor="end" fontSize={9}
                fill={db === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.18)'}>
                {db > 0 ? `+${db}` : db}
              </text>
            </g>
          ))}

          {/* Grid lines — frequency */}
          {GRID_FREQS.map((f) => (
            <g key={f}>
              <line
                x1={freqToX(f)} y1={PAD_T} x2={freqToX(f)} y2={SVG_H - PAD_B}
                stroke={gridColor} strokeWidth={1}
              />
              <text x={freqToX(f)} y={SVG_H - PAD_B + 14}
                textAnchor="middle" fontSize={9}
                fill="rgba(255,255,255,0.22)">
                {formatFreq(f)}
              </text>
            </g>
          ))}

          {/* Clip region for graph area */}
          <defs>
            <clipPath id="eq-clip">
              <rect x={PAD_L} y={PAD_T} width={GW} height={GH} />
            </clipPath>
            <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.25" />
              <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Curve fill */}
          {curvePath && (
            <path
              d={`${curvePath} L ${(SVG_W - PAD_R).toFixed(1)} ${dbToY(0).toFixed(1)} L ${PAD_L} ${dbToY(0).toFixed(1)} Z`}
              fill="url(#curve-fill)"
              clipPath="url(#eq-clip)"
            />
          )}

          {/* Curve line */}
          {curvePath && (
            <path
              d={curvePath}
              fill="none"
              stroke={accent}
              strokeWidth={1.8}
              strokeLinejoin="round"
              clipPath="url(#eq-clip)"
            />
          )}

          {/* Band dots */}
          {bands.map((band) => {
            const x = freqToX(band.frequency)
            const y = dbToY(band.gainDb)
            const isHovered = hoveredBand === band.id
            const isDragged = dragging.current?.bandId === band.id

            return (
              <g key={band.id}>
                {/* Hover tooltip */}
                {(isHovered || isDragged) && (
                  <g>
                    <rect
                      x={x - 28} y={y - 28} width={56} height={18}
                      rx={3} fill="var(--ace-bg-overlay)"
                      stroke="var(--ace-border)" strokeWidth={0.5}
                    />
                    <text x={x} y={y - 15} textAnchor="middle" fontSize={9} fill="var(--ace-text-primary)">
                      {band.gainDb > 0 ? '+' : ''}{band.gainDb.toFixed(1)} dB
                    </text>
                  </g>
                )}

                {/* Dot */}
                <circle
                  cx={x} cy={y}
                  r={isHovered || isDragged ? 6 : 4.5}
                  fill={band.gainDb === 0 ? 'var(--ace-bg-elevated)' : accent}
                  stroke={accent}
                  strokeWidth={1.5}
                  style={{ cursor: 'ns-resize', transition: 'r 0.1s' }}
                  onMouseEnter={() => setHoveredBand(band.id)}
                  onMouseLeave={() => setHoveredBand(null)}
                  onMouseDown={(e) => handleBandMouseDown(e, band.id, band.gainDb)}
                  clipPath="url(#eq-clip)"
                />
              </g>
            )
          })}
        </svg>
      </div>

      {/* ── Hovered band info strip ──────────────────────────── */}
      <div
        className="shrink-0 px-4 py-2 border-t text-xs"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)', fontFamily: 'var(--ace-font-mono)', color: 'var(--ace-text-muted)', minHeight: 28 }}
      >
        {hoveredBand != null ? (() => {
          const b = bands.find((x) => x.id === hoveredBand)
          if (!b) return null
          const f = b.frequency >= 1000 ? `${(b.frequency / 1000).toFixed(b.frequency % 1000 === 0 ? 0 : 1)} kHz` : `${b.frequency} Hz`
          return (
            <span style={{ color: 'var(--ace-text-primary)' }}>
              Band {hoveredBand + 1} · <span style={{ color: accent }}>{f}</span>
              &nbsp;·&nbsp;{b.gainDb > 0 ? '+' : ''}{b.gainDb.toFixed(1)} dB
              &nbsp;·&nbsp;Q {b.q.toFixed(2)}
            </span>
          )
        })() : (
          <span>Hover or drag a band dot to adjust gain · Scroll to zoom · 60 bands total</span>
        )}
      </div>
    </div>
  )
}
