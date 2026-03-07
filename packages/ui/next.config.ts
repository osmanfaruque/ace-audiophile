import type { NextConfig } from 'next'

/**
 * Audiophile Ace — Next.js config
 *
 * output: 'export'  →  static HTML/JS/CSS only (no server)
 * Tauri serves files via the built-in asset server / file:// protocol.
 * No SSR, no API routes, no next/image optimization.
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // All external asset fetches (artwork, streaming) go through the C++ engine,
  // not Next.js image optimization.
  distDir: 'out',

  // Webpack: allow importing GLSL shader files as strings
  webpack: (config) => {
    config.module.rules.push({
      test: /\.(glsl|vert|frag)$/,
      use: 'raw-loader',
    })
    return config
  },
}

export default nextConfig
