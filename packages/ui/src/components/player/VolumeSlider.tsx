'use client'

import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useRef, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface VolumeSliderProps {
  volume: number // 0 – 1
  onChange: (v: number) => void
  className?: string
}

export function VolumeSlider({ volume, onChange, className }: VolumeSliderProps) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleToggle = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setOpen((o) => !o)
  }, [])

  const handleMouseLeave = useCallback(() => {
    timerRef.current = setTimeout(() => setOpen(false), 800)
  }, [])

  const handleMouseEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const Icon = volume === 0 ? VolumeX : volume < 0.35 ? Volume : volume < 0.7 ? Volume1 : Volume2

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
    >
      <button
        onClick={handleToggle}
        className="p-1.5 rounded transition-colors hover:bg-white/10 focus-visible:outline-none"
        style={{ color: 'var(--ace-text-secondary)' }}
        aria-label="Volume"
      >
        <Icon size={16} />
      </button>

      {open && (
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            className="w-20 cursor-pointer"
            style={{ accentColor: 'var(--ace-accent)' }}
            aria-label="Volume level"
          />
          <span
            className="text-xs tabular-nums w-7 text-right"
            style={{ color: 'var(--ace-text-muted)' }}
          >
            {Math.round(volume * 100)}
          </span>
        </div>
      )}
    </div>
  )
}
