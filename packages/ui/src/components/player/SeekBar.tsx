'use client'

import { useRef, useCallback, useState } from 'react'
import { cn, formatDuration } from '@/lib/utils'

interface SeekBarProps {
  positionMs: number
  durationMs: number
  onSeek: (positionMs: number) => void
  className?: string
  /** Thicker bar, techie mode */
  thick?: boolean
}

export function SeekBar({ positionMs, durationMs, onSeek, className, thick }: SeekBarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const [hovering, setHovering] = useState(false)
  const [hoverFrac, setHoverFrac] = useState(0)
  const dragging = useRef(false)

  const fracFromEvent = useCallback((e: React.MouseEvent) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      onSeek(fracFromEvent(e) * durationMs)
    },
    [durationMs, onSeek, fracFromEvent],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const frac = fracFromEvent(e)
      setHoverFrac(frac)
      if (dragging.current) onSeek(frac * durationMs)
    },
    [durationMs, onSeek, fracFromEvent],
  )

  const handleMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  const progress = durationMs > 0 ? positionMs / durationMs : 0

  return (
    <div className={cn('relative select-none', className)}>
      <div
        ref={barRef}
        role="slider"
        aria-valuenow={positionMs}
        aria-valuemin={0}
        aria-valuemax={durationMs}
        className={cn('relative w-full cursor-pointer group', thick ? 'h-1.5' : 'h-0.5')}
        style={{ background: 'rgba(255,255,255,0.12)' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => {
          setHovering(false)
          dragging.current = false
        }}
      >
        {/* Filled track */}
        <div
          className="absolute inset-y-0 left-0 transition-none"
          style={{ width: `${progress * 100}%`, background: 'var(--ace-accent)' }}
        />

        {/* Thumb — only visible on hover */}
        <div
          className={cn(
            'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full shadow-lg z-10',
            'transition-opacity duration-150',
            hovering || dragging.current ? 'opacity-100' : 'opacity-0',
          )}
          style={{ left: `${progress * 100}%`, background: 'var(--ace-accent)' }}
        />
      </div>

      {/* Hover time tooltip */}
      {hovering && durationMs > 0 && (
        <div
          className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded text-xs pointer-events-none whitespace-nowrap"
          style={{
            left: `${hoverFrac * 100}%`,
            background: 'var(--ace-bg-overlay)',
            color: 'var(--ace-text-primary)',
            border: '1px solid var(--ace-border)',
          }}
        >
          {formatDuration(hoverFrac * durationMs)}
        </div>
      )}
    </div>
  )
}
