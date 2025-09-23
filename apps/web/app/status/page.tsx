"use client"
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'

type Row = { txHash: string; blockHeight: number; seq?: number; intent?: any }

export default function StatusPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [blocks, setBlocks] = useState<number>(20)
  const [env, setEnv] = useState<{ NEAR_NETWORK: string; NEAR_INTENTS_ACCOUNT_ID: string; NEAR_ESCROW_ACCOUNT_ID: string } | null>(null)
  const { toast } = useToast()

  async function fetchEnv() {
    try {
      const r = await fetch('/api/env', { cache: 'no-store' })
      const j = await r.json()
      setEnv(j)
    } catch {
      // ignore
    }
  }

  async function fetchRows() {
    setLoading(true)
    try {
      const r = await fetch(`/api/intents?blocks=${blocks}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) {
        setRows(j.data as Row[])
        toast({ variant: 'success', title: 'Refreshed', description: `${(j.data as Row[]).length} item(s)` })
      } else {
        toast({ variant: 'error', title: 'Refresh failed', description: String(j.error || 'Unknown error') })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEnv().catch(() => {})
    fetchRows().catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-medium">Recent Intents</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600" htmlFor="blocks">Blocks</label>
          <Input
            id="blocks"
            type="number"
            min={1}
            max={200}
            value={blocks}
            onChange={(e) => setBlocks(Number(e.target.value) || 20)}
            className="w-28"
          />
          <Button onClick={fetchRows} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>
        </div>
      </div>
      {env?.NEAR_ESCROW_ACCOUNT_ID && (
        <div className="text-sm text-gray-600">
          Escrow:
          <a
            className="pl-2 text-blue-700 hover:underline"
            href={`${env.NEAR_NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'}/address/${env.NEAR_ESCROW_ACCOUNT_ID}`}
            target="_blank"
            rel="noreferrer"
          >
            {env.NEAR_ESCROW_ACCOUNT_ID}
          </a>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2">Block</th>
              <th className="px-3 py-2">Tx</th>
              <th className="px-3 py-2">Seq</th>
              <th className="px-3 py-2">Maker</th>
              <th className="px-3 py-2">Making</th>
              <th className="px-3 py-2">Dst Chain</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-gray-500" colSpan={6}>No items</td>
              </tr>
            )}
            {rows.map((r) => {
              const maker = r.intent?.maker_near || '—'
              const making = r.intent?.making_amount || '—'
              const dst = r.intent?.dst_chain_id || '—'
              const shortTx = r.txHash.slice(0, 6) + '…' + r.txHash.slice(-6)
              const explorerBase = env?.NEAR_NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'
              const txUrl = `${explorerBase}/txns/${r.txHash}`
              const acctUrl = env?.NEAR_INTENTS_ACCOUNT_ID ? `${explorerBase}/address/${env.NEAR_INTENTS_ACCOUNT_ID}` : undefined
              return (
                <tr key={r.txHash} className="border-b last:border-0">
                  <td className="px-3 py-2">{r.blockHeight}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <a className="text-blue-700 hover:underline" href={txUrl} target="_blank" rel="noreferrer">{shortTx}</a>
                  </td>
                  <td className="px-3 py-2">{r.seq ?? '—'}</td>
                  <td className="px-3 py-2">
                    {maker}
                    {acctUrl && (
                      <span className="pl-2 text-xs">
                        (<a className="text-blue-700 hover:underline" href={acctUrl} target="_blank" rel="noreferrer">intents</a>)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{making}</td>
                  <td className="px-3 py-2">{dst}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
