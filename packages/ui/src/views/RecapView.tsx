'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Clock, Music2, Mic2, Disc3, Tag, BarChart3, TrendingUp,
  Calendar, Headphones, Award, Flame, ChevronRight,
} from 'lucide-react'
import { cn, formatDuration } from '@/lib/utils'
import type { ListeningStats, QualityBucket, AudioTrack, Album } from '@ace/types'
import { getAudioEngine } from '@/lib/audioEngine'

// ── Sample data ───────────────────────────────────────────────────────────────

function generateSampleStats(): ListeningStats {
  const hourly = Array.from({ length: 24 }, (_, h) => {
    if (h >= 0 && h < 6) return Math.round(Math.random() * 5)
    if (h >= 6 && h < 9) return Math.round(15 + Math.random() * 20)
    if (h >= 9 && h < 17) return Math.round(10 + Math.random() * 15)
    if (h >= 17 && h < 22) return Math.round(30 + Math.random() * 35)
    return Math.round(10 + Math.random() * 15)
  })

  const daily: { date: string; totalMs: number }[] = []
  const now = new Date()
  for (let d = 364; d >= 0; d--) {
    const dt = new Date(now.getTime() - d * 86400000)
    const dateStr = dt.toISOString().slice(0, 10)
    const dayOfWeek = dt.getDay()
    const base = dayOfWeek === 0 || dayOfWeek === 6 ? 3600000 : 1800000
    daily.push({ date: dateStr, totalMs: Math.round(base * (0.2 + Math.random() * 1.5)) })
  }

  return {
    totalMs: daily.reduce((s, d) => s + d.totalMs, 0),
    topTracks: [
      { track: { id: '1', title: 'Shine On You Crazy Diamond', artist: 'Pink Floyd' } as unknown as AudioTrack, playCount: 142, totalMs: 142 * 810000 },
      { track: { id: '2', title: 'Echoes', artist: 'Pink Floyd' } as unknown as AudioTrack, playCount: 98, totalMs: 98 * 1380000 },
      { track: { id: '3', title: 'Close to the Edge', artist: 'Yes' } as unknown as AudioTrack, playCount: 87, totalMs: 87 * 1100000 },
      { track: { id: '4', title: 'Lateralus', artist: 'Tool' } as unknown as AudioTrack, playCount: 76, totalMs: 76 * 560000 },
      { track: { id: '5', title: 'Comfortably Numb', artist: 'Pink Floyd' } as unknown as AudioTrack, playCount: 71, totalMs: 71 * 383000 },
    ],
    topArtists: [
      { artist: 'Pink Floyd', playCount: 520, totalMs: 520 * 480000 },
      { artist: 'Tool', playCount: 310, totalMs: 310 * 420000 },
      { artist: 'Yes', playCount: 245, totalMs: 245 * 580000 },
      { artist: 'King Crimson', playCount: 198, totalMs: 198 * 450000 },
      { artist: 'Radiohead', playCount: 176, totalMs: 176 * 290000 },
    ],
    topAlbums: [
      { album: { id: 'a1', title: 'Wish You Were Here', artist: 'Pink Floyd' } as unknown as Album, playCount: 210, totalMs: 210 * 450000 },
      { album: { id: 'a2', title: 'Lateralus', artist: 'Tool' } as unknown as Album, playCount: 180, totalMs: 180 * 420000 },
      { album: { id: 'a3', title: 'Close to the Edge', artist: 'Yes' } as unknown as Album, playCount: 155, totalMs: 155 * 540000 },
      { album: { id: 'a4', title: 'In the Court of the Crimson King', artist: 'King Crimson' } as unknown as Album, playCount: 130, totalMs: 130 * 520000 },
      { album: { id: 'a5', title: 'OK Computer', artist: 'Radiohead' } as unknown as Album, playCount: 120, totalMs: 120 * 320000 },
    ],
    topGenres: [
      { genre: 'Progressive Rock', playCount: 890, totalMs: 890 * 480000 },
      { genre: 'Art Rock', playCount: 420, totalMs: 420 * 390000 },
      { genre: 'Alternative', playCount: 310, totalMs: 310 * 280000 },
      { genre: 'Jazz', playCount: 180, totalMs: 180 * 350000 },
      { genre: 'Classical', playCount: 120, totalMs: 120 * 600000 },
    ],
    qualityBreakdown: [
      { label: '24/96 FLAC', trackCount: 340, totalMs: 340 * 420000 },
      { label: '16/44.1 FLAC', trackCount: 890, totalMs: 890 * 300000 },
      { label: '24/192 FLAC', trackCount: 45, totalMs: 45 * 500000 },
      { label: 'DSD64', trackCount: 12, totalMs: 12 * 480000 },
      { label: 'MP3 320', trackCount: 210, totalMs: 210 * 240000 },
      { label: 'AAC 256', trackCount: 80, totalMs: 80 * 220000 },
    ],
    hourlyHeatmap: hourly,
    dailyHistory: daily,
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtHours(ms: number): string {
  const h = ms / 3600000
  return h >= 1 ? `${h.toFixed(0)}h` : `${Math.round(ms / 60000)}m`
}

function fmtHoursLong(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg border"
      style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <div className="text-lg font-black" style={{ color: 'var(--ace-text-primary)' }}>{value}</div>
        <div className="text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>{label}</div>
        {sub && <div className="text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>{sub}</div>}
      </div>
    </div>
  )
}

// ── Horizontal Bar Row ────────────────────────────────────────────────────────

function RankRow({ rank, title, subtitle, value, maxValue, color }: {
  rank: number
  title: string
  subtitle?: string
  value: number
  maxValue: number
  color: string
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-5 text-right text-[10px] font-bold" style={{ color: 'var(--ace-text-muted)' }}>
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium truncate" style={{ color: 'var(--ace-text-primary)' }}>
            {title}
          </span>
          {subtitle && (
            <span className="text-[10px] truncate" style={{ color: 'var(--ace-text-muted)' }}>
              {subtitle}
            </span>
          )}
        </div>
        <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--ace-border)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      </div>
      <span className="text-[10px] font-mono w-14 text-right shrink-0" style={{ color: 'var(--ace-text-secondary)' }}>
        {fmtHours(value)}
      </span>
    </div>
  )
}

// ── Hourly Heatmap ────────────────────────────────────────────────────────────

function HourlyHeatmap({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  return (
    <div>
      <div className="flex gap-0.75">
        {data.map((v, h) => {
          const intensity = v / max
          return (
            <div key={h} className="flex flex-col items-center gap-1 flex-1">
              <div
                className="w-full rounded-sm transition-all"
                style={{
                  height: '28px',
                  background: intensity > 0
                    ? `rgba(124,106,255,${0.1 + intensity * 0.8})`
                    : 'var(--ace-border)',
                }}
                title={`${h}:00 — ${v} plays`}
              />
              {h % 3 === 0 && (
                <span className="text-[8px]" style={{ color: 'var(--ace-text-muted)' }}>
                  {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Calendar Heatmap (GitHub style) ───────────────────────────────────────────

function CalendarHeatmap({ data }: { data: { date: string; totalMs: number }[] }) {
  const max = Math.max(...data.map(d => d.totalMs), 1)
  // Group by week
  const weeks: { date: string; totalMs: number }[][] = []
  let currentWeek: { date: string; totalMs: number }[] = []

  // Pad start to align to Sunday
  const firstDate = new Date(data[0]?.date ?? new Date())
  const startPad = firstDate.getDay()
  for (let i = 0; i < startPad; i++) currentWeek.push({ date: '', totalMs: 0 })

  for (const d of data) {
    currentWeek.push(d)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  // Month labels
  const months: { label: string; weekIdx: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    for (const d of week) {
      if (!d.date) continue
      const m = new Date(d.date).getMonth()
      if (m !== lastMonth) {
        months.push({ label: new Date(d.date).toLocaleString('en', { month: 'short' }), weekIdx: wi })
        lastMonth = m
      }
      break
    }
  })

  const cellSize = 11
  const gap = 2

  return (
    <div className="overflow-x-auto">
      {/* Month labels */}
      <div className="flex mb-1" style={{ paddingLeft: '20px' }}>
        {months.map((m, i) => (
          <span
            key={i}
            className="text-[9px] absolute"
            style={{
              color: 'var(--ace-text-muted)',
              left: `${20 + m.weekIdx * (cellSize + gap)}px`,
              position: 'relative',
            }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="flex gap-0.5 mt-3">
        {/* Day labels */}
        <div className="flex flex-col gap-0.5 mr-1" style={{ width: '16px' }}>
          {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
            <div key={i} className="text-[8px] leading-none" style={{ height: `${cellSize}px`, color: 'var(--ace-text-muted)', display: 'flex', alignItems: 'center' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Cells */}
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((day, di) => {
              if (!day.date) return <div key={di} style={{ width: cellSize, height: cellSize }} />
              const intensity = day.totalMs / max
              return (
                <div
                  key={di}
                  className="rounded-xs transition-colors"
                  style={{
                    width: cellSize,
                    height: cellSize,
                    background: intensity > 0
                      ? `rgba(124,106,255,${0.1 + intensity * 0.85})`
                      : 'var(--ace-border)',
                  }}
                  title={`${day.date}: ${fmtHoursLong(day.totalMs)}`}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-2 justify-end">
        <span className="text-[9px]" style={{ color: 'var(--ace-text-muted)' }}>Less</span>
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v, i) => (
          <div
            key={i}
            className="rounded-xs"
            style={{
              width: cellSize,
              height: cellSize,
              background: v === 0 ? 'var(--ace-border)' : `rgba(124,106,255,${0.1 + v * 0.85})`,
            }}
          />
        ))}
        <span className="text-[9px]" style={{ color: 'var(--ace-text-muted)' }}>More</span>
      </div>
    </div>
  )
}

// ── Quality Donut ─────────────────────────────────────────────────────────────

function QualityDonut({ buckets }: { buckets: QualityBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.totalMs, 0)
  const colors = ['#7c6aff', '#4caf82', '#4fa3e0', '#f5a623', '#e5534b', '#a855f7']
  const percentages = buckets.map((b) => (total > 0 ? (b.totalMs / total) * 100 : 0))
  const offsets = percentages.map((_, i) => percentages.slice(0, i).reduce((sum, v) => sum + v, 0))

  return (
    <div className="flex items-center gap-6">
      {/* SVG donut */}
      <div className="relative w-32 h-32 shrink-0">
        <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90">
          {buckets.map((b, i) => {
            const pct = percentages[i]
            const offset = offsets[i]
            return (
              <circle
                key={i}
                cx="21" cy="21" r="15.9"
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth="3.8"
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset={`${-offset}`}
              />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-bold" style={{ color: 'var(--ace-text-primary)' }}>
            {buckets.reduce((s, b) => s + b.trackCount, 0)}
          </span>
          <span className="text-[8px]" style={{ color: 'var(--ace-text-muted)' }}>tracks</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-1.5">
        {buckets.map((b, i) => {
          const pct = total > 0 ? ((b.totalMs / total) * 100).toFixed(1) : '0'
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colors[i % colors.length] }} />
              <span className="flex-1" style={{ color: 'var(--ace-text-secondary)' }}>{b.label}</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>{pct}%</span>
              <span className="font-mono text-[10px] w-10 text-right" style={{ color: 'var(--ace-text-muted)' }}>{b.trackCount}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Section Wrapper ───────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--ace-accent)' }}>{icon}</span>
        <span className="text-sm font-bold" style={{ color: 'var(--ace-text-primary)' }}>{title}</span>
      </div>
      <div
        className="rounded-lg border p-4"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
      >
        {children}
      </div>
    </div>
  )
}

// ── Main RecapView ────────────────────────────────────────────────────────────

export function RecapView() {
  const [stats, setStats] = useState<ListeningStats>(() => generateSampleStats())
  const [sessionStats, setSessionStats] = useState<{ skips: number; repeats: number; completed: number; peakHour: number } | null>(null)
  const [tab, setTab] = useState<'overview' | 'tracks' | 'artists' | 'albums' | 'genres'>('overview')

  useEffect(() => {
    const year = new Date().getFullYear()
    getAudioEngine()
      .getRecapStats(year)
      .then((raw) => {
        const data = raw as Partial<ListeningStats> & { sessionStats?: { skips: number; repeats: number; completed: number; peakHour: number } }
        setStats((prev) => ({
          ...prev,
          ...data,
          topTracks: data.topTracks && data.topTracks.length > 0 ? data.topTracks : prev.topTracks,
          topArtists: data.topArtists && data.topArtists.length > 0 ? data.topArtists : prev.topArtists,
          topAlbums: data.topAlbums && data.topAlbums.length > 0 ? data.topAlbums : prev.topAlbums,
          topGenres: data.topGenres && data.topGenres.length > 0 ? data.topGenres : prev.topGenres,
          qualityBreakdown: data.qualityBreakdown && data.qualityBreakdown.length > 0 ? data.qualityBreakdown as QualityBucket[] : prev.qualityBreakdown,
          hourlyHeatmap: data.hourlyHeatmap && data.hourlyHeatmap.length > 0 ? data.hourlyHeatmap : prev.hourlyHeatmap,
          dailyHistory: data.dailyHistory && data.dailyHistory.length > 0 ? data.dailyHistory : prev.dailyHistory,
        }))
        setSessionStats(data.sessionStats ?? null)
      })
      .catch((e) => {
        console.error('[RecapView] Failed to load real recap stats, using sample data:', e)
      })
  }, [])

  const exportShareCard = () => {
    const c = document.createElement('canvas')
    c.width = 1200
    c.height = 630
    const ctx = c.getContext('2d')
    if (!ctx) return

    const g = ctx.createLinearGradient(0, 0, 1200, 630)
    g.addColorStop(0, '#0f172a')
    g.addColorStop(1, '#1e1b4b')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1200, 630)

    ctx.fillStyle = '#9ca3af'
    ctx.font = '28px monospace'
    ctx.fillText('Audiophile Ace - Yearly Recap', 56, 72)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 72px monospace'
    ctx.fillText(`${Math.round(stats.totalMs / 3600000)}h`, 56, 180)
    ctx.font = '28px monospace'
    ctx.fillText('Total listening time', 56, 222)

    const top = stats.topTracks[0]
    if (top) {
      ctx.fillStyle = '#c4b5fd'
      ctx.font = '24px monospace'
      ctx.fillText('Top Track', 56, 320)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 40px monospace'
      ctx.fillText(`${top.track.title} - ${top.track.artist}`, 56, 370)
    }

    if (sessionStats) {
      ctx.fillStyle = '#93c5fd'
      ctx.font = '24px monospace'
      ctx.fillText(`Skips: ${sessionStats.skips}  Completed: ${sessionStats.completed}  Peak Hour: ${sessionStats.peakHour}:00`, 56, 470)
    }

    ctx.fillStyle = '#94a3b8'
    ctx.font = '20px monospace'
    ctx.fillText('Generated by Audiophile Ace', 56, 578)

    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `ace-recap-${new Date().getFullYear()}.png`
    a.click()
  }

  const totalHours = Math.round(stats.totalMs / 3600000)
  const totalDays = (stats.totalMs / 86400000).toFixed(1)
  const totalTracks = stats.topTracks.reduce((s, t) => s + t.playCount, 0)
  const losslessPct = useMemo(() => {
    const total = stats.qualityBreakdown.reduce((s, b) => s + b.totalMs, 0)
    const lossless = stats.qualityBreakdown
      .filter(b => b.label.includes('FLAC') || b.label.includes('DSD') || b.label.includes('WAV'))
      .reduce((s, b) => s + b.totalMs, 0)
    return total > 0 ? Math.round((lossless / total) * 100) : 0
  }, [stats])

  const TABS = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'tracks' as const, label: 'Top Tracks' },
    { id: 'artists' as const, label: 'Top Artists' },
    { id: 'albums' as const, label: 'Top Albums' },
    { id: 'genres' as const, label: 'Genres' },
  ]

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
        style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}
      >
        <Flame size={15} style={{ color: 'var(--ace-accent)' }} />
        <span className="text-sm font-semibold">Audio Recap</span>
        <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>— Your listening stats & insights</span>
        <span className="flex-1" />
        <button
          onClick={exportShareCard}
          className="px-3 py-1 rounded text-xs border hover:bg-white/5 transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
        >
          Export PNG
        </button>
        <span className="text-[10px] font-mono" style={{ color: 'var(--ace-text-muted)' }}>
          Last 365 days
        </span>
      </div>

      {/* ── Tabs ── */}
      <div
        className="flex items-center gap-0 border-b shrink-0"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
      >
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
              tab === t.id
                ? 'border-(--ace-accent)'
                : 'border-transparent hover:border-(--ace-border-strong)',
            )}
            style={{ color: tab === t.id ? 'var(--ace-text-primary)' : 'var(--ace-text-muted)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">

          {tab === 'overview' && (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  icon={<Clock size={18} />}
                  label="Total Listening"
                  value={`${totalHours}h`}
                  sub={`${totalDays} days`}
                  color="var(--ace-accent)"
                />
                <StatCard
                  icon={<Music2 size={18} />}
                  label="Tracks Played"
                  value={totalTracks.toLocaleString()}
                  color="var(--ace-success)"
                />
                <StatCard
                  icon={<Mic2 size={18} />}
                  label="Top Artist"
                  value={stats.topArtists[0]?.artist ?? '—'}
                  sub={`${stats.topArtists[0]?.playCount ?? 0} plays`}
                  color="var(--ace-info)"
                />
                <StatCard
                  icon={<Headphones size={18} />}
                  label="Lossless"
                  value={`${losslessPct}%`}
                  sub="of listening time"
                  color="var(--ace-warning)"
                />
              </div>

              {/* Calendar heatmap */}
              <Section title="Listening Activity" icon={<Calendar size={14} />}>
                <CalendarHeatmap data={stats.dailyHistory} />
              </Section>

              {/* Hourly heatmap */}
              <Section title="Time of Day" icon={<Clock size={14} />}>
                <HourlyHeatmap data={stats.hourlyHeatmap} />
              </Section>

              {/* Quality breakdown */}
              <Section title="Audio Quality Breakdown" icon={<BarChart3 size={14} />}>
                <QualityDonut buckets={stats.qualityBreakdown} />
              </Section>

              {sessionStats && (
                <Section title="Session Stats" icon={<TrendingUp size={14} />}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard icon={<ChevronRight size={14} />} label="Skips" value={String(sessionStats.skips)} color="var(--ace-warning)" />
                    <StatCard icon={<Award size={14} />} label="Completed" value={String(sessionStats.completed)} color="var(--ace-success)" />
                    <StatCard icon={<TrendingUp size={14} />} label="Repeats" value={String(sessionStats.repeats)} color="var(--ace-info)" />
                    <StatCard icon={<Clock size={14} />} label="Peak Hour" value={`${sessionStats.peakHour}:00`} color="var(--ace-accent)" />
                  </div>
                </Section>
              )}
            </>
          )}

          {tab === 'tracks' && (
            <Section title="Most Played Tracks" icon={<Music2 size={14} />}>
              <div className="flex flex-col">
                {stats.topTracks.map((t, i) => (
                  <RankRow
                    key={t.track.id}
                    rank={i + 1}
                    title={t.track.title}
                    subtitle={t.track.artist}
                    value={t.totalMs}
                    maxValue={stats.topTracks[0]?.totalMs ?? 1}
                    color="var(--ace-accent)"
                  />
                ))}
              </div>
            </Section>
          )}

          {tab === 'artists' && (
            <Section title="Most Played Artists" icon={<Mic2 size={14} />}>
              <div className="flex flex-col">
                {stats.topArtists.map((a, i) => (
                  <RankRow
                    key={a.artist}
                    rank={i + 1}
                    title={a.artist}
                    subtitle={`${a.playCount} plays`}
                    value={a.totalMs}
                    maxValue={stats.topArtists[0]?.totalMs ?? 1}
                    color="var(--ace-info)"
                  />
                ))}
              </div>
            </Section>
          )}

          {tab === 'albums' && (
            <Section title="Most Played Albums" icon={<Disc3 size={14} />}>
              <div className="flex flex-col">
                {stats.topAlbums.map((a, i) => (
                  <RankRow
                    key={a.album.id}
                    rank={i + 1}
                    title={a.album.title}
                    subtitle={a.album.artist}
                    value={a.totalMs}
                    maxValue={stats.topAlbums[0]?.totalMs ?? 1}
                    color="var(--ace-success)"
                  />
                ))}
              </div>
            </Section>
          )}

          {tab === 'genres' && (
            <Section title="Top Genres" icon={<Tag size={14} />}>
              <div className="flex flex-col">
                {stats.topGenres.map((g, i) => (
                  <RankRow
                    key={g.genre}
                    rank={i + 1}
                    title={g.genre}
                    subtitle={`${g.playCount} plays`}
                    value={g.totalMs}
                    maxValue={stats.topGenres[0]?.totalMs ?? 1}
                    color="var(--ace-warning)"
                  />
                ))}
              </div>
            </Section>
          )}

        </div>
      </div>
    </div>
  )
}
