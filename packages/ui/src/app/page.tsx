'use client'

import { AppShell } from '@/components/layout/AppShell'

/**
 * Root page — renders AppShell which handles routing between
 * Library, Player, Analyzer, EQ, Tagger, ABX, Settings views
 * in both Elegant and Technical modes.
 */
export default function HomePage() {
  return <AppShell />
}
