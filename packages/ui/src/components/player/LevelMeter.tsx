'use client'

import { useDspStore } from '@/store/dspStore'

interface LevelMeterProps {
  height?: number
  className?: string
  compact?: boolean
}

/** Clamp dB value to a 0–1 fraction for display (-60dB→0, 0dB→1) */
function dbToFrac(db: number, floor = -60): number {
  return Math.max(0, Math.min(1, (db - floor) / -floor))
}

function formatDb(db: number): string {
  if (db <= -60) return '-∞'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`
}

export function LevelMeter({ height = 48, className, compact }: LevelMeterProps) {
  const meter = useDspStore((s) => s.levelMeter)

  if (!meter || !meter.channels.length) {
    return (
      <div className={className} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="text-xs" style={{ color: 'var(--ace-text-muted)', fontFamily: 'var(--ace-font-mono)' }}>
          — dB
        </span>
      </div>
    )
  }

  const left = meter.channels[0]
  const right = meter.channels[1] ?? left

  const barHeight = compact ? 4 : 6

  return (
    <div className={className} style={{ height, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: compact ? 2 : 4, padding: '0 4px' }}>
      {/* L/R bars */}
      {[{ ch: left, label: 'L' }, { ch: right, label: 'R' }].map(({ ch, label }) => {
        const rmsFrac = dbToFrac(ch.rmsDb)
        const peakFrac = dbToFrac(ch.peakDb)
        const clipping = ch.peakDb >= -0.1

        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {!compact && (
              <span className="text-[9px] w-3 text-right" style={{ color: 'var(--ace-text-muted)', fontFamily: 'var(--ace-font-mono)' }}>
                {label}
              </span>
            )}
            <div style={{ flex: 1, height: barHeight, background: 'rgba(255,255,255,0.06)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
              {/* RMS fill */}
              <div style={{
                position: 'absolute', inset: 0, right: `${(1 - rmsFrac) * 100}%`,
                background: rmsFrac > 0.85
                  ? 'linear-gradient(90deg, #22c55e 0%, #facc15 70%, #ef4444 100%)'
                  : rmsFrac > 0.6
                    ? 'linear-gradient(90deg, #22c55e 0%, #facc15 100%)'
                    : '#22c55e',
                borderRadius: 2,
                transition: 'right 30ms linear',
              }} />
              {/* Peak indicator */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0, width: 2,
                left: `${peakFrac * 100}%`,
                background: clipping ? '#ef4444' : 'rgba(255,255,255,0.5)',
                transition: 'left 30ms linear',
              }} />
            </div>
            {!compact && (
              <span className="text-[9px] w-12 text-right tabular-nums" style={{
                color: clipping ? 'var(--ace-error)' : 'var(--ace-text-muted)',
                fontFamily: 'var(--ace-font-mono)',
              }}>
                {formatDb(ch.peakDb)}
              </span>
            )}
          </div>
        )
      })}

      {/* LUFS display */}
      {!compact && left.lufsIntegrated !== undefined && (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 0 0 16px' }}>
          <span className="text-[9px]" style={{ color: 'var(--ace-text-muted)', fontFamily: 'var(--ace-font-mono)' }}>
            LUFS {left.lufsIntegrated > -100 ? left.lufsIntegrated.toFixed(1) : '—'}
          </span>
          <span className="text-[9px]" style={{ color: 'var(--ace-text-muted)', fontFamily: 'var(--ace-font-mono)' }}>
            DR —
          </span>
        </div>
      )}
    </div>
  )
}
