import type { Metadata } from 'next'
import './globals.css'
import { AppProviders } from '@/providers/AppProviders'

export const metadata: Metadata = {
  title: 'Audiophile Ace',
  description: 'Multifunctional Hi-Fi Audio Tool',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
