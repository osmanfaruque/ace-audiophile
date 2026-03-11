'use client'

import { useState, useEffect } from 'react'
import {
  Palette, Library, SpeakerIcon, Play, Cpu, Info,
  Plus, Trash2, FolderOpen, Check, ChevronRight,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useDspStore } from '@/store/dspStore'
import { getAudioEngine } from '@/lib/audioEngine'
import { cn } from '@/lib/utils'
import type { AudioDevice } from '@ace/types'

// ── Tab definitions ───────────────────────────────────────────────────────────

type Tab = 'appearance' | 'library' | 'output' | 'playback' | 'dsp' | 'about'
const TABS: { id: Tab; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: 'appearance', label: 'Appearance',  Icon: Palette },
  { id: 'library',    label: 'Library',     Icon: Library },
  { id: 'output',     label: 'Audio Output',Icon: SpeakerIcon },
  { id: 'playback',   label: 'Playback',    Icon: Play },
  { id: 'dsp',        label: 'DSP',         Icon: Cpu },
  { id: 'about',      label: 'About',       Icon: Info },
]

// ── Reusable primitives ───────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-xs font-semibold uppercase tracking-widest mb-4"
        style={{ color: 'var(--ace-text-muted)' }}>
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col min-w-0">
        <span className="text-sm" style={{ color: 'var(--ace-text-primary)' }}>{label}</span>
        {hint && <span className="text-xs mt-0.5" style={{ color: 'var(--ace-text-muted)' }}>{hint}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="relative w-10 h-5 rounded-full transition-colors duration-200"
      style={{ background: value ? 'var(--ace-accent)' : 'var(--ace-border)' }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: value ? 'translateX(22px)' : 'translateX(2px)' }}
      />
    </button>
  )
}

function Select<T extends string>({
  value, onChange, options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="text-sm rounded-md px-2 py-1.5 outline-none border"
      style={{
        background: 'var(--ace-bg-elevated)',
        color: 'var(--ace-text-primary)',
        borderColor: 'var(--ace-border)',
        minWidth: 140,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function SliderRow({
  label, hint, value, min, max, step, unit, onChange,
}: {
  label: string; hint?: string; value: number; min: number; max: number
  step: number; unit: string; onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm" style={{ color: 'var(--ace-text-primary)' }}>{label}</span>
          {hint && <span className="block text-xs" style={{ color: 'var(--ace-text-muted)' }}>{hint}</span>}
        </div>
        <span className="text-sm font-mono" style={{ color: 'var(--ace-accent)' }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: 'var(--ace-accent)' }}
      />
    </div>
  )
}

// ── Accent presets ────────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  { label: 'Violet',   value: '#7c3aed' },
  { label: 'Indigo',   value: '#4f46e5' },
  { label: 'Blue',     value: '#2563eb' },
  { label: 'Cyan',     value: '#0891b2' },
  { label: 'Teal',     value: '#0d9488' },
  { label: 'Green',    value: '#16a34a' },
  { label: 'Amber',    value: '#d97706' },
  { label: 'Orange',   value: '#ea580c' },
  { label: 'Rose',     value: '#e11d48' },
  { label: 'Pink',     value: '#db2777' },
]

// ── Tab panels ────────────────────────────────────────────────────────────────

function AppearanceTab() {
  const {
    uiMode, setUiMode,
    colorScheme, setColorScheme,
    accentColor, setAccentColor,
  } = useAppStore()

  return (
    <>
      <Section title="Interface Mode">
        <div className="grid grid-cols-2 gap-3">
          {([
            { value: 'elegant' as const, label: 'Elegant', desc: 'Art-forward, clean, minimal chrome', hint: 'Oto / HiBy / UAPP-inspired' },
            { value: 'technical' as const, label: 'Technical', desc: 'Info-dense, waveform-forward, data-rich', hint: 'Symfonium-inspired' },
          ]).map(({ value, label, desc, hint }) => (
            <button
              key={value}
              onClick={() => setUiMode(value)}
              className="relative flex flex-col items-start gap-1 p-4 rounded-xl border-2 text-left transition-colors"
              style={{
                borderColor: uiMode === value ? 'var(--ace-accent)' : 'var(--ace-border)',
                background: uiMode === value ? 'color-mix(in srgb, var(--ace-accent) 8%, var(--ace-bg-elevated))' : 'var(--ace-bg-elevated)',
              }}
            >
              {uiMode === value && (
                <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--ace-accent)' }}>
                  <Check size={10} style={{ color: '#fff' }} />
                </span>
              )}
              <span className="font-semibold text-sm" style={{ color: 'var(--ace-text-primary)' }}>{label}</span>
              <span className="text-xs" style={{ color: 'var(--ace-text-secondary)' }}>{desc}</span>
              <span className="text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>{hint}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Color Scheme">
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'dark',   label: 'Dark',         hint: 'Classic dark UI' },
            { value: 'amoled', label: 'AMOLED Black',  hint: 'Pure black, OLED-friendly' },
            { value: 'light',  label: 'Light',         hint: 'Light theme' },
            { value: 'system', label: 'Follow System', hint: 'Auto-detect OS preference' },
          ] as const).map((s) => (
            <button
              key={s.value}
              onClick={() => setColorScheme(s.value)}
              className="flex items-center gap-2 p-3 rounded-lg border text-left transition-colors"
              style={{
                borderColor: colorScheme === s.value ? 'var(--ace-accent)' : 'var(--ace-border)',
                background: colorScheme === s.value ? 'color-mix(in srgb, var(--ace-accent) 8%, var(--ace-bg-elevated))' : 'var(--ace-bg-elevated)',
              }}
            >
              <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                style={{ borderColor: colorScheme === s.value ? 'var(--ace-accent)' : 'var(--ace-border)' }}>
                {colorScheme === s.value && <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--ace-accent)' }} />}
              </div>
              <div>
                <div className="text-xs font-medium" style={{ color: 'var(--ace-text-primary)' }}>{s.label}</div>
                <div className="text-[10px]" style={{ color: 'var(--ace-text-muted)' }}>{s.hint}</div>
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Accent Color">
        <div className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map((c) => {
            const active = (accentColor ?? '#7c3aed') === c.value
            return (
              <button
                key={c.value}
                title={c.label}
                onClick={() => setAccentColor(c.value)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                style={{
                  background: c.value,
                  outline: active ? `3px solid ${c.value}` : 'none',
                  outlineOffset: 2,
                  boxShadow: active ? `0 0 0 1px var(--ace-bg)` : 'none',
                }}
              />
            )
          })}
          <button
            title="Reset to default"
            onClick={() => setAccentColor(null)}
            className="w-7 h-7 rounded-full border-2 border-dashed text-xs flex items-center justify-center transition-colors hover:border-solid"
            style={{
              borderColor: 'var(--ace-border)',
              color: 'var(--ace-text-muted)',
            }}
          >↺</button>
        </div>
      </Section>
    </>
  )
}

function LibraryTab() {
  const {
    libraryPaths, addLibraryPath, removeLibraryPath,
    autoScan, setAutoScan,
    scanOnStartup, setScanOnStartup,
  } = useAppStore()

  async function pickFolder() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const result = await open({ directory: true, multiple: false })
      if (!result) return
      const path = Array.isArray(result) ? result[0] : result
      addLibraryPath(path)
    } catch { /* browser mode */ }
  }

  return (
    <>
      <Section title="Music Folders">
        <div className="flex flex-col gap-2">
          {libraryPaths.length === 0 && (
            <div className="text-sm py-3 text-center rounded-lg border border-dashed"
              style={{ color: 'var(--ace-text-muted)', borderColor: 'var(--ace-border)' }}>
              No folders added yet
            </div>
          )}
          {libraryPaths.map((p) => (
            <div key={p} className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: 'var(--ace-bg-elevated)', border: '1px solid var(--ace-border)' }}>
              <FolderOpen size={14} style={{ color: 'var(--ace-accent)', flexShrink: 0 }} />
              <span className="flex-1 text-sm truncate font-mono" style={{ color: 'var(--ace-text-primary)' }}>{p}</span>
              <button onClick={() => removeLibraryPath(p)}
                className="p-1 rounded hover:opacity-70 transition-opacity"
                style={{ color: 'var(--ace-text-muted)' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            onClick={pickFolder}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--ace-accent)', color: 'var(--ace-accent)' }}
          >
            <Plus size={14} />
            <span className="text-sm font-medium">Add Folder</span>
          </button>
        </div>
      </Section>

      <Section title="Scan Behavior">
        <Row label="Auto-scan on file change" hint="Watch folders for new or removed files">
          <Toggle value={autoScan} onChange={setAutoScan} />
        </Row>
        <Row label="Scan library on startup" hint="Slower startup, always up-to-date">
          <Toggle value={scanOnStartup} onChange={setScanOnStartup} />
        </Row>
      </Section>
    </>
  )
}

function OutputTab() {
  const {
    outputDeviceId, setOutputDeviceId,
    exclusiveMode, setExclusiveMode,
    bitPerfect, setBitPerfect,
    bufferMs, setBufferMs,
  } = useAppStore()

  const [devices, setDevices] = useState<AudioDevice[]>([])

  useEffect(() => {
    getAudioEngine().listDevices().then(setDevices).catch(() => {})
  }, [])

  return (
    <>
      <Section title="Output Device">
        <Row label="Device" hint="Select your DAC or audio interface">
          <select
            value={outputDeviceId ?? ''}
            onChange={(e) => setOutputDeviceId(e.target.value || null)}
            className="text-sm rounded-md px-2 py-1.5 outline-none border"
            style={{
              background: 'var(--ace-bg-elevated)',
              color: 'var(--ace-text-primary)',
              borderColor: 'var(--ace-border)',
              minWidth: 180,
            }}
          >
            <option value="">Default System Output</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name} {d.type === 'usb' ? '(USB)' : ''}</option>
            ))}
          </select>
        </Row>
        {devices.find((d) => d.id === outputDeviceId) && (
          <div className="text-xs rounded-lg p-3 font-mono flex flex-wrap gap-x-4 gap-y-1"
            style={{ background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-muted)', border: '1px solid var(--ace-border)' }}>
            {(() => {
              const d = devices.find((d) => d.id === outputDeviceId)!
              return (
                <>
                  <span>Type: {d.type}</span>
                  <span>Sample rates: {d.sampleRates.join(', ')} Hz</span>
                  <span>Bit depths: {d.bitDepths.join('/')} bit</span>
                  {d.supportsDoP && <span>DSD-over-PCM: ✓</span>}
                  {d.supportsNativeDSD && <span>Native DSD: ✓</span>}
                </>
              )
            })()}
          </div>
        )}
      </Section>

      <Section title="Output Mode">
        <Row label="Exclusive Mode" hint="Bypass OS mixer for direct hardware access">
          <Toggle value={exclusiveMode} onChange={setExclusiveMode} />
        </Row>
        <Row label="Bit-Perfect Output" hint="Disable all OS resampling and mixing (requires exclusive mode)">
          <Toggle value={bitPerfect} onChange={(v) => { setBitPerfect(v); if (v) setExclusiveMode(true) }} />
        </Row>
      </Section>

      <Section title="Buffer">
        <SliderRow
          label="Buffer Size"
          hint="Larger = more stable, higher latency"
          value={bufferMs} min={50} max={2000} step={50} unit="ms"
          onChange={setBufferMs}
        />
      </Section>
    </>
  )
}

function PlaybackTab() {
  const {
    gapless, setGapless,
    crossfadeDurationMs, setCrossfadeDurationMs,
    replayGainMode, setReplayGainMode,
  } = useAppStore()

  return (
    <>
      <Section title="Transitions">
        <Row label="Gapless Playback" hint="Remove silence between consecutive tracks">
          <Toggle value={gapless} onChange={setGapless} />
        </Row>
        <SliderRow
          label="Crossfade Duration"
          hint="0 = disabled. Fades between tracks."
          value={crossfadeDurationMs} min={0} max={10000} step={500} unit="ms"
          onChange={(v) => { setCrossfadeDurationMs(v); if (v > 0) setGapless(false) }}
        />
      </Section>

      <Section title="Loudness Normalization">
        <Row label="ReplayGain Mode" hint="Apply stored RG tags to normalize volume">
          <Select
            value={replayGainMode}
            onChange={setReplayGainMode}
            options={[
              { value: 'off',   label: 'Off' },
              { value: 'track', label: 'Track Gain' },
              { value: 'album', label: 'Album Gain' },
            ]}
          />
        </Row>
      </Section>
    </>
  )
}

function DspTab() {
  const { state, setDitherEnabled, setDitherType, setNoiseShapingProfile, setCompressorEnabled, setStereoWidthEnabled, setStereoWidth } = useDspStore()

  return (
    <>
      <Section title="Dither">
        <Row label="Enable Dither" hint="Recommended when downsampling bit depth">
          <Toggle value={state.ditherEnabled} onChange={setDitherEnabled} />
        </Row>
        {state.ditherEnabled && (
          <>
            <Row label="Dither Type">
              <Select
                value={state.ditherType}
                onChange={setDitherType}
                options={[
                  { value: 'rpdf',   label: 'RPDF (Rectangular)' },
                  { value: 'tpdf',   label: 'TPDF (Triangular)' },
                  { value: 'shaped', label: 'Shaped' },
                ]}
              />
            </Row>
            <Row label="Noise Shaping">
              <Select
                value={state.noiseShapingProfile}
                onChange={setNoiseShapingProfile}
                options={[
                  { value: 'none',        label: 'None' },
                  { value: 'fweighted',   label: 'F-Weighted' },
                  { value: 'eweighted',   label: 'E-Weighted' },
                  { value: 'lipshitz',    label: 'Lipshitz' },
                  { value: 'wannamaker',  label: 'Wannamaker' },
                ]}
              />
            </Row>
          </>
        )}
      </Section>

      <Section title="Stereo Width">
        <Row label="Enable Stereo Widener" hint="Haas-effect mid/side processing">
          <Toggle value={state.stereoWidthEnabled} onChange={setStereoWidthEnabled} />
        </Row>
        {state.stereoWidthEnabled && (
          <SliderRow
            label="Width"
            hint="1.0 = normal, 0.0 = mono, 2.0 = hyper-wide"
            value={state.stereoWidth} min={0} max={2} step={0.05} unit="×"
            onChange={setStereoWidth}
          />
        )}
      </Section>

      <Section title="Compressor / Limiter">
        <Row label="Enable Compressor" hint="Soft limiter to prevent clipping">
          <Toggle value={state.compressorEnabled} onChange={setCompressorEnabled} />
        </Row>
        {state.compressorEnabled && (
          <div className="text-xs px-3 py-2 rounded-lg"
            style={{ background: 'var(--ace-bg-elevated)', color: 'var(--ace-text-muted)', border: '1px solid var(--ace-border)' }}>
            Threshold: {state.compressorThresholdDb} dB · Ratio: {state.compressorRatio}:1 ·
            Attack: {state.compressorAttackMs} ms · Release: {state.compressorReleaseMs} ms
            <span className="ml-1" style={{ color: 'var(--ace-accent)' }}>(tweak in Equalizer view)</span>
          </div>
        )}
      </Section>
    </>
  )
}

function AboutTab() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center ace-glow"
        style={{ background: 'var(--ace-accent)' }}>
        <span className="text-2xl font-bold text-white">A</span>
      </div>
      <div>
        <h2 className="text-xl font-bold" style={{ color: 'var(--ace-text-primary)' }}>Audiophile Ace</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--ace-text-muted)' }}>Version 0.1.0 — Phase 1 Preview</p>
      </div>
      <div className="text-xs rounded-xl p-4 text-left w-full max-w-sm"
        style={{ background: 'var(--ace-bg-elevated)', border: '1px solid var(--ace-border)', color: 'var(--ace-text-muted)' }}>
        <div className="grid grid-cols-2 gap-y-1.5">
          {[
            ['Frontend',  'Next.js 15 + TypeScript'],
            ['UI',        'Tailwind CSS v4 + Framer Motion'],
            ['Bridge',    'Tauri v2 (Rust)'],
            ['Engine',    'C++ (libace_engine)'],
            ['Platform',  'Windows / macOS / Linux'],
          ].map(([k, v]) => (
            <><span key={k} className="font-medium" style={{ color: 'var(--ace-text-secondary)' }}>{k}</span><span key={v}>{v}</span></>
          ))}
        </div>
      </div>
      <p className="text-xs max-w-xs" style={{ color: 'var(--ace-text-muted)' }}>
        Built for audiophiles who want bit-perfect playback, lossless analysis, and studio-grade DSP in one place.
      </p>
    </div>
  )
}

// ── Main SettingsView ─────────────────────────────────────────────────────────

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<Tab>('appearance')
  const currentTab = TABS.find((t) => t.id === activeTab)!

  const PANEL_MAP: Record<Tab, React.ReactNode> = {
    appearance: <AppearanceTab />,
    library:    <LibraryTab />,
    output:     <OutputTab />,
    playback:   <PlaybackTab />,
    dsp:        <DspTab />,
    about:      <AboutTab />,
  }

  return (
    <div className="flex h-full" style={{ color: 'var(--ace-text-primary)' }}>

      {/* ── Left tab list ─────────────────────────────────── */}
      <aside
        className="w-48 shrink-0 flex flex-col pt-8 pb-4 px-2"
        style={{ borderRight: '1px solid var(--ace-border)', background: 'var(--ace-bg-elevated)' }}
      >
        <h2 className="px-3 mb-5 text-base font-semibold" style={{ color: 'var(--ace-text-primary)' }}>
          Settings
        </h2>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors mb-0.5"
            style={
              activeTab === id
                ? { background: 'var(--ace-accent)', color: '#fff' }
                : { color: 'var(--ace-text-secondary)' }
            }
          >
            <Icon size={14} />
            <span>{label}</span>
            {activeTab !== id && <ChevronRight size={12} className="ml-auto opacity-40" />}
          </button>
        ))}
      </aside>

      {/* ── Right content pane ────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-8 py-8">
        <h2 className="text-lg font-semibold mb-6" style={{ color: 'var(--ace-text-primary)' }}>
          {currentTab.label}
        </h2>
        {PANEL_MAP[activeTab]}
      </main>
    </div>
  )
}
