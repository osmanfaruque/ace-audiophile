import type { GearProfile } from '@ace/types'

export interface FrPoint {
  frequencyHz: number
  splDb: number
}

export interface FrImportResult {
  points: FrPoint[]
  issues: string[]
}

const MIN_FREQ = 20
const MAX_FREQ = 20000

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseNumber(token: string): number | null {
  const n = Number(token.trim())
  return Number.isFinite(n) ? n : null
}

function splitLoose(line: string): string[] {
  if (line.includes(',')) return line.split(',')
  if (line.includes('\t')) return line.split('\t')
  if (line.includes(';')) return line.split(';')
  return line.trim().split(/\s+/)
}

function normalizePoints(input: FrPoint[]): FrImportResult {
  const issues: string[] = []
  const cleaned = input
    .filter((p) => isFiniteNumber(p.frequencyHz) && isFiniteNumber(p.splDb))
    .filter((p) => p.frequencyHz >= 10 && p.frequencyHz <= 96000)
    .sort((a, b) => a.frequencyHz - b.frequencyHz)

  const merged: FrPoint[] = []
  for (const point of cleaned) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.frequencyHz - point.frequencyHz) < 1e-6) {
      last.splDb = (last.splDb + point.splDb) / 2
    } else {
      merged.push({ ...point })
    }
  }

  if (merged.length < 8) {
    issues.push('Too few valid FR points after validation (need at least 8).')
  }

  if (merged[0] && merged[0].frequencyHz > MIN_FREQ) {
    issues.push(`Low-frequency coverage starts at ${Math.round(merged[0].frequencyHz)} Hz.`)
  }
  if (merged[merged.length - 1] && merged[merged.length - 1].frequencyHz < MAX_FREQ) {
    issues.push(`High-frequency coverage ends at ${Math.round(merged[merged.length - 1].frequencyHz)} Hz.`)
  }

  return { points: merged, issues }
}

function findHeaderIndex(headers: string[], keys: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase())
  for (const key of keys) {
    const idx = norm.findIndex((h) => h.includes(key))
    if (idx >= 0) return idx
  }
  return -1
}

function interpolateLog(points: FrPoint[], targetFreq: number): number {
  if (targetFreq <= points[0].frequencyHz) return points[0].splDb
  if (targetFreq >= points[points.length - 1].frequencyHz) return points[points.length - 1].splDb

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (targetFreq >= a.frequencyHz && targetFreq <= b.frequencyHz) {
      const la = Math.log10(a.frequencyHz)
      const lb = Math.log10(b.frequencyHz)
      const lt = Math.log10(targetFreq)
      const t = (lt - la) / Math.max(1e-12, lb - la)
      return a.splDb + (b.splDb - a.splDb) * t
    }
  }

  return points[points.length - 1].splDb
}

export function buildLogGrid24(minHz = MIN_FREQ, maxHz = MAX_FREQ): number[] {
  const grid: number[] = []
  const step = Math.pow(2, 1 / 24)
  let f = minHz
  while (f <= maxHz) {
    grid.push(Math.round(f * 1000) / 1000)
    f *= step
  }
  if (grid[grid.length - 1] < maxHz) {
    grid.push(maxHz)
  }
  return grid
}

export function interpolateToLogGrid24(points: FrPoint[]): FrImportResult {
  const normalized = normalizePoints(points)
  if (normalized.points.length < 2) return normalized

  const grid = buildLogGrid24()
  const interp = grid.map((f) => ({ frequencyHz: f, splDb: interpolateLog(normalized.points, f) }))
  return { points: interp, issues: normalized.issues }
}

export function parseAutoEqCsv(text: string): FrImportResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0) return { points: [], issues: ['Empty file.'] }

  const first = splitLoose(lines[0])
  const hasHeader = first.some((v) => /[a-zA-Z]/.test(v))
  const headers = hasHeader ? first : []
  const rows = hasHeader ? lines.slice(1) : lines

  const fIdx = hasHeader ? findHeaderIndex(headers, ['frequency', 'freq', 'hz']) : 0
  let sIdx = hasHeader ? findHeaderIndex(headers, ['spl', 'raw', 'fr', 'response', 'db']) : 1
  if (sIdx < 0) sIdx = hasHeader ? Math.min(1, headers.length - 1) : 1

  const points: FrPoint[] = []
  for (const row of rows) {
    const cols = splitLoose(row)
    if (cols.length < 2) continue
    const f = parseNumber(cols[fIdx])
    const s = parseNumber(cols[sIdx])
    if (f == null || s == null) continue
    points.push({ frequencyHz: f, splDb: s })
  }

  return interpolateToLogGrid24(points)
}

export function parseRewTxt(text: string): FrImportResult {
  const lines = text.split(/\r?\n/)
  const points: FrPoint[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('*') || line.startsWith('#')) continue

    const cols = splitLoose(line)
    if (cols.length < 2) continue

    const f = parseNumber(cols[0])
    const s = parseNumber(cols[1])
    if (f == null || s == null) continue

    points.push({ frequencyHz: f, splDb: s })
  }

  return interpolateToLogGrid24(points)
}

export function parseSquigLinkProfile(text: string): FrImportResult {
  const trimmed = text.trim()

  if (!trimmed) return { points: [], issues: ['Empty file.'] }

  // JSON adapter for squig-style profile dumps.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const obj = Array.isArray(parsed) ? parsed[0] : parsed
      const rec = (obj ?? {}) as Record<string, unknown>

      const freq = (rec.frequency || rec.frequencies || rec.freq) as unknown
      const spl = (rec.raw || rec.response || rec.spl || rec.fr) as unknown
      if (Array.isArray(freq) && Array.isArray(spl)) {
        const n = Math.min(freq.length, spl.length)
        const points: FrPoint[] = []
        for (let i = 0; i < n; i++) {
          const f = Number(freq[i])
          const s = Number(spl[i])
          if (Number.isFinite(f) && Number.isFinite(s)) {
            points.push({ frequencyHz: f, splDb: s })
          }
        }
        return interpolateToLogGrid24(points)
      }
    } catch {
      // fall through to delimited parser
    }
  }

  // CSV/TSV adapter for squig exports.
  return parseAutoEqCsv(text)
}

export function toGearProfileFromFr(
  id: string,
  name: string,
  brand: string,
  type: GearProfile['type'],
  source: GearProfile['source'],
  points: FrPoint[],
): GearProfile {
  return {
    id,
    name,
    brand,
    type,
    frFrequencies: points.map((p) => p.frequencyHz),
    frSpl: points.map((p) => p.splDb),
    correctionPresetId: null,
    source,
  }
}
