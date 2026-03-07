'use client'

import { useEffect, type ReactNode } from 'react'
import { useAppStore } from '@/store/appStore'

/**
 * AppProviders — wraps the entire app with:
 *  - Theme sync (applies data-* attributes to <html>)
 *  - Tauri event listeners
 *  - App initialization
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const { uiMode, colorScheme, init } = useAppStore()

  // Apply design tokens to <html> element
  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-ui-mode', uiMode)
    html.setAttribute('data-color-scheme', colorScheme)
  }, [uiMode, colorScheme])

  // Initialize app (load preferences, scan library, detect audio devices)
  useEffect(() => {
    init()
  }, [init])

  return <>{children}</>
}
