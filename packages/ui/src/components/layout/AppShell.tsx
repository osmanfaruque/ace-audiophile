'use client'

import { useAppStore, type AppView } from '@/store/appStore'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Music2, Library, Album, Mic2, Sliders, ScanLine,
  Tags, FlaskConical, Headphones, BarChart3, Settings,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'

// ── Lazy-load heavy views ──────────────────────────────────
const PlayerView   = dynamic(() => import('@/views/PlayerView').then(m => ({ default: m.PlayerView })))
const LibraryView  = dynamic(() => import('@/views/LibraryView').then(m => ({ default: m.LibraryView })))
const EqualizerView = dynamic(() => import('@/views/EqualizerView').then(m => ({ default: m.EqualizerView })))
const AnalyzerView = dynamic(() => import('@/views/AnalyzerView').then(m => ({ default: m.AnalyzerView })))
const TaggerView   = dynamic(() => import('@/views/TaggerView').then(m => ({ default: m.TaggerView })))
const AbxView      = dynamic(() => import('@/views/AbxView').then(m => ({ default: m.AbxView })))
const GearView     = dynamic(() => import('@/views/GearView').then(m => ({ default: m.GearView })))
const RecapView    = dynamic(() => import('@/views/RecapView').then(m => ({ default: m.RecapView })))
const SettingsView = dynamic(() => import('@/views/SettingsView').then(m => ({ default: m.SettingsView })))

const NAV_ITEMS: { view: AppView; label: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { view: 'player',    label: 'Now Playing', Icon: Music2 },
  { view: 'library',   label: 'Library',     Icon: Library },
  { view: 'albums',    label: 'Albums',      Icon: Album },
  { view: 'artists',   label: 'Artists',     Icon: Mic2 },
  { view: 'equalizer', label: 'Equalizer',   Icon: Sliders },
  { view: 'analyzer',  label: 'Analyzer',    Icon: ScanLine },
  { view: 'tagger',    label: 'Tagger',      Icon: Tags },
  { view: 'abx',       label: 'ABX Test',    Icon: FlaskConical },
  { view: 'gear',      label: 'Gear Match',  Icon: Headphones },
  { view: 'recap',     label: 'Recap',       Icon: BarChart3 },
  { view: 'settings',  label: 'Settings',    Icon: Settings },
]

function ViewRenderer({ view }: { view: AppView }) {
  switch (view) {
    case 'player':    return <PlayerView />
    case 'library':
    case 'albums':
    case 'artists':   return <LibraryView mode={view} />
    case 'equalizer': return <EqualizerView />
    case 'analyzer':  return <AnalyzerView />
    case 'tagger':    return <TaggerView />
    case 'abx':       return <AbxView />
    case 'gear':      return <GearView />
    case 'recap':     return <RecapView />
    case 'settings':  return <SettingsView />
    default:          return <PlayerView />
  }
}

export function AppShell() {
  const { uiMode, activeView, setActiveView, sidebarOpen, toggleSidebar } = useAppStore()

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--ace-bg)' }}>

      {/* ── Title bar drag region ──────────────────────────── */}
      <div
        className="tauri-drag-region fixed top-0 left-0 right-0 h-8 z-50"
        style={{ background: 'transparent' }}
      />

      {/* ── Sidebar ───────────────────────────────────────── */}
      <motion.aside
        animate={{ width: sidebarOpen ? 220 : 64 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        className="relative shrink-0 flex flex-col pt-10 pb-4"
        style={{
          background: 'var(--ace-bg-elevated)',
          borderRight: '1px solid var(--ace-border)',
        }}
      >
        {/* Logo */}
        <div className="px-4 mb-6 flex items-center gap-3 overflow-hidden">
          <div
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ace-glow"
            style={{ background: 'var(--ace-accent)' }}
          >
            <Music2 size={16} style={{ color: '#fff' }} />
          </div>
          {sidebarOpen && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="font-semibold text-sm whitespace-nowrap"
              style={{ color: 'var(--ace-text-primary)' }}
            >
              Audiophile Ace
            </motion.span>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 flex flex-col gap-1 px-2">
          {NAV_ITEMS.map(({ view, label, Icon }) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              title={!sidebarOpen ? label : undefined}
              className={cn(
                'tauri-no-drag flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
                'transition-colors duration-150 overflow-hidden',
                activeView === view
                  ? 'text-white'
                  : 'hover:text-secondary'
              )}
              style={
                activeView === view
                  ? { background: 'var(--ace-accent)', color: '#fff' }
                  : { color: 'var(--ace-text-secondary)' }
              }
            >
              <Icon size={16} className="shrink-0" />
              {sidebarOpen && (
                <span className="text-sm font-medium whitespace-nowrap">{label}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={toggleSidebar}
          className="tauri-no-drag mx-2 mt-2 flex items-center justify-center h-8 rounded-lg transition-colors"
          style={{ color: 'var(--ace-text-muted)' }}
        >
          {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </motion.aside>

      {/* ── Main content ──────────────────────────────────── */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="h-full w-full"
          >
            <ViewRenderer view={activeView} />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
