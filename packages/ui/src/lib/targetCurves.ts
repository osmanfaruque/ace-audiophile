import type { TargetCurve } from '@ace/types'

export interface TargetAnchor {
  frequencyHz: number
  splDb: number
}

const HARMAN_2019_OVER_EAR: TargetAnchor[] = [
  { frequencyHz: 20, splDb: 86.0 },
  { frequencyHz: 40, splDb: 85.0 },
  { frequencyHz: 80, splDb: 83.0 },
  { frequencyHz: 120, splDb: 81.5 },
  { frequencyHz: 250, splDb: 79.5 },
  { frequencyHz: 500, splDb: 78.5 },
  { frequencyHz: 1000, splDb: 78.0 },
  { frequencyHz: 2000, splDb: 79.5 },
  { frequencyHz: 3000, splDb: 81.0 },
  { frequencyHz: 6000, splDb: 78.0 },
  { frequencyHz: 10000, splDb: 76.0 },
  { frequencyHz: 16000, splDb: 74.5 },
  { frequencyHz: 20000, splDb: 73.5 },
]

const HARMAN_2018_IN_EAR: TargetAnchor[] = [
  { frequencyHz: 20, splDb: 85.5 },
  { frequencyHz: 50, splDb: 84.0 },
  { frequencyHz: 100, splDb: 82.0 },
  { frequencyHz: 200, splDb: 79.5 },
  { frequencyHz: 500, splDb: 77.8 },
  { frequencyHz: 1000, splDb: 77.0 },
  { frequencyHz: 2000, splDb: 79.0 },
  { frequencyHz: 3000, splDb: 84.0 },
  { frequencyHz: 5000, splDb: 80.5 },
  { frequencyHz: 8000, splDb: 77.5 },
  { frequencyHz: 10000, splDb: 75.8 },
  { frequencyHz: 16000, splDb: 74.0 },
  { frequencyHz: 20000, splDb: 73.0 },
]

const DIFFUSE_FIELD: TargetAnchor[] = [
  { frequencyHz: 20, splDb: 81.0 },
  { frequencyHz: 60, splDb: 80.0 },
  { frequencyHz: 200, splDb: 79.0 },
  { frequencyHz: 500, splDb: 79.2 },
  { frequencyHz: 1000, splDb: 80.0 },
  { frequencyHz: 2000, splDb: 82.0 },
  { frequencyHz: 3000, splDb: 83.0 },
  { frequencyHz: 5000, splDb: 81.5 },
  { frequencyHz: 8000, splDb: 79.5 },
  { frequencyHz: 12000, splDb: 78.5 },
  { frequencyHz: 20000, splDb: 77.5 },
]

const FREE_FIELD: TargetAnchor[] = [
  { frequencyHz: 20, splDb: 80.0 },
  { frequencyHz: 100, splDb: 80.0 },
  { frequencyHz: 500, splDb: 80.0 },
  { frequencyHz: 1000, splDb: 80.0 },
  { frequencyHz: 2000, splDb: 80.0 },
  { frequencyHz: 4000, splDb: 79.5 },
  { frequencyHz: 8000, splDb: 79.0 },
  { frequencyHz: 12000, splDb: 78.5 },
  { frequencyHz: 20000, splDb: 78.0 },
]

export const DEFAULT_CUSTOM_TARGET: TargetAnchor[] = [
  { frequencyHz: 20, splDb: 82 },
  { frequencyHz: 60, splDb: 81 },
  { frequencyHz: 200, splDb: 80 },
  { frequencyHz: 1000, splDb: 80 },
  { frequencyHz: 3000, splDb: 80 },
  { frequencyHz: 8000, splDb: 79 },
  { frequencyHz: 16000, splDb: 78 },
  { frequencyHz: 20000, splDb: 77 },
]

function normalizeAnchors(anchors: TargetAnchor[]): TargetAnchor[] {
  return [...anchors]
    .filter((a) => Number.isFinite(a.frequencyHz) && Number.isFinite(a.splDb))
    .sort((a, b) => a.frequencyHz - b.frequencyHz)
}

export function interpolateTarget(anchorsInput: TargetAnchor[], frequencyHz: number): number {
  const anchors = normalizeAnchors(anchorsInput)
  if (anchors.length === 0) return 80
  if (frequencyHz <= anchors[0].frequencyHz) return anchors[0].splDb
  if (frequencyHz >= anchors[anchors.length - 1].frequencyHz) return anchors[anchors.length - 1].splDb

  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]
    const b = anchors[i]
    if (frequencyHz <= b.frequencyHz) {
      const la = Math.log10(a.frequencyHz)
      const lb = Math.log10(b.frequencyHz)
      const lf = Math.log10(frequencyHz)
      const t = (lf - la) / Math.max(1e-12, lb - la)
      return a.splDb + (b.splDb - a.splDb) * t
    }
  }

  return anchors[anchors.length - 1].splDb
}

export function getCurveAnchors(curve: TargetCurve, customAnchors: TargetAnchor[]): TargetAnchor[] {
  switch (curve) {
    case 'harman2019':
      return HARMAN_2019_OVER_EAR
    case 'harmanIE2018':
    case 'harmanIE2019':
      return HARMAN_2018_IN_EAR
    case 'diffuseField':
      return DIFFUSE_FIELD
    case 'freeField':
      return FREE_FIELD
    case 'custom':
      return customAnchors.length > 1 ? normalizeAnchors(customAnchors) : DEFAULT_CUSTOM_TARGET
    default:
      return HARMAN_2019_OVER_EAR
  }
}

export function getTargetCurvePoints(
  curve: TargetCurve,
  frequencies: number[],
  customAnchors: TargetAnchor[] = DEFAULT_CUSTOM_TARGET,
): number[] {
  const anchors = getCurveAnchors(curve, customAnchors)
  return frequencies.map((f) => interpolateTarget(anchors, f))
}
