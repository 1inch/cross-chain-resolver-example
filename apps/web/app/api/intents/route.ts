import { NextResponse } from 'next/server'
import { listRecentIntents } from '@/services/near-server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const blocks = Number(searchParams.get('blocks') || '20')
  try {
    const data = await listRecentIntents({ blocks: Number.isFinite(blocks) && blocks > 0 ? blocks : 20 })
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
