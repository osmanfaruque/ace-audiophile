/**
 * Audiophile Ace — Audio Engine Bridge
 * lib/audioEngine.ts
 *
 * This module provides a unified interface to the C++ audio engine
 * running in the Tauri Rust backend.
 *
 * All calls go through Tauri's `invoke()` IPC mechanism.
 * Real-time data (FFT frames, level meters) arrive via Tauri events.
 *
 * The singleton pattern ensures one engine instance per app session.
 */

import type {
  DspChainState,
  AudioDevice,
  FftFrame,
  LevelMeter,
  AudioTrack,
  FileAnalysisResult,
  EqBand,
  MasteringComparisonResult,
} from '@ace/types'

// Dynamically imported to avoid build errors in non-Tauri environments
let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null
let tauriListen: (<T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>) | null = null

async function loadTauri() {
  if (tauriInvoke) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const { listen } = await import('@tauri-apps/api/event')
    tauriInvoke = invoke
    tauriListen = listen
  } catch {
    console.warn('[AudioEngine] Tauri APIs not available — running in browser/mock mode')
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await loadTauri()
  if (!tauriInvoke) {
    console.warn(`[AudioEngine] Mock invoke: ${cmd}`, args)
    return undefined as T
  }
  return tauriInvoke(cmd, args) as Promise<T>
}

async function listen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<() => void> {
  await loadTauri()
  if (!tauriListen) {
    return () => {}
  }
  return tauriListen<T>(event, (e) => handler(e.payload as T))
}

// ─────────────────────────────────────────────────────────────
//  Raw event payloads from Rust bridge (snake_case)
// ─────────────────────────────────────────────────────────────
interface RustFftFrameEvent {
  bins_l: number[]
  bins_r: number[]
  timestamp_ms: number
}

interface RustLevelMeterEvent {
  peak_l_db: number
  peak_r_db: number
  rms_l_db: number
  rms_r_db: number
  lufs_integrated: number
}

interface RustPositionEvent {
  position_ms: number
}

interface RustTrackInfo {
  file_path: string
  codec: string
  sample_rate: number
  bit_depth: number
  channels: number
  duration_ms: number
}

interface RustScanProgress {
  file: string
  count: number
}

interface RustScanComplete {
  total: number
  folder: string
}

export interface MetadataWritePayload {
  filePath: string
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  comment: string
  year: number
  trackNumber: number
  trackTotal: number
  discNumber: number
  discTotal: number
}

export interface AutoTagCandidate {
  id: string
  title: string
  artist: string
  album: string
  year: string
  score: number
}

export interface SchemaVersion {
  version: number
  description: string
  appliedAt: number
}

export interface DbExportResult {
  json: string
  outputPath?: string | null
}

export interface DbPlaylistEntry {
  id: string
  name: string
  description: string
  createdAt: number
  modifiedAt: number
  trackCount: number
  isSmartPlaylist: boolean
  rulesJson?: string | null
  trackPaths: string[]
}

export interface DbTrackRecord {
  id: string
  filePath: string
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
  durationMs: number
  sampleRate: number
  bitDepth: number
  channels: number
  codec: string
  bitrateKbps: number
  fileSizeBytes: number
  playCount: number
  albumArtPath?: string | null
}

export interface LibrarySqlQuery {
  search?: string
  mode?: string
  activeFilter?: string | null
  sortKey?: string
  sortDir?: 'asc' | 'desc'
}

export interface RadioStationSearchQuery {
  name?: string
  genre?: string
  country?: string
  limit?: number
}

export interface RadioStation {
  stationuuid: string
  name: string
  country: string
  language: string
  tags: string
  bitrate: number
  favicon: string
  url: string
  urlResolved: string
  homepage: string
  codec: string
  votes: number
  clickcount: number
  isFavorite: boolean
  lastPlayedAt: number | null
  lastClickedAt: number | null
}

export interface RadioFacet {
  name: string
  stationcount: number
}

// ─────────────────────────────────────────────────────────────
//  Engine Interface
// ─────────────────────────────────────────────────────────────
export interface IAudioEngine {
  // Lifecycle
  initialize(): Promise<void>
  destroy(): Promise<void>

  // Playback (A3.1.1)
  openTrack(trackId: string): Promise<void>
  openFile(filePath: string): Promise<RustTrackInfo>
  play(): Promise<void>
  pause(): void
  stop(): void
  seek(positionMs: number): void
  /** Accepts linear 0–1 volume; converted to dB for the engine */
  setVolume(volume: number): void

  // DSP (A3.1.2)
  setEqBand(band: number, freq: number, gainDb: number, q: number): void
  setDspState(state: DspChainState): void

  // Devices (A3.1.3)
  listDevices(): Promise<AudioDevice[]>
  setOutputDevice(deviceId: string): Promise<void>

  // Analysis (A3.1.4)
  analyzeFile(filePath: string): Promise<FileAnalysisResult>
  fitAutoEqBands(
    measuredFreqHz: number[],
    measuredSplDb: number[],
    targetFreqHz: number[],
    targetSplDb: number[],
    bandCount?: number,
  ): Promise<EqBand[]>
  compareMastering(fileA: string, fileB: string): Promise<MasteringComparisonResult>
  generateSpectrogram(filePath: string, channelIndex: number): Promise<Float32Array>

  // Metadata (A4.3.1)
  writeMetadata(payload: MetadataWritePayload): Promise<void>

  // AutoTag (A4.3.2 / A4.3.3 / A4.3.4)
  lookupAcoustId(filePath: string): Promise<AutoTagCandidate[]>
  searchMusicBrainz(query: string): Promise<AutoTagCandidate[]>
  fetchAndEmbedCoverArt(filePath: string, releaseMbid: string): Promise<void>

  // DB infra (A5.2.1 / A5.2.2)
  getSchemaVersions(): Promise<SchemaVersion[]>
  exportDatabaseAsJson(outputPath?: string): Promise<DbExportResult>

  // DB view wiring (A5.3)
  scanAndIndexFolder(path: string): Promise<number>
  indexFilePaths(paths: string[]): Promise<number>
  queryLibraryTracks(query: LibrarySqlQuery): Promise<DbTrackRecord[]>
  loadPlaylists(): Promise<DbPlaylistEntry[]>
  savePlaylists(entries: DbPlaylistEntry[]): Promise<void>
  setRating(trackId: string, stars: number): Promise<void>
  getRatings(): Promise<Array<{ trackId: string; stars: number }>>
  logListeningEvent(trackId: string, startedAt: number, endedAt: number | null, completed: boolean): Promise<void>
  getRecapStats(year: number): Promise<unknown>
  getAlbumArtPath(trackId: string): Promise<string | null>

  // Radio Browser API (A6.2)
  searchRadioStations(query: RadioStationSearchQuery): Promise<RadioStation[]>
  getRadioTags(): Promise<RadioFacet[]>
  getRadioCountries(): Promise<RadioFacet[]>
  reportRadioStationClick(stationuuid: string): Promise<void>
  cacheRadioStations(stations: RadioStation[]): Promise<number>
  setFavoriteRadioStation(station: RadioStation, isFavorite: boolean): Promise<void>
  markRecentRadioStation(station: RadioStation): Promise<void>
  loadFavoriteRadioStations(): Promise<RadioStation[]>
  loadRecentRadioStations(limit?: number): Promise<RadioStation[]>

  // Scanning (A3.1.5)
  scanFolder(path: string, onProgress?: (file: string, count: number) => void): Promise<number>

  // File-system watcher (A4.1.2)
  startWatcher(paths: string[]): Promise<void>
  stopWatcher(): Promise<void>
  onFsChange(handler: (event: { kind: string; path: string }) => void): Promise<() => void>
  onScanComplete(handler: (event: { total: number; folder: string }) => void): Promise<() => void>

  // Real-time event subscriptions
  onFftFrame(handler: (frame: FftFrame) => void): Promise<() => void>
  onLevelMeter(handler: (meter: LevelMeter) => void): Promise<() => void>
  onPositionUpdate(handler: (positionMs: number) => void): Promise<() => void>
  onTrackChange(handler: (track: AudioTrack | null) => void): Promise<() => void>
  onError(handler: (error: string) => void): Promise<() => void>
}

// ─────────────────────────────────────────────────────────────
//  Tauri Implementation
// ─────────────────────────────────────────────────────────────
class TauriAudioEngine implements IAudioEngine {
  async initialize() {
    await invoke('ace_engine_init')
  }

  async destroy() {
    await invoke('ace_engine_destroy')
  }

  // ── A3.1.1 — Playback ─────────────────────────────────

  async openTrack(trackId: string) {
    await invoke('ace_open_track', { trackId })
  }

  async openFile(filePath: string): Promise<RustTrackInfo> {
    return invoke<RustTrackInfo>('ace_open_file', { filePath })
  }

  async play() {
    await invoke('ace_play')
  }

  pause() {
    invoke('ace_pause').catch(console.error)
  }

  stop() {
    invoke('ace_stop').catch(console.error)
  }

  seek(positionMs: number) {
    invoke('ace_seek', { positionMs }).catch(console.error)
  }

  setVolume(volume: number) {
    // Convert linear 0–1 to dB (Rust engine expects dB)
    const db = volume > 0 ? 20 * Math.log10(volume) : -100
    invoke('ace_set_volume', { db }).catch(console.error)
  }

  // ── A3.1.2 — DSP ──────────────────────────────────────

  setEqBand(band: number, freq: number, gainDb: number, q: number) {
    invoke('ace_set_eq_band', { band, freq, gainDb, q }).catch(console.error)
  }

  setDspState(state: DspChainState) {
    invoke('ace_set_dsp_state', { state }).catch(console.error)
  }

  // ── A3.1.3 — Devices ──────────────────────────────────

  async listDevices(): Promise<AudioDevice[]> {
    return invoke<AudioDevice[]>('ace_list_devices')
  }

  async setOutputDevice(deviceId: string) {
    await invoke('ace_set_output_device', { deviceId })
  }

  // ── A3.1.4 — Analysis ─────────────────────────────────

  async analyzeFile(filePath: string): Promise<FileAnalysisResult> {
    return invoke<FileAnalysisResult>('ace_analyze_file', { filePath })
  }

  async fitAutoEqBands(
    measuredFreqHz: number[],
    measuredSplDb: number[],
    targetFreqHz: number[],
    targetSplDb: number[],
    bandCount = 60,
  ): Promise<EqBand[]> {
    const rows = await invoke<Array<{
      freq_hz: number
      gain_db: number
      q: number
      enabled: boolean
      filter_type: number
    }>>('ace_autoeq_fit', {
      measuredFreqHz,
      measuredSplDb,
      targetFreqHz,
      targetSplDb,
      bandCount,
    })

    return rows.map((row, i) => ({
      id: i,
      frequency: row.freq_hz,
      gainDb: row.gain_db,
      q: row.q,
      enabled: row.enabled,
      type: 'peaking',
    }))
  }

  async compareMastering(fileA: string, fileB: string): Promise<MasteringComparisonResult> {
    const raw = await invoke<{
      time_offset_ms: number
      dr_a: number
      dr_b: number
      lufs_a: number
      lufs_b: number
      true_peak_a: number
      true_peak_b: number
      spectral_delta_db: number[]
    }>('ace_compare_mastering', { fileA, fileB })

    return {
      timeOffsetMs: raw.time_offset_ms,
      drA: raw.dr_a,
      drB: raw.dr_b,
      lufsA: raw.lufs_a,
      lufsB: raw.lufs_b,
      truePeakA: raw.true_peak_a,
      truePeakB: raw.true_peak_b,
      spectralDeltaDb: raw.spectral_delta_db,
    }
  }

  async generateSpectrogram(filePath: string, channelIndex: number): Promise<Float32Array> {
    const raw = await invoke<number[]>('ace_generate_spectrogram', { filePath, channelIndex })
    return new Float32Array(raw)
  }

  async writeMetadata(payload: MetadataWritePayload) {
    await invoke('ace_write_metadata', {
      payload: {
        file_path: payload.filePath,
        title: payload.title,
        artist: payload.artist,
        album_artist: payload.albumArtist,
        album: payload.album,
        genre: payload.genre,
        comment: payload.comment,
        year: payload.year,
        track_number: payload.trackNumber,
        track_total: payload.trackTotal,
        disc_number: payload.discNumber,
        disc_total: payload.discTotal,
      },
    })
  }

  async lookupAcoustId(filePath: string): Promise<AutoTagCandidate[]> {
    return invoke<AutoTagCandidate[]>('ace_acoustid_lookup', { filePath })
  }

  async searchMusicBrainz(query: string): Promise<AutoTagCandidate[]> {
    return invoke<AutoTagCandidate[]>('ace_musicbrainz_search', { query })
  }

  async fetchAndEmbedCoverArt(filePath: string, releaseMbid: string) {
    await invoke('ace_fetch_embed_cover_art', { filePath, releaseMbid })
  }

  async getSchemaVersions(): Promise<SchemaVersion[]> {
    const rows = await invoke<Array<{ version: number; description: string; applied_at: number }>>('ace_get_schema_versions')
    return rows.map((row) => ({
      version: row.version,
      description: row.description,
      appliedAt: row.applied_at,
    }))
  }

  async exportDatabaseAsJson(outputPath?: string): Promise<DbExportResult> {
    const payload = await invoke<{ json: string; output_path?: string | null }>('ace_export_db_json', {
      outputPath,
    })
    return {
      json: payload.json,
      outputPath: payload.output_path ?? null,
    }
  }

  async scanAndIndexFolder(path: string): Promise<number> {
    return invoke<number>('ace_scan_index_folder', { path })
  }

  async indexFilePaths(paths: string[]): Promise<number> {
    return invoke<number>('ace_index_file_paths', { paths })
  }

  async queryLibraryTracks(query: LibrarySqlQuery): Promise<DbTrackRecord[]> {
    const rows = await invoke<Array<{
      id: string
      file_path: string
      title: string
      artist: string
      album_artist: string
      album: string
      genre: string
      year: number | null
      track_number: number | null
      total_tracks: number | null
      disc_number: number | null
      total_discs: number | null
      comment: string
      duration_ms: number
      sample_rate: number
      bit_depth: number
      channels: number
      codec: string
      bitrate_kbps: number
      file_size_bytes: number
      play_count: number
      album_art_path?: string | null
    }>>('ace_query_library_tracks', {
      query: {
        search: query.search,
        mode: query.mode,
        active_filter: query.activeFilter ?? undefined,
        sort_key: query.sortKey,
        sort_dir: query.sortDir,
      },
    })

    return rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      title: r.title,
      artist: r.artist,
      albumArtist: r.album_artist,
      album: r.album,
      genre: r.genre,
      year: r.year,
      trackNumber: r.track_number,
      totalTracks: r.total_tracks,
      discNumber: r.disc_number,
      totalDiscs: r.total_discs,
      comment: r.comment,
      durationMs: r.duration_ms,
      sampleRate: r.sample_rate,
      bitDepth: r.bit_depth,
      channels: r.channels,
      codec: r.codec,
      bitrateKbps: r.bitrate_kbps,
      fileSizeBytes: r.file_size_bytes,
      playCount: r.play_count,
      albumArtPath: r.album_art_path ?? null,
    }))
  }

  async loadPlaylists(): Promise<DbPlaylistEntry[]> {
    const rows = await invoke<Array<{
      id: string
      name: string
      description: string
      created_at: number
      modified_at: number
      track_count: number
      is_smart_playlist: boolean
      rules_json?: string | null
      track_paths: string[]
    }>>('ace_load_playlists')
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
      modifiedAt: r.modified_at,
      trackCount: r.track_count,
      isSmartPlaylist: r.is_smart_playlist,
      rulesJson: r.rules_json ?? null,
      trackPaths: r.track_paths,
    }))
  }

  async savePlaylists(entries: DbPlaylistEntry[]): Promise<void> {
    await invoke('ace_save_playlists', {
      entries: entries.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        created_at: e.createdAt,
        modified_at: e.modifiedAt,
        track_count: e.trackCount,
        is_smart_playlist: e.isSmartPlaylist,
        rules_json: e.rulesJson ?? null,
        track_paths: e.trackPaths,
      })),
    })
  }

  async setRating(trackId: string, stars: number): Promise<void> {
    await invoke('ace_set_rating', { trackId, stars })
  }

  async getRatings(): Promise<Array<{ trackId: string; stars: number }>> {
    const rows = await invoke<Array<{ track_id: string; stars: number }>>('ace_get_ratings')
    return rows.map((r) => ({ trackId: r.track_id, stars: r.stars }))
  }

  async logListeningEvent(trackId: string, startedAt: number, endedAt: number | null, completed: boolean): Promise<void> {
    await invoke('ace_log_listening_event', {
      trackId,
      startedAt,
      endedAt,
      completed,
    })
  }

  async getRecapStats(year: number): Promise<unknown> {
    return invoke<unknown>('ace_get_recap_stats', { year })
  }

  async getAlbumArtPath(trackId: string): Promise<string | null> {
    return invoke<string | null>('ace_get_album_art_path', { trackId })
  }

  async searchRadioStations(query: RadioStationSearchQuery): Promise<RadioStation[]> {
    const rows = await invoke<Array<{
      stationuuid: string
      name: string
      country: string
      language: string
      tags: string
      bitrate: number
      favicon: string
      url: string
      url_resolved: string
      homepage: string
      codec: string
      votes: number
      clickcount: number
    }>>('ace_radio_search_stations', {
      query: {
        name: query.name,
        genre: query.genre,
        country: query.country,
        limit: query.limit,
      },
    })

    return rows.map((r) => ({
      stationuuid: r.stationuuid,
      name: r.name,
      country: r.country,
      language: r.language,
      tags: r.tags,
      bitrate: r.bitrate,
      favicon: r.favicon,
      url: r.url,
      urlResolved: r.url_resolved,
      homepage: r.homepage,
      codec: r.codec,
      votes: r.votes,
      clickcount: r.clickcount,
      isFavorite: false,
      lastPlayedAt: null,
      lastClickedAt: null,
    }))
  }

  async getRadioTags(): Promise<RadioFacet[]> {
    return invoke<RadioFacet[]>('ace_radio_get_tags')
  }

  async getRadioCountries(): Promise<RadioFacet[]> {
    return invoke<RadioFacet[]>('ace_radio_get_countries')
  }

  async reportRadioStationClick(stationuuid: string): Promise<void> {
    await invoke('ace_radio_report_click', { stationuuid })
  }

  async cacheRadioStations(stations: RadioStation[]): Promise<number> {
    return invoke<number>('ace_radio_cache_stations', {
      stations: stations.map((s) => ({
        stationuuid: s.stationuuid,
        name: s.name,
        country: s.country,
        language: s.language,
        tags: s.tags,
        bitrate: s.bitrate,
        favicon: s.favicon,
        url: s.url,
        url_resolved: s.urlResolved,
        homepage: s.homepage,
        codec: s.codec,
        votes: s.votes,
        clickcount: s.clickcount,
        is_favorite: s.isFavorite,
        last_played_at: s.lastPlayedAt,
        last_clicked_at: s.lastClickedAt,
      })),
    })
  }

  async setFavoriteRadioStation(station: RadioStation, isFavorite: boolean): Promise<void> {
    await invoke('ace_radio_set_favorite', {
      station: {
        stationuuid: station.stationuuid,
        name: station.name,
        country: station.country,
        language: station.language,
        tags: station.tags,
        bitrate: station.bitrate,
        favicon: station.favicon,
        url: station.url,
        url_resolved: station.urlResolved,
        homepage: station.homepage,
        codec: station.codec,
        votes: station.votes,
        clickcount: station.clickcount,
        is_favorite: station.isFavorite,
        last_played_at: station.lastPlayedAt,
        last_clicked_at: station.lastClickedAt,
      },
      isFavorite,
    })
  }

  async markRecentRadioStation(station: RadioStation): Promise<void> {
    await invoke('ace_radio_mark_recent', {
      station: {
        stationuuid: station.stationuuid,
        name: station.name,
        country: station.country,
        language: station.language,
        tags: station.tags,
        bitrate: station.bitrate,
        favicon: station.favicon,
        url: station.url,
        url_resolved: station.urlResolved,
        homepage: station.homepage,
        codec: station.codec,
        votes: station.votes,
        clickcount: station.clickcount,
        is_favorite: station.isFavorite,
        last_played_at: station.lastPlayedAt,
        last_clicked_at: station.lastClickedAt,
      },
    })
  }

  async loadFavoriteRadioStations(): Promise<RadioStation[]> {
    const rows = await invoke<Array<{
      stationuuid: string
      name: string
      country: string
      language: string
      tags: string
      bitrate: number
      favicon: string
      url: string
      url_resolved: string
      homepage: string
      codec: string
      votes: number
      clickcount: number
      is_favorite: boolean
      last_played_at: number | null
      last_clicked_at: number | null
    }>>('ace_radio_load_favorites')

    return rows.map((r) => ({
      stationuuid: r.stationuuid,
      name: r.name,
      country: r.country,
      language: r.language,
      tags: r.tags,
      bitrate: r.bitrate,
      favicon: r.favicon,
      url: r.url,
      urlResolved: r.url_resolved,
      homepage: r.homepage,
      codec: r.codec,
      votes: r.votes,
      clickcount: r.clickcount,
      isFavorite: r.is_favorite,
      lastPlayedAt: r.last_played_at ?? null,
      lastClickedAt: r.last_clicked_at ?? null,
    }))
  }

  async loadRecentRadioStations(limit = 30): Promise<RadioStation[]> {
    const rows = await invoke<Array<{
      stationuuid: string
      name: string
      country: string
      language: string
      tags: string
      bitrate: number
      favicon: string
      url: string
      url_resolved: string
      homepage: string
      codec: string
      votes: number
      clickcount: number
      is_favorite: boolean
      last_played_at: number | null
      last_clicked_at: number | null
    }>>('ace_radio_load_recents', { limit })

    return rows.map((r) => ({
      stationuuid: r.stationuuid,
      name: r.name,
      country: r.country,
      language: r.language,
      tags: r.tags,
      bitrate: r.bitrate,
      favicon: r.favicon,
      url: r.url,
      urlResolved: r.url_resolved,
      homepage: r.homepage,
      codec: r.codec,
      votes: r.votes,
      clickcount: r.clickcount,
      isFavorite: r.is_favorite,
      lastPlayedAt: r.last_played_at ?? null,
      lastClickedAt: r.last_clicked_at ?? null,
    }))
  }

  // ── A3.1.5 — Folder scanning ──────────────────────────

  async scanFolder(
    path: string,
    onProgress?: (file: string, count: number) => void
  ): Promise<number> {
    let unlistenProgress: (() => void) | undefined
    let unlistenComplete: (() => void) | undefined

    if (onProgress) {
      unlistenProgress = await listen<RustScanProgress>(
        'ace://scan-progress',
        (p) => onProgress(p.file, p.count)
      )
    }

    try {
      const total = await invoke<number>('ace_scan_folder', { path })
      return total
    } finally {
      unlistenProgress?.()
      unlistenComplete?.()
    }
  }

  // ── A4.1.2 — File-system watcher ──────────────────────────

  async startWatcher(paths: string[]) {
    await invoke('ace_start_watcher', { paths })
  }

  async stopWatcher() {
    await invoke('ace_stop_watcher')
  }

  onFsChange(handler: (event: { kind: string; path: string }) => void) {
    return listen<{ kind: string; path: string }>('ace://fs-change', handler)
  }

  onScanComplete(handler: (event: { total: number; folder: string }) => void) {
    return listen<{ total: number; folder: string }>('ace://scan-complete', handler)
  }

  // ── Real-time events ─────────────────────────────────────

  onFftFrame(handler: (frame: FftFrame) => void) {
    return listen<RustFftFrameEvent>('ace://fft-frame', (raw) => {
      handler({
        channelIndex: 0,
        bins: new Float32Array(raw.bins_l),
        timestamp: raw.timestamp_ms,
        // Also expose right channel for stereo views
        ...(raw.bins_r && { binsR: new Float32Array(raw.bins_r) }),
      } as FftFrame)
    })
  }

  onLevelMeter(handler: (meter: LevelMeter) => void) {
    return listen<RustLevelMeterEvent>('ace://level-meter', (raw) => {
      handler({
        channels: [
          { index: 0, peakDb: raw.peak_l_db, rmsDb: raw.rms_l_db, lufsShortTerm: 0, lufsIntegrated: raw.lufs_integrated, truePeakDb: raw.peak_l_db, clipping: raw.peak_l_db >= 0 },
          { index: 1, peakDb: raw.peak_r_db, rmsDb: raw.rms_r_db, lufsShortTerm: 0, lufsIntegrated: raw.lufs_integrated, truePeakDb: raw.peak_r_db, clipping: raw.peak_r_db >= 0 },
        ],
        timestamp: Date.now(),
      })
    })
  }

  onPositionUpdate(handler: (positionMs: number) => void) {
    return listen<RustPositionEvent>('ace://position-update', (raw) => {
      handler(raw.position_ms)
    })
  }

  onTrackChange(handler: (track: AudioTrack | null) => void) {
    return listen<RustTrackInfo | null>('ace://track-change', (raw) => {
      if (!raw) {
        handler(null)
        return
      }
      // Map RustTrackInfo → minimal AudioTrack for the store
      handler({
        id: raw.file_path,
        filePath: raw.file_path,
        title: raw.file_path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Unknown',
        artist: '',
        albumArtist: '',
        album: '',
        genre: '',
        year: null,
        trackNumber: null,
        totalTracks: null,
        discNumber: null,
        totalDiscs: null,
        comment: '',
        durationMs: raw.duration_ms,
        sampleRate: raw.sample_rate,
        bitDepth: raw.bit_depth,
        channels: raw.channels,
        codec: raw.codec as AudioTrack['codec'],
        bitrateKbps: 0,
        fileSizeBytes: 0,
        effectiveBitDepth: null,
        dynamicRange: null,
        lufs: null,
        truePeak: null,
        isLossyTranscode: null,
        lossyConfidence: null,
        replayGainTrack: null,
        replayGainAlbum: null,
        musicBrainzId: null,
        acoustId: null,
        albumId: '',
        dateAdded: Date.now(),
        dateModified: Date.now(),
        lastPlayed: null,
        playCount: 0,
      })
    })
  }

  onError(handler: (error: string) => void) {
    return listen<{ message: string }>('ace://engine-error', (raw) => {
      handler(raw.message)
    })
  }
}

// ─────────────────────────────────────────────────────────────
//  Singleton
// ─────────────────────────────────────────────────────────────
let _engine: IAudioEngine | null = null

export function getAudioEngine(): IAudioEngine {
  if (!_engine) {
    _engine = new TauriAudioEngine()
  }
  return _engine
}
