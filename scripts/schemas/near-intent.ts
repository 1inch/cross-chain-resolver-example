import {z} from 'zod'

export type NearIntent = {
    maker_near: string
    taker_near: string
    maker_asset_near: string
    taker_asset_evm: string
    making_amount: string
    taking_amount: string
    order_hash_hex: string
    dst_chain_id: number
    timelocks_hex?: string
}

const HEX32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const HEX20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const NUMSTR = z.string().regex(/^\d+$/)

export const NearIntentSchema = z.object({
    maker_near: z.string().min(1),
    taker_near: z.string().min(1),
    maker_asset_near: z.string().min(1),
    taker_asset_evm: HEX20,
    making_amount: NUMSTR,
    taking_amount: NUMSTR,
    order_hash_hex: HEX32,
    dst_chain_id: z.number().finite(),
    timelocks_hex: z.string().optional()
})

function pickIntent(raw: unknown): unknown {
    if (raw && typeof raw === 'object' && 'intent' in (raw as Record<string, unknown>)) {
        return (raw as {intent: unknown}).intent
    }

    return raw
}

export async function parseNearIntent(raw: unknown): Promise<NearIntent> {
    const value = pickIntent(raw)

    return NearIntentSchema.parse(value)
}
