"use server"
/* eslint-disable no-console */
import { connect, keyStores, KeyPair } from 'near-api-js'
import BN from 'bn.js'

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

export async function listRecentIntents({ blocks = 20 }: { blocks?: number }): Promise<
  Array<{ txHash: string; blockHeight: number; seq?: number; intent?: unknown }>
> {
  const networkId = process.env.NEAR_NETWORK || 'testnet'
  const nodeUrl = process.env.NEAR_NODE_URL || 'https://near-testnet.api.pagoda.co/rpc/v1'
  const accountId = req('NEAR_ACCOUNT_ID')
  const privateKey = req('NEAR_PRIVATE_KEY')
  const intentsId = req('NEAR_INTENTS_ACCOUNT_ID')

  const keyStore = new keyStores.InMemoryKeyStore()
  await keyStore.setKey(networkId, accountId, KeyPair.fromString(privateKey))

  const near = await connect({ networkId, nodeUrl, deps: { keyStore } })
  const account = await near.account(accountId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider: any = (account as any).connection?.provider
  if (!provider) return []

  const out: Array<{ txHash: string; blockHeight: number; seq?: number; intent?: unknown }> = []

  const head = await provider.block({ finality: 'final' })
  const headH: number = Number(head.header.height)
  const start = Math.max(0, headH - Math.max(1, blocks))

  for (let h = headH; h > start; h--) {
    try {
      const b = await provider.block({ blockId: h })
      if (!b?.chunks) continue
      for (const ch of b.chunks) {
        const chunk = await provider.chunk({ chunk_id: ch.chunk_hash })
        for (const tx of chunk.transactions || []) {
          if (tx.receiver_id !== intentsId) continue
          const status = await provider.txStatus(tx.hash, tx.signer_id)
          const outcomes = status?.receipts_outcome || []
          for (const ro of outcomes) {
            const logs: string[] = ro.outcome?.logs || []
            for (const line of logs) {
              if (!line.includes('near-intents')) continue
              try {
                const ev = JSON.parse(line)
                if (ev?.event === 'IntentIntake') {
                  out.push({ txHash: tx.hash, blockHeight: h, seq: ev?.data?.seq, intent: ev?.data?.intent })
                }
              } catch {
                // ignore
              }
            }
          }
        }
      }
    } catch {
      // ignore per-block failures
    }
  }

  return out
}

export type SubmitIntentParams = {
  intent: unknown
}

export async function submitIntentOnNear({ intent }: SubmitIntentParams): Promise<{ tx: string; status: unknown }> {
  const networkId = process.env.NEAR_NETWORK || 'testnet'
  const nodeUrl = process.env.NEAR_NODE_URL || 'https://near-testnet.api.pagoda.co/rpc/v1'
  const accountId = req('NEAR_ACCOUNT_ID')
  const privateKey = req('NEAR_PRIVATE_KEY')
  const contractId = req('NEAR_INTENTS_ACCOUNT_ID')

  const keyStore = new keyStores.InMemoryKeyStore()
  await keyStore.setKey(networkId, accountId, KeyPair.fromString(privateKey))

  const near = await connect({ networkId, nodeUrl, deps: { keyStore } })
  const account = await near.account(accountId)

  const res = await account.functionCall({
    contractId,
    methodName: 'intake_intent',
    args: { intent } as Record<string, unknown>,
    gas: new BN('100000000000000'),
    attachedDeposit: new BN('0')
  })

  const anyRes = res as any
  const tx: string = anyRes?.transaction_outcome?.id || anyRes?.transaction_outcome?.outcome?.transaction_hash || ''
  return { tx, status: res?.status }
}

export async function viewNear({
  contractId,
  method,
  args
}: {
  contractId?: string
  method: string
  args?: Record<string, unknown>
}): Promise<unknown> {
  const networkId = process.env.NEAR_NETWORK || 'testnet'
  const nodeUrl = process.env.NEAR_NODE_URL || 'https://near-testnet.api.pagoda.co/rpc/v1'
  const accountId = req('NEAR_ACCOUNT_ID')
  const privateKey = req('NEAR_PRIVATE_KEY')
  const target = contractId || process.env.NEAR_ESCROW_ACCOUNT_ID
  if (!target) throw new Error('Missing contractId and NEAR_ESCROW_ACCOUNT_ID')

  const keyStore = new keyStores.InMemoryKeyStore()
  await keyStore.setKey(networkId, accountId, KeyPair.fromString(privateKey))

  const near = await connect({ networkId, nodeUrl, deps: { keyStore } })
  const account = await near.account(accountId)

  return account.viewFunction({ contractId: target, methodName: method, args: args || {} })
}
