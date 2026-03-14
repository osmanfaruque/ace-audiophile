'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe2, Heart, ListFilter, Loader2, Play, RadioTower, RotateCcw, Search, Signal, Star } from 'lucide-react'
import { getAudioEngine, type RadioFacet, type RadioStation } from '@/lib/audioEngine'

type SidebarTab = 'favorites' | 'recents' | 'genres'

const CARD_HEIGHT = 186
const CARD_GAP = 12
const OVERSCAN_ROWS = 2

function useVirtualRows(totalItems: number, columns: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(640)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver(() => {
      setHeight(el.clientHeight)
    })
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const rowHeight = CARD_HEIGHT + CARD_GAP
  const totalRows = Math.ceil(totalItems / columns)
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS)
  const endRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN_ROWS,
  )

  return {
    ref,
    rowHeight,
    totalRows,
    startRow,
    endRow,
    onScroll: (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop),
  }
}

function getDisplayUrl(station: RadioStation): string {
  return station.urlResolved || station.url
}

export function RadioView() {
  const [tab, setTab] = useState<SidebarTab>('favorites')
  const [query, setQuery] = useState('')
  const [genreQuery, setGenreQuery] = useState('')
  const [country, setCountry] = useState('')
  const [language, setLanguage] = useState('')
  const [minBitrate, setMinBitrate] = useState(0)

  const [loadingStations, setLoadingStations] = useState(false)
  const [loadingFacets, setLoadingFacets] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [browseStations, setBrowseStations] = useState<RadioStation[]>([])
  const [favoriteStations, setFavoriteStations] = useState<RadioStation[]>([])
  const [recentStations, setRecentStations] = useState<RadioStation[]>([])
  const [tags, setTags] = useState<RadioFacet[]>([])
  const [countries, setCountries] = useState<RadioFacet[]>([])

  const [activeStationUuid, setActiveStationUuid] = useState<string | null>(null)
  const [nowPlaying, setNowPlaying] = useState<RadioStation | null>(null)
  const [icyTitle, setIcyTitle] = useState<string>('Not available yet')

  const columns = 4

  const activeCollection = useMemo(() => {
    if (tab === 'favorites') return favoriteStations
    if (tab === 'recents') return recentStations
    return browseStations
  }, [tab, favoriteStations, recentStations, browseStations])

  const filteredStations = useMemo(() => {
    const q = query.trim().toLowerCase()
    const l = language.trim().toLowerCase()
    const c = country.trim().toLowerCase()

    return activeCollection.filter((s) => {
      if (q && !`${s.name} ${s.tags} ${s.country}`.toLowerCase().includes(q)) return false
      if (genreQuery && !s.tags.toLowerCase().includes(genreQuery.toLowerCase())) return false
      if (c && !s.country.toLowerCase().includes(c)) return false
      if (l && !s.language.toLowerCase().includes(l)) return false
      if (minBitrate > 0 && (s.bitrate || 0) < minBitrate) return false
      return true
    })
  }, [activeCollection, query, genreQuery, country, language, minBitrate])

  const {
    ref: gridRef,
    rowHeight,
    totalRows,
    startRow,
    endRow,
    onScroll,
  } = useVirtualRows(filteredStations.length, columns)

  const visibleStations = useMemo(() => {
    const startIndex = startRow * columns
    const endIndex = Math.min(filteredStations.length, endRow * columns)
    return {
      startIndex,
      stations: filteredStations.slice(startIndex, endIndex),
      topPad: startRow * rowHeight,
      bottomPad: Math.max(0, (totalRows - endRow) * rowHeight),
    }
  }, [columns, endRow, filteredStations, rowHeight, startRow, totalRows])

  const favoriteSet = useMemo(() => new Set(favoriteStations.map((s) => s.stationuuid)), [favoriteStations])

  const hydrateCollections = async () => {
    const engine = getAudioEngine()
    const [fav, rec] = await Promise.all([
      engine.loadFavoriteRadioStations(),
      engine.loadRecentRadioStations(50),
    ])
    setFavoriteStations(fav)
    setRecentStations(rec)
  }

  const hydrateFacets = async () => {
    setLoadingFacets(true)
    try {
      const engine = getAudioEngine()
      const [t, c] = await Promise.all([engine.getRadioTags(), engine.getRadioCountries()])
      setTags(t)
      setCountries(c)
    } finally {
      setLoadingFacets(false)
    }
  }

  const searchStations = async (initial = false) => {
    setLoadingStations(true)
    setError(null)
    try {
      const engine = getAudioEngine()
      const rows = await engine.searchRadioStations({
        name: query || undefined,
        genre: genreQuery || undefined,
        country: country || undefined,
        limit: 160,
      })

      const merged = rows.map((s) => ({
        ...s,
        isFavorite: favoriteSet.has(s.stationuuid),
      }))

      setBrowseStations(merged)
      await engine.cacheRadioStations(merged)

      if (initial && !nowPlaying && merged.length > 0) {
        setNowPlaying(merged[0])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch stations')
    } finally {
      setLoadingStations(false)
    }
  }

  useEffect(() => {
    hydrateCollections().catch(() => {})
    hydrateFacets().catch(() => {})
    searchStations(true).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshAll = async () => {
    await Promise.all([hydrateCollections(), hydrateFacets(), searchStations(false)])
  }

  const playStation = async (station: RadioStation) => {
    try {
      const engine = getAudioEngine()
      const url = getDisplayUrl(station)
      if (!url) {
        setError('Station has no playable URL')
        return
      }

      await engine.openFile(url)
      await engine.play()
      await engine.reportRadioStationClick(station.stationuuid).catch(() => {})
      await engine.markRecentRadioStation(station).catch(() => {})

      setActiveStationUuid(station.stationuuid)
      setNowPlaying(station)
      setIcyTitle(`Live: ${station.name}`)

      const recents = await engine.loadRecentRadioStations(50)
      setRecentStations(recents)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start station')
    }
  }

  const toggleFavorite = async (station: RadioStation) => {
    const next = !favoriteSet.has(station.stationuuid)
    const engine = getAudioEngine()
    await engine.setFavoriteRadioStation(station, next)
    const fav = await engine.loadFavoriteRadioStations()
    setFavoriteStations(fav)

    setBrowseStations((prev) =>
      prev.map((row) => (row.stationuuid === station.stationuuid ? { ...row, isFavorite: next } : row)),
    )
    setRecentStations((prev) =>
      prev.map((row) => (row.stationuuid === station.stationuuid ? { ...row, isFavorite: next } : row)),
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 px-3 py-2 lg:px-4">
      <section
        className="rounded-xl border px-4 py-3"
        style={{
          borderColor: 'var(--ace-border)',
          background:
            'linear-gradient(135deg, color-mix(in srgb, var(--ace-accent) 18%, transparent), color-mix(in srgb, var(--ace-bg-elevated) 92%, transparent))',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--ace-text-muted)' }}>
              Now Playing Banner
            </p>
            <h2 className="truncate text-lg font-semibold" style={{ color: 'var(--ace-text-primary)' }}>
              {nowPlaying?.name || 'No station selected'}
            </h2>
            <p className="truncate text-sm" style={{ color: 'var(--ace-text-secondary)' }}>
              ICY: {icyTitle}
            </p>
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--ace-text-muted)' }}>
              {nowPlaying ? `${nowPlaying.country} · ${nowPlaying.language || 'Unknown language'} · ${nowPlaying.bitrate || 0} kbps` : 'Pick a station to start streaming'}
            </p>
          </div>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
            style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-primary)' }}
            onClick={refreshAll}
          >
            <RotateCcw size={14} /> Refresh
          </button>
        </div>
      </section>

      <section
        className="rounded-xl border p-3"
        style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
      >
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <label className="flex items-center gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--ace-border)' }}>
            <Search size={14} style={{ color: 'var(--ace-text-muted)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search station name"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>

          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg)' }}
          >
            <option value="">Country</option>
            {countries.slice(0, 120).map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>

          <label className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--ace-border)' }}>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="Language"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>

          <select
            value={genreQuery}
            onChange={(e) => setGenreQuery(e.target.value)}
            className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg)' }}
          >
            <option value="">Genre</option>
            {tags.slice(0, 120).map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>

          <label className="flex items-center gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--ace-border)' }}>
            <Signal size={14} style={{ color: 'var(--ace-text-muted)' }} />
            <input
              type="number"
              min={0}
              step={16}
              value={minBitrate}
              onChange={(e) => setMinBitrate(Number(e.target.value || 0))}
              className="w-full bg-transparent text-sm outline-none"
              placeholder="Min kbps"
            />
          </label>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>
            {loadingFacets ? 'Loading filters...' : 'Search + filter bar ready'}
          </p>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: 'var(--ace-border)' }}
            onClick={() => searchStations(false)}
          >
            <ListFilter size={13} /> Apply
          </button>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside
          className="rounded-xl border p-2"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
        >
          <p className="px-2 pb-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--ace-text-muted)' }}>
            Sidebar Tabs
          </p>

          <button
            className="mb-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm"
            style={{
              background: tab === 'favorites' ? 'color-mix(in srgb, var(--ace-accent) 20%, transparent)' : 'transparent',
              color: tab === 'favorites' ? 'var(--ace-accent)' : 'var(--ace-text-primary)',
            }}
            onClick={() => setTab('favorites')}
          >
            <span className="inline-flex items-center gap-2"><Heart size={14} /> Favorites</span>
            <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>{favoriteStations.length}</span>
          </button>

          <button
            className="mb-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm"
            style={{
              background: tab === 'recents' ? 'color-mix(in srgb, var(--ace-accent) 20%, transparent)' : 'transparent',
              color: tab === 'recents' ? 'var(--ace-accent)' : 'var(--ace-text-primary)',
            }}
            onClick={() => setTab('recents')}
          >
            <span className="inline-flex items-center gap-2"><RadioTower size={14} /> Recents</span>
            <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>{recentStations.length}</span>
          </button>

          <button
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm"
            style={{
              background: tab === 'genres' ? 'color-mix(in srgb, var(--ace-accent) 20%, transparent)' : 'transparent',
              color: tab === 'genres' ? 'var(--ace-accent)' : 'var(--ace-text-primary)',
            }}
            onClick={() => setTab('genres')}
          >
            <span className="inline-flex items-center gap-2"><Globe2 size={14} /> Browse by genre</span>
            <span className="text-xs" style={{ color: 'var(--ace-text-muted)' }}>{tags.length}</span>
          </button>
        </aside>

        <div
          ref={gridRef}
          onScroll={onScroll}
          className="min-h-0 overflow-y-auto rounded-xl border p-3"
          style={{ borderColor: 'var(--ace-border)', background: 'var(--ace-bg)' }}
        >
          {loadingStations ? (
            <div className="flex h-full min-h-70 items-center justify-center">
              <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--ace-text-muted)' }}>
                <Loader2 size={16} className="animate-spin" /> Loading stations...
              </div>
            </div>
          ) : filteredStations.length === 0 ? (
            <div className="flex h-full min-h-70 items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--ace-text-muted)' }}>
                {error || 'No station matched your filters'}
              </p>
            </div>
          ) : (
            <>
              <div style={{ height: visibleStations.topPad }} />
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {visibleStations.stations.map((station, idx) => {
                  const isActive = activeStationUuid === station.stationuuid
                  const isFav = favoriteSet.has(station.stationuuid)
                  const realIndex = visibleStations.startIndex + idx

                  return (
                    <article
                      key={`${station.stationuuid}-${realIndex}`}
                      className="flex h-46.5 flex-col rounded-xl border p-3 transition hover:-translate-y-px"
                      style={{
                        borderColor: isActive ? 'var(--ace-accent)' : 'var(--ace-border)',
                        background: isActive
                          ? 'color-mix(in srgb, var(--ace-accent) 9%, var(--ace-bg-elevated))'
                          : 'var(--ace-bg-elevated)',
                      }}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        {station.favicon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={station.favicon}
                            alt={station.name}
                            className="h-12 w-12 rounded-lg border object-cover"
                            style={{ borderColor: 'var(--ace-border)' }}
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="flex h-12 w-12 items-center justify-center rounded-lg border"
                            style={{ borderColor: 'var(--ace-border)' }}
                          >
                            <RadioTower size={16} style={{ color: 'var(--ace-text-muted)' }} />
                          </div>
                        )}

                        <button
                          aria-label="favorite station"
                          onClick={() => toggleFavorite(station).catch(() => {})}
                          className="rounded-md p-1"
                          style={{ color: isFav ? '#f59e0b' : 'var(--ace-text-muted)' }}
                        >
                          <Star size={15} fill={isFav ? '#f59e0b' : 'none'} />
                        </button>
                      </div>

                      <h3 className="line-clamp-2 text-sm font-semibold" style={{ color: 'var(--ace-text-primary)' }}>
                        {station.name}
                      </h3>
                      <p className="mt-1 line-clamp-1 text-xs" style={{ color: 'var(--ace-text-muted)' }}>
                        {station.country} · {station.language || 'Unknown language'}
                      </p>
                      <p className="line-clamp-1 text-xs" style={{ color: 'var(--ace-text-muted)' }}>
                        {station.tags || 'No tags'}
                      </p>

                      <div className="mt-auto flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: 'var(--ace-text-muted)' }}>
                          {station.bitrate || 0} kbps
                        </span>
                        <button
                          onClick={() => playStation(station)}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
                          style={{ borderColor: 'var(--ace-border)', color: 'var(--ace-text-primary)' }}
                        >
                          <Play size={12} /> Play
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
              <div style={{ height: visibleStations.bottomPad }} />
            </>
          )}
        </div>
      </section>
    </div>
  )
}
