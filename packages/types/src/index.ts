// ─────────────────────────────────────────────
//  Audiophile Ace — Shared TypeScript Interfaces
//  packages/types/src/index.ts
// ─────────────────────────────────────────────

// ── UI ───────────────────────────────────────
export type UiMode = 'elegant' | 'technical'
export type ColorScheme = 'system' | 'light' | 'dark' | 'amoled'

// ── Playback ──────────────────────────────────
export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'loading' | 'error'
export type RepeatMode = 'none' | 'one' | 'all'
export type ShuffleMode = 'off' | 'on'

export interface PlaybackState {
  status: PlaybackStatus
  currentTrackId: string | null
  positionMs: number
  durationMs: number
  volume: number         // 0.0 – 1.0
  repeat: RepeatMode
  shuffle: ShuffleMode
  deviceId: string | null
}

// ── Audio Track ───────────────────────────────
export interface AudioTrack {
  id: string
  filePath: string

  // Core metadata
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  year: number | null
  trackNumber: number | null
  totalTracks: number | null
  discNumber: number | null
  totalDiscs: number | null
  comment: string

  // Technical
  durationMs: number
  sampleRate: number          // e.g. 44100, 96000, 192000
  bitDepth: number            // e.g. 16, 24, 32
  channels: number            // 1 = mono, 2 = stereo, etc.
  codec: AudioCodec
  bitrateKbps: number         // 0 for lossless
  fileSizeBytes: number

  // Analysis results (nullable until scanned)
  effectiveBitDepth: number | null
  dynamicRange: number | null       // TT DR value
  lufs: number | null               // Integrated loudness
  truePeak: number | null
  isLossyTranscode: boolean | null
  lossyConfidence: number | null    // 0–100

  // ReplayGain
  replayGainTrack: number | null
  replayGainAlbum: number | null

  // IDs
  musicBrainzId: string | null
  acoustId: string | null
  albumId: string

  // Timestamps
  dateAdded: number     // Unix ms
  dateModified: number
  lastPlayed: number | null
  playCount: number
}

export type AudioCodec =
  | 'flac' | 'wav' | 'aiff' | 'alac' | 'aac' | 'mp3' | 'ogg'
  | 'opus' | 'dsf' | 'dff' | 'wma' | 'ape' | 'wavpack' | 'tta'
  | 'mp4' | 'unknown'

// ── Album / Artist ────────────────────────────
export interface Album {
  id: string
  title: string
  artist: string
  year: number | null
  artworkUri: string | null
  musicBrainzReleaseId: string | null
  replayGainAlbum: number | null
  trackCount: number
}

export interface Artist {
  id: string
  name: string
  musicBrainzArtistId: string | null
  albumCount: number
  trackCount: number
}

// ── Queue ─────────────────────────────────────
export interface QueueItem {
  queueId: string
  trackId: string
  position: number
}

// ── Playlist ──────────────────────────────────
export interface Playlist {
  id: string
  name: string
  description: string
  createdAt: number
  modifiedAt: number
  trackCount: number
  isSmartPlaylist: boolean
  rules?: SmartPlaylistRule[]
}

export interface SmartPlaylistRule {
  field: keyof AudioTrack
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'startsWith'
  value: string | number | boolean
}

// ── Audio Output Device ───────────────────────
export interface AudioDevice {
  id: string
  name: string
  type: 'internal' | 'usb' | 'bluetooth' | 'virtual'
  sampleRates: number[]
  bitDepths: number[]
  channels: number[]
  isExclusive: boolean
  supportsDoP: boolean        // DSD over PCM
  supportsNativeDSD: boolean
}

// ── DSP / EQ ──────────────────────────────────
export type EqFilterType =
  | 'peaking' | 'lowShelf' | 'highShelf'
  | 'lowPass' | 'highPass' | 'notch'
  | 'bandPass' | 'allPass'

export interface EqBand {
  id: number        // 0–59 (60 bands total)
  enabled: boolean
  frequency: number   // 20–20000 Hz
  gainDb: number      // -20 to +20 dB
  q: number           // 0.1 – 30
  type: EqFilterType
}

export interface EqPreset {
  id: string
  name: string
  isSystem: boolean
  bands: EqBand[]
  preampDb: number    // -20 to +20 dB
}

export interface DspChainState {
  eqEnabled: boolean
  eqPresetId: string | null
  bands: EqBand[]
  preampDb: number

  crossfeedEnabled: boolean
  crossfeedLevel: number      // 0.0 – 1.0
  crossfeedCutoff: number     // Hz

  surroundEnabled: boolean
  surroundWidth: number       // 0.0 – 1.0

  ditherEnabled: boolean
  ditherType: 'rpdf' | 'tpdf' | 'shaped'
  noiseShapingProfile: 'none' | 'fweighted' | 'eweighted' | 'lipshitz' | 'wannamaker'

  compressorEnabled: boolean
  compressorThresholdDb: number
  compressorRatio: number
  compressorAttackMs: number
  compressorReleaseMs: number
  compressorKneeDb: number
  compressorMakeupDb: number

  stereoWidthEnabled: boolean
  stereoWidth: number         // 0.0 – 2.0

  replayGainMode: 'off' | 'track' | 'album'
  replayGainPreampDb: number

  sampleRateConversion: 'off' | 'on'
  targetSampleRate: number

  pitchSemitons: number       // -12 to +12
  tempoRatio: number          // 0.5 – 2.0
}

// ── FFT / Spectrogram ─────────────────────────
export interface FftFrame {
  channelIndex: number
  bins: Float32Array      // Magnitude in dB, size = fftSize/2
  timestamp: number       // Playback position ms
}

export interface SpectrogramConfig {
  fftSize: 1024 | 2048 | 4096 | 8192 | 16384
  hopSize: number
  window: 'hann' | 'kaiser' | 'blackman'
  minDb: number           // e.g. -120
  maxDb: number           // e.g. 0
  colorMap: 'viridis' | 'inferno' | 'magma' | 'plasma' | 'grayscale'
}

// ── Real-time Meters ──────────────────────────
export interface LevelMeter {
  channels: ChannelLevel[]
  timestamp: number
}

export interface ChannelLevel {
  index: number
  rmsDb: number
  peakDb: number
  lufsShortTerm: number
  lufsIntegrated: number
  truePeakDb: number
  clipping: boolean
}

// ── File Analysis ─────────────────────────────
export interface FileAnalysisResult {
  trackId: string
  analyzedAt: number

  // Bit depth
  declaredBitDepth: number
  effectiveBitDepth: number
  isFakeBitDepth: boolean
  lsbHistogram: number[]    // 256 buckets

  // Lossy detection
  isLossyTranscode: boolean
  lossyConfidence: number       // 0–100
  frequencyCutoffHz: number | null
  sbr: boolean
  verdict: 'lossless' | 'lossy' | 'suspect' | 'unknown'
  verdictExplanation: string

  // Dynamic range
  drValue: number               // TT DR
  lufsIntegrated: number
  lufsRange: number             // LRA
  truePeakDb: number
  crestFactorDb: number

  // Binary structure
  container: string
  chunks: BinaryChunk[]
}

export interface BinaryChunk {
  name: string
  offset: number
  size: number
  children?: BinaryChunk[]
  data?: Record<string, string | number | boolean>
}

export interface ChannelSpectrogram {
  channelIndex: number
  channelLabel: string    // 'L', 'R', 'C', etc.
  data: Float32Array      // Row-major, width=bins, height=frames
  width: number           // FFT bins
  height: number          // Time frames
}

// ── Mastering Comparison ──────────────────────
export interface MasteringComparison {
  trackA: AudioTrack
  trackB: AudioTrack
  lufsA: number
  lufsB: number
  drA: number
  drB: number
  lraA: number
  lraB: number
  ltas: Float32Array      // Long-term average spectrum diff (A - B)
  verdict: string
}

// ── Metadata / Auto-tagger ────────────────────
export interface TagSuggestion {
  source: 'acoustid' | 'musicbrainz' | 'manual'
  confidence: number        // 0–100
  title: string
  artist: string
  albumArtist: string
  album: string
  year: number | null
  trackNumber: number | null
  totalTracks: number | null
  discNumber: number | null
  genre: string
  label: string
  musicBrainzId: string
  artworkUrl: string | null
}

// ── ABX Blind Test ────────────────────────────
export interface AbxSession {
  id: string
  fileA: string
  fileB: string
  fileC?: string
  createdAt: number
  sealed: boolean           // true = true-blind (app doesn't know during test)
  totalTrials: number
  correctCount: number
  pValue: number | null
  confidencePct: number | null
}

export interface AbxTrial {
  id: string
  sessionId: string
  trialNumber: number
  xWasA: boolean | null   // null if sealed/unrevealed
  userGuessedA: boolean
  correct: boolean | null  // null if sealed
  responseTimeMs: number
}

// ── Gear Matching ─────────────────────────────
export interface GearProfile {
  id: string
  name: string
  brand: string
  type: 'iem' | 'headphone' | 'tws' | 'speaker'
  frFrequencies: number[]   // Hz
  frSpl: number[]           // dB SPL
  correctionPresetId: string | null
  source: 'autoeq' | 'crinacle' | 'oratory' | 'custom'
}

export type TargetCurve = 'harman2019' | 'harmanIE2019' | 'diffuseField' | 'freeField' | 'custom'

// ── Audio Recap / Stats ───────────────────────
export interface ListeningStats {
  totalMs: number
  topTracks: { track: AudioTrack; playCount: number; totalMs: number }[]
  topArtists: { artist: string; playCount: number; totalMs: number }[]
  topAlbums: { album: Album; playCount: number; totalMs: number }[]
  topGenres: { genre: string; playCount: number; totalMs: number }[]
  qualityBreakdown: QualityBucket[]
  hourlyHeatmap: number[]   // 24 values (hours of day)
  dailyHistory: { date: string; totalMs: number }[]
}

export interface QualityBucket {
  label: string             // e.g. "16/44.1 FLAC", "24/96 FLAC", "MP3"
  trackCount: number
  totalMs: number
}

// ── App Preferences ───────────────────────────
export interface AppPreferences {
  uiMode: UiMode
  colorScheme: ColorScheme
  accentColor: string | null    // Hex or null for auto

  // Library
  libraryPaths: string[]
  autoScan: boolean
  scanOnStartup: boolean

  // Audio output
  defaultDeviceId: string | null
  exclusiveMode: boolean
  bitPerfect: boolean
  bufferMs: number

  // DSP defaults
  dsp: DspChainState

  // Gear
  activeGearProfileId: string | null
  activeTargetCurve: TargetCurve

  // Playback
  crossfadeDurationMs: number
  gapless: boolean
  replayGainMode: 'off' | 'track' | 'album'
}
