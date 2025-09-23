import dotenv from 'dotenv'
import path from 'node:path'

// Load env from monorepo root so Next app can access repo-level .env
dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') })

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true
  }
}

export default nextConfig
