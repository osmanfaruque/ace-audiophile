'use client'

import { useEffect, useRef } from 'react'
import { getAudioEngine } from '@/lib/audioEngine'
import type { FftFrame } from '@ace/types'
import { cn } from '@/lib/utils'

interface SpectrumBarsProps {
  /** Canvas height in px */
  height?: number
  /** Number of display bars */
  barCount?: number
  className?: string
  /**
   * 'l' | 'r' | 'both' — which FFT channel to display.
   * When 'both', average L+R from consecutive FftFrame events.
   */
  channel?: 'l' | 'r' | 'both'
}

export function SpectrumBars({
  height = 80,
  barCount = 64,
  className,
  channel = 'both',
}: SpectrumBarsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number | null>(null)
  const bars = useRef<Float32Array>(new Float32Array(barCount))
  const lBins = useRef<Float32Array | null>(null)
  const rBins = useRef<Float32Array | null>(null)

  useEffect(() => {
    let unsubL: (() => void) | undefined
    let unsubR: (() => void) | undefined

    const engine = getAudioEngine()

    // Collect FFT frames keyed by channelIndex
    engine.onFftFrame((frame: FftFrame) => {
      if (frame.channelIndex === 0) lBins.current = frame.bins
      if (frame.channelIndex === 1) rBins.current = frame.bins
    })
      .then((unsub) => {
        unsubL = unsub
      })
      .catch(() => {})

    const FREQ_MIN = 20
    const FREQ_MAX = 20000
    const LOG_MIN = Math.log10(FREQ_MIN)
    const LOG_MAX = Math.log10(FREQ_MAX)
    const SAMPLE_RATE = 44100

    function binForBar(barIdx: number, totalBins: number): number {
      const logFreq = LOG_MIN + ((LOG_MAX - LOG_MIN) * barIdx) / (barCount - 1)
      const freq = Math.pow(10, logFreq)
      return Math.max(0, Math.min(totalBins - 1, Math.round((freq / (SAMPLE_RATE / 2)) * totalBins)))
    }

    function drawFrame() {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const W = canvas.width
      const H = canvas.height

      // Pick source bins
      const srcBins =
        channel === 'l'
          ? lBins.current
          : channel === 'r'
            ? rBins.current
            : lBins.current // average handled below

      const rSrc = channel === 'both' ? rBins.current : null
      const totalBins = srcBins?.length ?? 1024

      const b = bars.current
      for (let i = 0; i < barCount; i++) {
        const binIdx = binForBar(i, totalBins)
        let target = 0
        if (srcBins && srcBins.length > binIdx) {
          const dbVal = srcBins[binIdx] // expect dB value −120..0
          target = Math.max(0, Math.min(1, (dbVal + 90) / 90))
        }
        if (rSrc && rSrc.length > binIdx) {
          const dbR = rSrc[binIdx]
          const tR = Math.max(0, Math.min(1, (dbR + 90) / 90))
          target = (target + tR) / 2
        }
        // Smooth: fast attack, slow decay
        b[i] = target > b[i] ? b[i] * 0.5 + target * 0.5 : b[i] * 0.88
      }

      ctx.clearRect(0, 0, W, H)
      const barW = W / barCount
      const gap = Math.max(1, Math.floor(barW * 0.2))

      for (let i = 0; i < barCount; i++) {
        const barH = Math.max(2, b[i] * H)
        const x = i * barW
        const y = H - barH

        const ratio = b[i]
        let r: number, g: number, blue: number
        if (ratio < 0.6) {
          r = 76
          g = 175
          blue = 130
        } else if (ratio < 0.85) {
          const t = (ratio - 0.6) / 0.25
          r = Math.round(76 + t * (245 - 76))
          g = Math.round(175 + t * (166 - 175))
          blue = Math.round(130 + t * (35 - 130))
        } else {
          r = 229
          g = 83
          blue = 75
        }

        ctx.fillStyle = `rgb(${r},${g},${blue})`
        ctx.fillRect(x + gap / 2, y, barW - gap, barH)

        // Peak dot
        if (b[i] > 0.05) {
          ctx.fillStyle = 'rgba(255,255,255,0.5)'
          ctx.fillRect(x + gap / 2, y, barW - gap, 1)
        }
      }

      animRef.current = requestAnimationFrame(drawFrame)
    }

    drawFrame()

    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current)
      unsubL?.()
      unsubR?.()
    }
  }, [barCount, channel])

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={height}
      className={cn('block', className)}
      style={{ width: '100%', height }}
    />
  )
}
