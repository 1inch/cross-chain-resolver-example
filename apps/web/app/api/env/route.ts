import { NextResponse } from 'next/server'

export async function GET() {
  const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet'
  const NEAR_INTENTS_ACCOUNT_ID = process.env.NEAR_INTENTS_ACCOUNT_ID || ''
  const NEAR_ESCROW_ACCOUNT_ID = process.env.NEAR_ESCROW_ACCOUNT_ID || ''
  const NEAR_ACCOUNT_ID = process.env.NEAR_ACCOUNT_ID || ''
  const TOKEN_HEX20 = process.env.TOKEN_HEX20 || ''

  return NextResponse.json({ NEAR_NETWORK, NEAR_INTENTS_ACCOUNT_ID, NEAR_ESCROW_ACCOUNT_ID, NEAR_ACCOUNT_ID, TOKEN_HEX20 })
}
