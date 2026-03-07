'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  FolderOpen, Play, Pause, RotateCcw, CheckCircle2, XCircle,
  BarChart3, Loader2, ChevronRight, Lock, Unlock, Volume2,
  Shuffle, Award, Headphones, FileAudio, AlertTriangle,
} from 'lucide-react'
import { cn, formatDuration } from '@/lib/utils'
import type { AbxSession, AbxTrial } from '@ace/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type TestPhase = 'setup' | 'testing' | 'results'
type PlaybackTarget = 'A' | 'B' | 'X' | null

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

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Binomial test — probability of getting >= k correct in n trials by chance (p=0.5) */
function binomialPValue(correct: number, total: number): number {
  if (total === 0) return 1
  let pValue = 0
  for (let k = correct; k <= total; k++) {
    pValue += binomCoeff(total, k) * Math.pow(0.5, total)
  }
  return pValue
}

function binomCoeff(n: number, k: number): number {
  if (k === 0 || k === n) return 1
  let result = 1
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1)
  }
  return result
}

// ── Stat helpers ──────────────────────────────────────────────────────────────

function getConfidenceLabel(pValue: number | null): { label: string; color: string } {
  if (pValue === null) return { label: '—', color: 'var(--ace-text-muted)' }
  if (pValue <= 0.01) return { label: 'Highly Significant', color: 'var(--ace-success)' }
  if (pValue <= 0.05) return { label: 'Significant', color: 'var(--ace-success)' }
  if (pValue <= 0.10) return { label: 'Marginal', color: 'var(--ace-warning)' }
  return { label: 'Not Significant', color: 'var(--ace-danger)' }
}

// ── Big Play Button ───────────────────────────────────────────────────────────

function PlayButton({ label, sublabel, active, playing, onClick, color, size = 'large' }: {
  label: string
  sublabel?: string
  active: boolean
  playing: boolean
  onClick: () => void
  color: string
  size?: 'large' | 'small'
}) {
  const large = size === 'large'
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border-2 transition-all font-bold',
        large ? 'w-36 h-36' : 'w-28 h-28',
        active ? 'scale-105 shadow-lg' : 'hover:scale-[1.02]',
      )}
      style={{
        borderColor: active ? color : 'var(--ace-border)',
        background: active ? `${color}15` : 'var(--ace-bg-elevated)',
        boxShadow: active ? `0 0 20px ${color}30` : 'none',
      }}
    >
      <span
        className={cn('font-black tracking-wider', large ? 'text-3xl' : 'text-2xl')}
        style={{ color: active ? color : 'var(--ace-text-primary)' }}
      >
        {label}
      </span>
      {sublabel && (
        <span className="text-[10px] mt-1 font-normal" style={{ color: 'var(--ace-text-muted)' }}>
          {sublabel}
        </span>
      )}
      {playing && (
        <div className="flex gap-0.5 mt-2">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-1 rounded-full animate-pulse"
              style={{
                background: color,
                height: `${8 + Math.random() * 8}px`,
                animationDelay: `${i * 150}ms`,
              }}
            />
          ))}
        </div>
      )}
    </button>
  )
}

// ── Trial Row ─────────────────────────────────────────────────────────────────

function TrialRow({ trial, index }: { trial: AbxTrial; index: number }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 border-b text-xs"
      style={{ borderColor: 'var(--ace-border)' }}
    >
      <span className="w-8 text-center font-mono" style={{ color: 'var(--ace-text-muted)' }}>
        #{index + 1}
      </span>
      <span className="w-20" style={{ color: 'var(--ace-text-secondary)' }}>
        Guessed: <span className="font-bold" style={{ color: 'var(--ace-text-primary)' }}>
          {trial.userGuessedA ? 'X = A' : 'X = B'}
        </span>
      </span>
      {trial.correct !== null ? (
        trial.correct ? (
          <span className="flex items-center gap-1" style={{ color: 'var(--ace-success)' }}>
            <CheckCircle2 size={13} /> Correct
          </span>
        ) : (
          <span className="flex items-center gap-1" style={{ color: 'var(--ace-danger)' }}>
            <XCircle size={13} /> Wrong
          </span>
        )
      ) : (
        <span style={{ color: 'var(--ace-text-muted)' }}>Sealed</span>
      )}
      <span className="ml-auto font-mono" style={{ color: 'var(--ace-text-muted)' }}>
        {(trial.responseTimeMs / 1000).toFixed(1)}s
      </span>
    </div>
  )
}

// ── Results Panel ─────────────────────────────────────────────────────────────

function ResultsPanel({ trials, session }: { trials: AbxTrial[]; session: AbxSession }) {
  const total = trials.length
  const correct = trials.filter(t => t.correct).length
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0
  const pValue = session.pValue ?? binomialPValue(correct, total)
  const conf = getConfidenceLabel(pValue)
  const avgTime = total > 0 ? trials.reduce((s, t) => s + t.responseTimeMs, 0) / total / 1000 : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Score ring */}
      <div className="flex items-center gap-5 p-4 rounded-lg border" style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}>
        <div className="relative w-20 h-20">
          <svg viewBox="0 0 52 52" className="w-full h-full -rotate-90">
            <circle cx="26" cy="26" r="22" fill="none" stroke="var(--ace-border)" strokeWidth="4" />
            <circle
              cx="26" cy="26" r="22" fill="none"
              stroke={conf.color} strokeWidth="4"
              strokeDasharray={`${pct * 1.382} 138.2`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-lg font-black" style={{ color: conf.color }}>
            {correct}/{total}
          </span>
        </div>
        <div className="flex-1">
          <div className="text-lg font-bold" style={{ color: 'var(--ace-text-primary)' }}>
            {pct}% Correct
          </div>
          <div className="text-xs mt-0.5" style={{ color: conf.color }}>
            {conf.label} {pValue !== null && `(p = ${pValue.toFixed(4)})`}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--ace-text-muted)' }}>
            Avg response: {avgTime.toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Interpretation */}
      <div
        className="rounded border px-4 py-3 text-xs"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-secondary)' }}
      >
        {pValue !== null && pValue <= 0.05 ? (
          <>
            <p className="font-semibold mb-1" style={{ color: 'var(--ace-success)' }}>
              ✓ You can reliably distinguish the two samples.
            </p>
            <p>
              With p = {pValue.toFixed(4)}, there is strong statistical evidence that your results
              are not due to chance. You are hearing a real difference between A and B.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold mb-1" style={{ color: 'var(--ace-warning)' }}>
              ⚠ No statistically significant difference detected.
            </p>
            <p>
              With p = {(pValue ?? 1).toFixed(4)}, there is not enough evidence to conclude that you can
              reliably distinguish A from B. This doesn't mean they sound the same — try more trials
              for higher confidence. At least 12–16 trials recommended.
            </p>
          </>
        )}
      </div>

      {/* p-value scale */}
      <div className="px-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--ace-text-muted)' }}>
          p-value scale
        </div>
        <div className="relative h-3 rounded-full overflow-hidden" style={{ background: 'var(--ace-border)' }}>
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-all"
            style={{
              width: `${Math.max(2, (1 - (pValue ?? 1)) * 100)}%`,
              background: `linear-gradient(90deg, var(--ace-danger), var(--ace-warning), var(--ace-success))`,
            }}
          />
          {/* 0.05 marker */}
          <div
            className="absolute top-0 h-full w-px"
            style={{ left: '95%', background: 'var(--ace-text-primary)' }}
          />
        </div>
        <div className="flex justify-between text-[9px] mt-1" style={{ color: 'var(--ace-text-muted)' }}>
          <span>p=1.0 (random)</span>
          <span>p=0.05</span>
          <span>p=0.0 (certain)</span>
        </div>
      </div>

      {/* Trial history */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest mb-2 px-2" style={{ color: 'var(--ace-text-muted)' }}>
          Trial History
        </div>
        <div className="border rounded overflow-hidden" style={{ borderColor: 'var(--ace-border)' }}>
          {trials.map((t, i) => <TrialRow key={t.id} trial={t} index={i} />)}
        </div>
      </div>
    </div>
  )
}

// ── Main AbxView ──────────────────────────────────────────────────────────────

export function AbxView() {
  const [phase, setPhase] = useState<TestPhase>('setup')
  const [fileA, setFileA] = useState<string | null>(null)
  const [fileB, setFileB] = useState<string | null>(null)
  const [totalTrials, setTotalTrials] = useState(16)
  const [sealed, setSealed] = useState(false)

  // Test state
  const [session, setSession] = useState<AbxSession | null>(null)
  const [trials, setTrials] = useState<AbxTrial[]>([])
  const [currentTrial, setCurrentTrial] = useState(0)
  const [xIsA, setXIsA] = useState(true)
  const [playing, setPlaying] = useState<PlaybackTarget>(null)
  const [trialStartTime, setTrialStartTime] = useState(0)
  const [showFeedback, setShowFeedback] = useState<'correct' | 'wrong' | null>(null)

  // ── Pick files ──
  const pickFile = useCallback(async (which: 'A' | 'B') => {
    const path = await openAudioFile()
    if (!path) return
    if (which === 'A') setFileA(path)
    else setFileB(path)
  }, [])

  // ── Start session ──
  const startSession = useCallback(() => {
    if (!fileA || !fileB) return
    const now = Date.now()
    const newSession: AbxSession = {
      id: `abx-${now}`,
      fileA, fileB,
      createdAt: now,
      sealed,
      totalTrials,
      correctCount: 0,
      pValue: null,
      confidencePct: null,
    }
    setSession(newSession)
    setTrials([])
    setCurrentTrial(0)
    setXIsA(Math.random() < 0.5)
    setTrialStartTime(Date.now())
    setPhase('testing')
    setPlaying(null)
  }, [fileA, fileB, totalTrials, sealed])

  // ── Simulate play ──
  const handlePlay = useCallback((target: PlaybackTarget) => {
    if (playing === target) {
      setPlaying(null)
      // invoke('abx_stop')
    } else {
      setPlaying(target)
      // invoke('abx_play', { target, xIsA })
    }
  }, [playing])

  // ── Submit guess ──
  const submitGuess = useCallback((guessedA: boolean) => {
    if (!session) return
    const responseTimeMs = Date.now() - trialStartTime
    const correct = sealed ? null : (guessedA === xIsA)

    const trial: AbxTrial = {
      id: `trial-${session.id}-${currentTrial}`,
      sessionId: session.id,
      trialNumber: currentTrial + 1,
      xWasA: sealed ? null : xIsA,
      userGuessedA: guessedA,
      correct,
      responseTimeMs,
    }

    const newTrials = [...trials, trial]
    setTrials(newTrials)
    setPlaying(null)

    // Show feedback briefly
    if (!sealed && correct !== null) {
      setShowFeedback(correct ? 'correct' : 'wrong')
      setTimeout(() => setShowFeedback(null), 800)
    }

    const nextTrial = currentTrial + 1
    if (nextTrial >= totalTrials) {
      // Session complete
      const correctCount = sealed ? 0 : newTrials.filter(t => t.correct).length
      const pValue = sealed ? null : binomialPValue(correctCount, newTrials.length)
      setSession(prev => prev ? { ...prev, correctCount, pValue, confidencePct: pValue != null ? Math.round((1 - pValue) * 100) : null } : null)
      setPhase('results')
    } else {
      setCurrentTrial(nextTrial)
      setXIsA(Math.random() < 0.5)
      setTrialStartTime(Date.now())
    }
  }, [session, currentTrial, totalTrials, xIsA, trials, trialStartTime, sealed])

  // ── Reset ──
  const resetTest = useCallback(() => {
    setPhase('setup')
    setSession(null)
    setTrials([])
    setCurrentTrial(0)
    setPlaying(null)
    setShowFeedback(null)
  }, [])

  // ═══════════════════════════════════════════════════════════════════════════
  // SETUP PHASE
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === 'setup') {
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)' }}>
        <div
          className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
          style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}
        >
          <Headphones size={15} style={{ color: 'var(--ace-accent)' }} />
          <span className="text-sm font-semibold">ABX Blind Test</span>
          <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
            — Double-blind comparison to test if you can hear a difference
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-lg mx-auto py-10 px-6 flex flex-col gap-6">

            {/* Explanation */}
            <div
              className="rounded-lg border px-5 py-4 text-xs leading-relaxed"
              style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-secondary)' }}
            >
              <p className="font-semibold text-sm mb-2" style={{ color: 'var(--ace-text-primary)' }}>
                How ABX works
              </p>
              <p>
                You select two audio files — <strong>A</strong> and <strong>B</strong>. The app
                randomly assigns one of them to <strong>X</strong>. Your job: listen to A, B, and X,
                then decide whether X is A or B. After multiple trials, a statistical test determines
                if you can reliably distinguish them, or if your results are just luck.
              </p>
              <p className="mt-2">
                <strong>p ≤ 0.05</strong> = statistically significant. You can hear the difference.
              </p>
            </div>

            {/* File pickers */}
            <div className="flex flex-col gap-3">
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ace-text-muted)' }}>
                Select Files
              </div>

              {/* File A */}
              <button
                onClick={() => pickFile('A')}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed transition-colors hover:bg-white/5"
                style={{ borderColor: fileA ? 'var(--ace-success)' : 'var(--ace-border)' }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-black text-lg"
                  style={{ background: '#4caf8218', color: 'var(--ace-success)' }}
                >
                  A
                </div>
                <div className="flex-1 text-left">
                  {fileA ? (
                    <>
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--ace-text-primary)' }}>
                        {fileName(fileA)}
                      </div>
                      <div className="text-[10px] truncate" style={{ color: 'var(--ace-text-muted)' }}>
                        {fileA}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
                      Click to select Sample A (e.g. FLAC lossless)
                    </div>
                  )}
                </div>
                <FolderOpen size={14} style={{ color: 'var(--ace-text-muted)' }} />
              </button>

              {/* File B */}
              <button
                onClick={() => pickFile('B')}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed transition-colors hover:bg-white/5"
                style={{ borderColor: fileB ? 'var(--ace-info)' : 'var(--ace-border)' }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-black text-lg"
                  style={{ background: '#4fa3e018', color: 'var(--ace-info)' }}
                >
                  B
                </div>
                <div className="flex-1 text-left">
                  {fileB ? (
                    <>
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--ace-text-primary)' }}>
                        {fileName(fileB)}
                      </div>
                      <div className="text-[10px] truncate" style={{ color: 'var(--ace-text-muted)' }}>
                        {fileB}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
                      Click to select Sample B (e.g. MP3 320kbps)
                    </div>
                  )}
                </div>
                <FolderOpen size={14} style={{ color: 'var(--ace-text-muted)' }} />
              </button>
            </div>

            {/* Settings */}
            <div className="flex flex-col gap-3">
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--ace-text-muted)' }}>
                Test Settings
              </div>

              {/* Trial count */}
              <div className="flex items-center gap-3">
                <label className="text-xs w-28" style={{ color: 'var(--ace-text-secondary)' }}>
                  Number of trials
                </label>
                <div className="flex items-center gap-2">
                  {[8, 12, 16, 20, 24].map(n => (
                    <button
                      key={n}
                      onClick={() => setTotalTrials(n)}
                      className={cn(
                        'px-3 py-1.5 rounded text-xs font-medium border transition-colors',
                        totalTrials === n ? 'border-[var(--ace-accent)] bg-[var(--ace-accent)]/10' : 'border-[var(--ace-border)] hover:bg-white/5',
                      )}
                      style={{ color: totalTrials === n ? 'var(--ace-accent)' : 'var(--ace-text-secondary)' }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sealed mode */}
              <div className="flex items-center gap-3">
                <label className="text-xs w-28" style={{ color: 'var(--ace-text-secondary)' }}>
                  Sealed mode
                </label>
                <button
                  onClick={() => setSealed(!sealed)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-colors',
                    sealed ? 'border-[var(--ace-warning)] bg-[var(--ace-warning)]/10' : 'border-[var(--ace-border)] hover:bg-white/5',
                  )}
                  style={{ color: sealed ? 'var(--ace-warning)' : 'var(--ace-text-secondary)' }}
                >
                  {sealed ? <Lock size={12} /> : <Unlock size={12} />}
                  {sealed ? 'Sealed (no feedback)' : 'Open (instant feedback)'}
                </button>
              </div>

              <p className="text-[10px] pl-[7.5rem]" style={{ color: 'var(--ace-text-muted)' }}>
                {sealed
                  ? 'True double-blind: no feedback during test. Results revealed after all trials.'
                  : 'You see correct/wrong after each trial. Faster iteration but mild bias risk.'}
              </p>
            </div>

            {/* Start button */}
            <button
              onClick={startSession}
              disabled={!fileA || !fileB}
              className={cn(
                'flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all',
                !fileA || !fileB ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90 active:scale-[0.98]',
              )}
              style={{ background: 'var(--ace-accent)', color: '#fff' }}
            >
              <Shuffle size={16} />
              Start ABX Test ({totalTrials} trials)
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTING PHASE
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === 'testing') {
    const progress = ((currentTrial) / totalTrials) * 100
    const correctSoFar = trials.filter(t => t.correct).length
    const wrongSoFar = trials.filter(t => t.correct === false).length

    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)' }}>
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-2 border-b shrink-0"
          style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}
        >
          <span className="text-sm font-semibold">
            Trial {currentTrial + 1} / {totalTrials}
          </span>

          {!sealed && (
            <div className="flex items-center gap-3 ml-4 text-xs">
              <span style={{ color: 'var(--ace-success)' }}>✓ {correctSoFar}</span>
              <span style={{ color: 'var(--ace-danger)' }}>✗ {wrongSoFar}</span>
            </div>
          )}

          <span className="flex-1" />

          <button
            onClick={resetTest}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
            style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
          >
            <RotateCcw size={12} /> Abort
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full" style={{ background: 'var(--ace-border)' }}>
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${progress}%`, background: 'var(--ace-accent)' }}
          />
        </div>

        {/* Feedback flash */}
        {showFeedback && (
          <div
            className="text-center py-1.5 text-xs font-bold animate-pulse"
            style={{
              background: showFeedback === 'correct' ? 'var(--ace-success)' : 'var(--ace-danger)',
              color: '#fff',
            }}
          >
            {showFeedback === 'correct' ? '✓ Correct!' : '✗ Wrong!'}
          </div>
        )}

        {/* Main play area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-8 p-6">
          {/* A, B, X buttons */}
          <div className="flex items-center gap-6">
            <PlayButton
              label="A"
              sublabel={fileA ? fileName(fileA) : undefined}
              active={playing === 'A'}
              playing={playing === 'A'}
              onClick={() => handlePlay('A')}
              color="var(--ace-success)"
            />
            <PlayButton
              label="B"
              sublabel={fileB ? fileName(fileB) : undefined}
              active={playing === 'B'}
              playing={playing === 'B'}
              onClick={() => handlePlay('B')}
              color="var(--ace-info)"
            />
            <PlayButton
              label="X"
              sublabel="Mystery sample"
              active={playing === 'X'}
              playing={playing === 'X'}
              onClick={() => handlePlay('X')}
              color="var(--ace-accent)"
              size="large"
            />
          </div>

          {/* Instructions */}
          <p className="text-xs text-center max-w-md" style={{ color: 'var(--ace-text-muted)' }}>
            Listen to <strong>A</strong>, <strong>B</strong>, and <strong>X</strong> as many times as you want.
            Then decide: is X the same as A, or the same as B?
          </p>

          {/* Guess buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => submitGuess(true)}
              className="flex items-center gap-2 px-8 py-3 rounded-lg text-sm font-bold border-2 transition-all hover:scale-[1.02] active:scale-95"
              style={{ borderColor: 'var(--ace-success)', color: 'var(--ace-success)', background: '#4caf8210' }}
            >
              X = A
            </button>
            <span className="text-xs font-medium" style={{ color: 'var(--ace-text-muted)' }}>or</span>
            <button
              onClick={() => submitGuess(false)}
              className="flex items-center gap-2 px-8 py-3 rounded-lg text-sm font-bold border-2 transition-all hover:scale-[1.02] active:scale-95"
              style={{ borderColor: 'var(--ace-info)', color: 'var(--ace-info)', background: '#4fa3e010' }}
            >
              X = B
            </button>
          </div>
        </div>

        {/* Bottom: mini trial dots */}
        <div
          className="flex items-center justify-center gap-1.5 py-3 border-t"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
        >
          {Array.from({ length: totalTrials }, (_, i) => {
            const t = trials[i]
            let bg = 'var(--ace-border)'
            if (t) {
              if (sealed) bg = 'var(--ace-text-muted)'
              else if (t.correct) bg = 'var(--ace-success)'
              else bg = 'var(--ace-danger)'
            }
            if (i === currentTrial && !t) bg = 'var(--ace-accent)'
            return (
              <span
                key={i}
                className={cn('w-2.5 h-2.5 rounded-full transition-all', i === currentTrial && 'scale-125')}
                style={{ background: bg }}
              />
            )
          })}
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS PHASE
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--ace-bg)', color: 'var(--ace-text-primary)' }}>
      <div
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0"
        style={{ background: 'var(--ace-bg-elevated)', borderColor: 'var(--ace-border)' }}
      >
        <Award size={15} style={{ color: 'var(--ace-accent)' }} />
        <span className="text-sm font-semibold">ABX Test Results</span>
        <span className="flex-1" />
        <button
          onClick={resetTest}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border hover:bg-white/5 transition-colors"
          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-secondary)' }}
        >
          <RotateCcw size={12} /> New Test
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto py-6 px-4">
          {/* File labels */}
          <div className="flex gap-3 mb-5">
            <div
              className="flex-1 rounded border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
            >
              <span className="font-bold" style={{ color: 'var(--ace-success)' }}>A: </span>
              <span className="truncate" style={{ color: 'var(--ace-text-secondary)' }}>
                {fileA ? fileName(fileA) : '—'}
              </span>
            </div>
            <div
              className="flex-1 rounded border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
            >
              <span className="font-bold" style={{ color: 'var(--ace-info)' }}>B: </span>
              <span className="truncate" style={{ color: 'var(--ace-text-secondary)' }}>
                {fileB ? fileName(fileB) : '—'}
              </span>
            </div>
          </div>

          {session && <ResultsPanel trials={trials} session={session} />}
        </div>
      </div>
    </div>
  )
}
