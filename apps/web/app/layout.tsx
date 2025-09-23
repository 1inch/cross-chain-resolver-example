import './globals.css'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Toaster } from '@/components/ui/Toast'

export const metadata = {
  title: 'Cross-Chain Resolver UI',
  description: 'Compose swaps, monitor escrows, and manage settings.'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Toaster>
          <div className="mx-auto max-w-5xl p-6">
            <header className="mb-8">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold">Cross-Chain Resolver</h1>
                  <p className="text-sm text-gray-500">NEAR ↔ EVM HTLC demo</p>
                </div>
                <nav className="flex items-center gap-4 text-sm">
                  <Link href="/" className="text-gray-700 hover:underline">Compose</Link>
                  <Link href="/status" className="text-gray-700 hover:underline">Status</Link>
                  <Link href="/settings" className="text-gray-700 hover:underline">Settings</Link>
                </nav>
              </div>
            </header>
            <main>{children}</main>
          </div>
        </Toaster>
      </body>
    </html>
  )
}
