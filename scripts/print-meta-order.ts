#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import {parseNearIntent, type NearIntent as SchemaNearIntent} from './schemas/near-intent'

// Types copied to keep this harness standalone
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

export type MetaOrder = {
    orderHash: string
    dstChainId: number
    makerNear: string
    takerNear: string
    makerAssetNear: string
    takerAssetEvm: string
    makingAmount: string
    takingAmount: string
    params: {
        maker: string
        taker: string
        srcAsset: string
        dstAsset: string
        srcAmount: string
        dstAmount: string
    }
}

function buildMetaOrderFromNearIntent(intent: NearIntent): MetaOrder {
    // Basic validation
    const hex32re = /^0x[0-9a-fA-F]{64}$/
    const hex20re = /^0x[0-9a-fA-F]{40}$/
    const numstr = (s: string): boolean => /^\d+$/.test(s)

    if (!intent.order_hash_hex || !hex32re.test(intent.order_hash_hex)) {
        throw new Error('Invalid intent.order_hash_hex (must be 0x + 32 bytes)')
    }

    if (!intent.taker_asset_evm || !hex20re.test(intent.taker_asset_evm)) {
        throw new Error('Invalid intent.taker_asset_evm (must be 0x + 20 bytes)')
    }

    if (!intent.making_amount || !numstr(intent.making_amount)) {
        throw new Error('Invalid intent.making_amount (must be a numeric string)')
    }

    if (!intent.taking_amount || !numstr(intent.taking_amount)) {
        throw new Error('Invalid intent.taking_amount (must be a numeric string)')
    }

    if (typeof intent.dst_chain_id !== 'number' || !Number.isFinite(intent.dst_chain_id)) {
        throw new Error('Invalid intent.dst_chain_id (must be a finite number)')
    }

    const orderHash = intent.order_hash_hex
    const dstChainId = intent.dst_chain_id
    const makerNear = intent.maker_near
    const takerNear = intent.taker_near
    const makerAssetNear = intent.maker_asset_near
    const takerAssetEvm = intent.taker_asset_evm
    const makingAmount = intent.making_amount
    const takingAmount = intent.taking_amount

    return {
        orderHash,
        dstChainId,
        makerNear,
        takerNear,
        makerAssetNear,
        takerAssetEvm,
        makingAmount,
        takingAmount,
        params: {
            maker: makerNear,
            taker: takerNear,
            srcAsset: makerAssetNear,
            dstAsset: takerAssetEvm,
            srcAmount: makingAmount,
            dstAmount: takingAmount
        }
    }
}

async function main(): Promise<void> {
    const intentPath = process.env.INTENT_PATH || path.resolve('intent2.json')

    if (!fs.existsSync(intentPath)) throw new Error(`Intent JSON not found at ${intentPath}`)

    const raw = fs.readFileSync(intentPath, 'utf8')
    const args = JSON.parse(raw) as unknown
    const intent = (await parseNearIntent(args)) as SchemaNearIntent

    console.log('Loaded intent from', intentPath)
    const meta = buildMetaOrderFromNearIntent(intent as NearIntent)
    console.log('[DRY_RUN] Fusion+ MetaOrder', meta)
    const sdkPayload = {
        orderHash: meta.orderHash,
        dstChainId: meta.dstChainId,
        maker: meta.params.maker,
        taker: meta.params.taker,
        assets: {src: meta.params.srcAsset, dst: meta.params.dstAsset},
        amounts: {making: meta.params.srcAmount, taking: meta.params.dstAmount}
    }
    console.log('[DRY_RUN] Fusion+ SDK payload (example, not submitted)', sdkPayload)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
