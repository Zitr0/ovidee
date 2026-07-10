import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // NFR Privacidad: cero telemetría (reforzado con NEXT_TELEMETRY_DISABLED=1 en dev)
  reactStrictMode: true,
}

export default nextConfig
