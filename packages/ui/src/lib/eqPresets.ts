/**
 * Built-in EQ preset catalog for Audiophile Ace
 * packages/ui/src/lib/eqPresets.ts
 */

import type { EqBand, EqFilterType, EqPreset } from '@ace/types'

const BAND_COUNT = 60
const FREQ_MIN = 20
const FREQ_MAX = 20000

/** Generate 60 log-spaced EQ bands with gains from an anchor function */
function generateBands(gainFn: (freq: number) => number): EqBand[] {
  return Array.from({ length: BAND_COUNT }, (_, i) => {
    const freq = Math.round(FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, i / (BAND_COUNT - 1)))
    return {
      id: i,
      enabled: true,
      frequency: freq,
      gainDb: Math.round(gainFn(freq) * 10) / 10,
      q: 1.0,
      type: 'peaking' as EqFilterType,
    }
  })
}

/** Log-frequency linear interpolation between anchor points [freq, gainDb] */
function interpGain(anchors: [number, number][]): (freq: number) => number {
  return (freq: number) => {
    if (freq <= anchors[0][0]) return anchors[0][1]
    if (freq >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1]
    for (let i = 0; i < anchors.length - 1; i++) {
      const [f0, g0] = anchors[i]
      const [f1, g1] = anchors[i + 1]
      if (freq >= f0 && freq <= f1) {
        const t = (Math.log10(freq) - Math.log10(f0)) / (Math.log10(f1) - Math.log10(f0))
        return g0 + t * (g1 - g0)
      }
    }
    return 0
  }
}

function makePreset(id: string, name: string, anchors: [number, number][], preampDb = 0): EqPreset {
  return { id, name, isSystem: true, bands: generateBands(interpGain(anchors)), preampDb }
}

// ─────────────────────────────────────────────────────────────
//  System preset catalog
// ─────────────────────────────────────────────────────────────

export const SYSTEM_PRESETS: EqPreset[] = [
  makePreset('flat', 'Flat', [[20, 0], [20000, 0]]),

  // Genre
  makePreset('rock', 'Rock', [[20, 3], [100, 2], [300, 0], [1000, -1], [3000, 1], [5000, 3], [10000, 4], [16000, 3], [20000, 2]]),
  makePreset('jazz', 'Jazz', [[20, 0], [100, 1], [250, 2], [500, 1], [1000, 0], [3000, 1], [6000, 2], [12000, 2], [20000, 1]]),
  makePreset('classical', 'Classical', [[20, 0], [100, 0], [500, 0], [1000, -1], [3000, -1], [5000, 1], [10000, 2], [16000, 1], [20000, 0]]),
  makePreset('electronic', 'Electronic', [[20, 5], [60, 4], [150, 2], [500, 0], [1500, -1], [4000, 1], [8000, 3], [16000, 4], [20000, 4]]),
  makePreset('rnb-hiphop', 'R&B / Hip-Hop', [[20, 5], [60, 5], [150, 3], [400, 1], [1000, 0], [3000, 1], [6000, 2], [10000, 1], [20000, 0]]),
  makePreset('metal', 'Metal', [[20, 2], [80, 3], [200, 0], [800, -2], [2000, 0], [4000, 3], [8000, 4], [14000, 3], [20000, 2]]),
  makePreset('pop', 'Pop', [[20, 0], [60, 1], [200, 2], [600, 1], [1500, 0], [3000, 2], [6000, 3], [12000, 2], [20000, 1]]),

  // Tonal shape
  makePreset('bass-boost', 'Bass Boost', [[20, 6], [60, 5], [150, 3], [400, 0], [20000, 0]]),
  makePreset('treble-boost', 'Treble Boost', [[20, 0], [2000, 0], [5000, 2], [10000, 4], [16000, 5], [20000, 5]]),
  makePreset('v-shape', 'V-Shape', [[20, 5], [60, 4], [200, 1], [800, -2], [2000, -1], [5000, 2], [10000, 4], [16000, 5], [20000, 5]]),
  makePreset('warm', 'Warm', [[20, 2], [100, 3], [300, 2], [800, 1], [2000, 0], [5000, -1], [10000, -2], [20000, -2]]),
  makePreset('bright', 'Bright', [[20, 0], [500, 0], [2000, 1], [5000, 3], [10000, 4], [15000, 5], [20000, 5]]),
  makePreset('mid-forward', 'Mid Forward', [[20, -1], [200, 0], [600, 2], [1500, 3], [3000, 3], [5000, 2], [10000, 0], [20000, -1]]),

  // Functional
  makePreset('vocal', 'Vocal Enhance', [[20, -2], [100, -1], [250, 0], [1000, 3], [3000, 4], [5000, 3], [8000, 1], [16000, 0], [20000, 0]]),
  makePreset('podcast', 'Podcast / Voice', [[20, -4], [100, -2], [250, 1], [800, 3], [2000, 4], [4000, 3], [8000, 1], [16000, -1], [20000, -3]]),
  makePreset('loudness', 'Loudness', [[20, 4], [60, 3], [150, 1], [400, 0], [1000, 0], [3000, 0], [6000, 1], [10000, 3], [16000, 4], [20000, 4]]),
  makePreset('bass-cut', 'Bass Cut (Rumble Filter)', [[20, -12], [40, -8], [80, -3], [150, 0], [20000, 0]]),
  makePreset('acoustic', 'Acoustic', [[20, 0], [100, 1], [250, 1.5], [1000, 0], [2000, 1], [5000, 2], [10000, 1.5], [20000, 0]]),
  makePreset('night-mode', 'Night Mode', [[20, -3], [60, -2], [200, 0], [800, 1], [2000, 2], [5000, 1], [10000, 0], [16000, -2], [20000, -4]], -4),

  // Reference targets
  makePreset('harman-ie-2018', 'Harman In-Ear 2018', [[20, 5], [60, 4], [200, 0], [800, -1], [2000, 2], [3000, 4], [5000, 1], [8000, -2], [10000, 0], [14000, 2], [20000, 0]]),
  makePreset('harman-oe-2019', 'Harman Over-Ear 2019', [[20, 4], [60, 3], [200, 0], [800, 0], [2000, 1], [3000, 3], [5000, 0], [8000, -1], [10000, 0], [16000, -1], [20000, -2]]),
  makePreset('diffuse-field', 'Diffuse Field', [[20, 0], [100, 0], [500, 0], [1000, 0], [2000, 2], [4000, 4], [8000, 2], [12000, 0], [20000, -2]]),
]

// ─────────────────────────────────────────────────────────────
//  Import / Export helpers
// ─────────────────────────────────────────────────────────────

export interface ExportedPreset {
  name: string
  preampDb: number
  bands: { frequency: number; gainDb: number; q: number; type: EqFilterType }[]
}

export function exportPreset(preset: EqPreset): string {
  const data: ExportedPreset = {
    name: preset.name,
    preampDb: preset.preampDb,
    bands: preset.bands.map((b) => ({
      frequency: b.frequency,
      gainDb: b.gainDb,
      q: b.q,
      type: b.type,
    })),
  }
  return JSON.stringify(data, null, 2)
}

export function importPreset(json: string): EqPreset | null {
  try {
    const data = JSON.parse(json) as ExportedPreset
    if (!data.name || !Array.isArray(data.bands)) return null
    return {
      id: `import-${Date.now()}`,
      name: data.name,
      isSystem: false,
      preampDb: data.preampDb ?? 0,
      bands: data.bands.map((b, i) => ({
        id: i,
        enabled: true,
        frequency: b.frequency,
        gainDb: b.gainDb,
        q: b.q ?? 1.0,
        type: b.type ?? 'peaking',
      })),
    }
  } catch {
    return null
  }
}
