#!/usr/bin/env -S node --enable-source-maps
/* eslint-disable max-lines-per-function */
/* eslint-disable max-depth */
/* eslint-disable no-console */
import 'dotenv/config'
import {ethers} from 'ethers'
import {connect, keyStores, KeyPair} from 'near-api-js'
import type {Account} from 'near-api-js'
import BN from 'bn.js'
import fs from 'node:fs'
import path from 'node:path'

// --------------------------
// Env helpers
// --------------------------
const req = (k: string): string => {
    const v = process.env[k]

    if (!v) throw new Error(`Missing env ${k}`)

    return v
}

// Submission helper controlled by env flag FUSION_SUBMIT
// When FUSION_SUBMIT=true, attempts a dynamic import of the Fusion SDK and logs the call shape.
// Otherwise, logs the payload and returns.
async function submitFusionOrder(meta: MetaOrder): Promise<void> {
    const payload = {
        orderHash: meta.orderHash,
        dstChainId: meta.dstChainId,
        maker: meta.params.maker,
        taker: meta.params.taker,
        assets: {
            src: meta.params.srcAsset,
            dst: meta.params.dstAsset
        },
        amounts: {
            making: meta.params.srcAmount,
            taking: meta.params.dstAmount
        }
        // ... any extra fields required by the SDK can be added here
    }
    const shouldSubmit = (process.env.FUSION_SUBMIT || '').toLowerCase() === 'true'

    if (!shouldSubmit) {
        console.log('[DRY_RUN] Fusion+ SDK call (disabled). Set FUSION_SUBMIT=true to enable. Payload:', payload)

        return
    }

    try {
        // Dynamically import to avoid hard dependency unless enabled and avoid static resolution warnings
        const dynImport = Function('m', 'return import(m)') as (m: string) => Promise<unknown>
        await dynImport('@1inch/fusion-sdk')
        // You would initialize the SDK/client here. This is intentionally only logged for now.
        console.log('[FUSION] fusionSdk.createOrder(payload) — submitting with payload:', payload)
        // Example (commented):
        // const { FusionSdk } = await dynImport('@1inch/fusion-sdk') as any
        // const sdk = new FusionSdk({ /* ...provider, auth, endpoint... */ })
        // const tx = await sdk.createOrder(payload)
        // console.log('[FUSION] Submitted order tx:', tx)
    } catch (e) {
        console.warn('[FUSION] SDK not available. Install it and configure credentials:')
        console.warn('  pnpm add @1inch/fusion-sdk')
        console.warn('Leaving payload for manual submission:', payload)
    }
}

const asU128 = (k: string, def?: string): string => {
    const raw = process.env[k] ?? def

    if (raw == null) throw new Error(`Missing env ${k}`)

    const n = BigInt(raw)

    if (n < 0n) throw new Error(`${k} must be >= 0`)

    return n.toString()
}

const hex32 = (k: string): string => {
    const h = req(k)

    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`${k} must be 0x + 32 bytes hex`)

    return h
}

const hex20 = (k: string): string => {
    const h = req(k)

    if (!/^0x[0-9a-fA-F]{40}$/.test(h)) throw new Error(`${k} must be 0x + 20 bytes hex`)

    return h
}

// --------------------------
// NEAR client helpers
// --------------------------
async function makeNearAccount(): Promise<{account: Account; networkId: string}> {
    const networkId = process.env.NEAR_NETWORK || 'testnet'
    const nodeUrl = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const accountId = req('NEAR_ACCOUNT_ID')
    const priv = req('NEAR_PRIVATE_KEY')
    const keyStore = new keyStores.InMemoryKeyStore()
    const keyPair = KeyPair.fromString(priv)
    await keyStore.setKey(networkId, accountId, keyPair)
    const near = await connect({networkId, nodeUrl, deps: {keyStore}})
    const account = await near.account(accountId)

    return {account, networkId}
}

async function callChange(
    account: Account,
    contractId: string,
    methodName: string,
    args: Record<string, unknown> = {},
    depositYocto = '0',
    gas = '150000000000000'
): Promise<unknown> {
    const gasBN = new BN(gas)
    const depBN = new BN(depositYocto)

    return account.functionCall({contractId, methodName, args, gas: gasBN, attachedDeposit: depBN})
}

async function ftTransferCall(
    account: Account,
    ft: string,
    receiver: string,
    amount: string,
    orderHashHex: string
): Promise<unknown> {
    const msg = JSON.stringify({order_hash: orderHashHex})

    return callChange(account, ft, 'ft_transfer_call', {receiver_id: receiver, amount, msg}, '0')
}

const timelocksFromEnv = (): {
    deployed_at: number
    src_withdrawal: number
    src_public_withdrawal: number
    src_cancellation: number
    src_public_cancellation: number
    dst_withdrawal: number
    dst_public_withdrawal: number
    dst_cancellation: number
} => ({
    deployed_at: 0,
    src_withdrawal: Number(process.env.SRC_WITHDRAWAL || 0),
    src_public_withdrawal: 0,
    src_cancellation: 0,
    src_public_cancellation: 0,
    dst_withdrawal: Number(process.env.DST_WITHDRAWAL || 10),
    dst_public_withdrawal: 100,
    dst_cancellation: Number(process.env.DST_CANCELLATION || 120)
})

// --------------------------
// Actions
// --------------------------
async function actionCreate(): Promise<void> {
    const ESCROW = req('NEAR_ESCROW_ACCOUNT_ID')
    const MAKER_NEAR = req('NEAR_ACCOUNT_ID')
    const TAKER_NEAR = req('NEAR_ACCOUNT_ID')

    const ORDER_HASH = hex32('ORDER_HASH')
    const HASHLOCK = hex32('HASHLOCK')
    const MAKER = hex20('MAKER_HEX20')
    const TAKER = hex20('TAKER_HEX20')
    const TOKEN = hex20('TOKEN_HEX20')
    const AMOUNT = asU128('AMOUNT')
    const SAFETY_DEPOSIT = asU128('SAFETY_DEPOSIT')

    const {account} = await makeNearAccount()
    await callChange(
        account,
        ESCROW,
        'create_dst_simple',
        {
            order_hash_hex: ORDER_HASH,
            hashlock_hex: HASHLOCK,
            maker_hex20: MAKER,
            taker_hex20: TAKER,
            token_hex20: TOKEN,
            amount: AMOUNT,
            safety_deposit: SAFETY_DEPOSIT,
            timelocks: timelocksFromEnv(),
            maker_near: MAKER_NEAR,
            taker_near: TAKER_NEAR
        },
        SAFETY_DEPOSIT
    )
    console.log('create_dst_simple submitted')
}

async function actionLock(): Promise<void> {
    const FT = req('NEAR_FT_ACCOUNT_ID')
    const ESCROW = req('NEAR_ESCROW_ACCOUNT_ID')
    const ORDER_HASH = hex32('ORDER_HASH')
    const AMOUNT = asU128('AMOUNT')
    const {account} = await makeNearAccount()
    const msg = JSON.stringify({order_hash: ORDER_HASH})
    await callChange(account, FT, 'ft_transfer_call', {receiver_id: ESCROW, amount: AMOUNT, msg}, '0')
    console.log('ft_transfer_call submitted')
}

async function actionWithdraw(): Promise<void> {
    const ESCROW = req('NEAR_ESCROW_ACCOUNT_ID')
    const ORDER_HASH = hex32('ORDER_HASH')
    const SECRET = hex32('SECRET')
    const {account} = await makeNearAccount()
    await callChange(account, ESCROW, 'withdraw_dst_hex', {order_hash_hex: ORDER_HASH, secret_hex: SECRET})
    console.log('withdraw_dst submitted')
}

async function actionPartial(): Promise<void> {
    const ESCROW = req('NEAR_ESCROW_ACCOUNT_ID')
    const ORDER_HASH = hex32('ORDER_HASH')
    const SECRET = hex32('SECRET')
    const proof_hex = JSON.parse(process.env.PROOF_JSON || '[]') as string[]
    const index = Number(process.env.INDEX || 0)
    const amount = asU128('PARTIAL_AMOUNT')
    const {account} = await makeNearAccount()
    await callChange(account, ESCROW, 'withdraw_dst_partial_hex', {
        order_hash_hex: ORDER_HASH,
        secret_hex: SECRET,
        proof_hex,
        index,
        amount
    })
    console.log('withdraw_dst_partial submitted')
}

async function actionCancel(): Promise<void> {
    const ESCROW = req('NEAR_ESCROW_ACCOUNT_ID')
    const ORDER_HASH = hex32('ORDER_HASH')
    const {account} = await makeNearAccount()
    const bin = Array.from(Buffer.from(ORDER_HASH.slice(2), 'hex'))
    await callChange(account, ESCROW, 'cancel_dst', {order_hash: bin})
    console.log('cancel_dst submitted')
}

// --------------------------
// EVM Listener wiring (Resolver events)
// --------------------------
const RESOLVER_ABI = [
    // Only the events are needed for now
    'event SrcEscrowPlanned((bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, bytes timelocks) immutables, uint256 srcChainId, bytes canonicalPayload)',
    'event DstEscrowCreated((bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, bytes timelocks) immutables, uint256 srcCancellationTimestamp, uint256 dstChainId, bytes canonicalPayload)'
]

type Immutables = {
    orderHash: string
    hashlock: string
    maker: string
    taker: string
    token: string
    amount: bigint
    safetyDeposit: bigint
    timelocks: string // bytes; we rely on NEAR timelocks from env
}

type NearIntent = {
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

type MetaOrder = {
    orderHash: string
    dstChainId: number
    makerNear: string
    takerNear: string
    makerAssetNear: string
    takerAssetEvm: string
    makingAmount: string
    takingAmount: string
    // derived / normalized fields for potential Fusion+ usage
    params: {
        maker: string
        taker: string
        srcAsset: string
        dstAsset: string
        srcAmount: string
        dstAmount: string
    }
}

// Shared schema parser (dynamic import inside the function)
async function parseNearIntentWithZod(raw: unknown): Promise<NearIntent> {
    const dynImport = Function('m', 'return import(m)') as (m: string) => Promise<unknown>
    const schemaMod = (await dynImport('./schemas/near-intent')) as {
        parseNearIntent: (r: unknown) => Promise<NearIntent>
    }

    return schemaMod.parseNearIntent(raw)
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
            // For a real Fusion+ meta-order these would be adapted to the SDK structure;
            // for DRY_RUN we normalize the basic fields so downstream code can be wired easily.
            maker: makerNear,
            taker: takerNear,
            srcAsset: makerAssetNear,
            dstAsset: takerAssetEvm,
            srcAmount: makingAmount,
            dstAmount: takingAmount
        }
    }
}

async function actionListen(): Promise<void> {
    const DRY_RUN = (process.env.DRY_RUN || '').toLowerCase() === 'true'
    const EVM_RPC_WS = req('EVM_RPC_WS')
    const RESOLVER_ADDRESS = req('RESOLVER_ADDRESS')
    const FILTER_DST_CHAIN_ID = process.env.FILTER_DST_CHAIN_ID ? BigInt(process.env.FILTER_DST_CHAIN_ID) : null
    const FILTER_ORDER_HASH = (process.env.FILTER_ORDER_HASH || '').toLowerCase()
    const ESCROW = DRY_RUN ? process.env.NEAR_ESCROW_ACCOUNT_ID || 'dry-run.escrow' : req('NEAR_ESCROW_ACCOUNT_ID')
    const MAKER_NEAR = DRY_RUN ? process.env.NEAR_ACCOUNT_ID || 'dry-run.maker' : req('NEAR_ACCOUNT_ID')
    const TAKER_NEAR = DRY_RUN ? process.env.NEAR_ACCOUNT_ID || 'dry-run.taker' : req('NEAR_ACCOUNT_ID')

    const provider = new ethers.WebSocketProvider(EVM_RPC_WS)
    const contract = new ethers.Contract(RESOLVER_ADDRESS, RESOLVER_ABI, provider)

    const {account} = await makeNearAccount()

    // --- Start NEAR intents listener (stub, DRY_RUN-friendly)
    const INTENTS_ID = process.env.NEAR_INTENTS_ACCOUNT_ID || ''

    if (INTENTS_ID) {
        // near-api-js provider via account connection
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nearProvider: any = (account as any).connection?.provider

        if (nearProvider) {
            let lastHeight = 0
            const seen = new Set<string>()
            const SEEN_FILE = path.resolve('.agent-seen.json')
            try {
                if (fs.existsSync(SEEN_FILE)) {
                    const raw = fs.readFileSync(SEEN_FILE, 'utf8')
                    const arr = JSON.parse(raw) as string[]

                    for (const k of arr) seen.add(k)

                    console.log(`[SeenStore] Loaded ${seen.size} entries from .agent-seen.json`)
                }
            } catch (e) {
                console.warn('[SeenStore] Failed to load .agent-seen.json:', (e as Error).message)
            }
            const persistSeen = (): void => {
                try {
                    fs.writeFileSync(SEEN_FILE, JSON.stringify(Array.from(seen)), 'utf8')
                } catch (e) {
                    console.warn('[SeenStore] Failed to persist .agent-seen.json:', (e as Error).message)
                }
            }
            const poll = async (): Promise<void> => {
                try {
                    const finalBlock = await nearProvider.block({finality: 'final'})
                    const currentHeight: number = Number(finalBlock.header.height)

                    if (currentHeight <= lastHeight) return

                    // Scan a sliding window of the most recent blocks to avoid missing logs
                    const WINDOW = 10
                    const startHeight = Math.max(lastHeight + 1, currentHeight - WINDOW + 1)

                    for (let height = startHeight; height <= currentHeight; height++) {
                        const b = await nearProvider.block({blockId: height})

                        if (!b.chunks) continue

                        for (const ch of b.chunks) {
                            const chunk = await nearProvider.chunk({chunk_id: ch.chunk_hash})

                            let txChecked = 0
                            const MAX_TX = Number(process.env.NEAR_INTENTS_MAX_TX_PER_CHUNK || 5)

                            for (const tx of chunk.transactions || []) {
                                if (tx.receiver_id !== INTENTS_ID) continue

                                const key = `${tx.hash}:${tx.signer_id}`

                                if (seen.has(key)) continue

                                seen.add(key)
                                persistSeen()
                                let outcomes: any[] = []
                                try {
                                    // Guard: ensure we pass base58 hash and signer_id as strings
                                    if (typeof tx.hash === 'string' && typeof tx.signer_id === 'string') {
                                        // Use raw JSON-RPC to avoid provider arg coercion issues
                                        // near RPC method: "tx" with params [tx_hash(base58), account_id]
                                        const out = await nearProvider.sendJsonRpc('tx', [tx.hash, tx.signer_id])
                                        outcomes = out?.receipts_outcome || []
                                    } else {
                                        // Skip if unexpected shape; rely on next poll
                                        continue
                                    }
                                } catch (e) {
                                    // Some nodes may reject txStatus sporadically (e.g., parse error). Skip silently.
                                    outcomes = []
                                }

                                for (const ro of outcomes) {
                                    const logs: string[] = ro.outcome?.logs || []

                                    for (const line of logs) {
                                        if (!line.includes('near-intents')) continue

                                        try {
                                            const ev = JSON.parse(line)

                                            if (ev?.event === 'IntentIntake' && ev?.data?.intent) {
                                                const parsed = await parseNearIntentWithZod(ev)
                                                console.log('[NEAR IntentIntake]', parsed)
                                                const meta = buildMetaOrderFromNearIntent(parsed as NearIntent)
                                                // DRY_RUN: output a structured meta-order payload
                                                console.log('[DRY_RUN] Fusion+ MetaOrder', meta)

                                                // Placeholder Fusion+ SDK payload (no submission)
                                                const sdkPayload = {
                                                    orderHash: meta.orderHash,
                                                    dstChainId: meta.dstChainId,
                                                    maker: meta.params.maker,
                                                    taker: meta.params.taker,
                                                    assets: {
                                                        src: meta.params.srcAsset,
                                                        dst: meta.params.dstAsset
                                                    },
                                                    amounts: {
                                                        making: meta.params.srcAmount,
                                                        taking: meta.params.dstAmount
                                                    }
                                                }
                                                console.log(
                                                    '[DRY_RUN] Fusion+ SDK payload (example, not submitted)',
                                                    sdkPayload
                                                )

                                                // Submit (or log) depending on FUSION_SUBMIT flag
                                                await submitFusionOrder(meta)

                                                // Optional action: directly deploy NEAR dst escrow (no Fusion). Uses env fallbacks.
                                                const ACTION = (process.env.ACTION || '').toLowerCase()

                                                if (ACTION === 'near-deploy-escrow') {
                                                    const DRY_RUN_FLAG =
                                                        (process.env.DRY_RUN || '').toLowerCase() === 'true'

                                                    if (DRY_RUN_FLAG) {
                                                        console.log(
                                                            '[DRY_RUN] Skipping ACTION=near-deploy-escrow create_dst_simple'
                                                        )
                                                    } else {
                                                        try {
                                                            const ESCROW = req('NEAR_ESCROW_ACCOUNT_ID')
                                                            const ORDER_HASH = meta.orderHash
                                                            const HASHLOCK =
                                                                (ev?.data?.intent?.hashlock_hex as
                                                                    | string
                                                                    | undefined) || '0x'
                                                            // Fallbacks for EVM hex20 fields if intent doesn’t provide maker/taker
                                                            const MAKER =
                                                                process.env.MAKER_HEX20 ||
                                                                '0x0000000000000000000000000000000000000000'
                                                            const TAKER =
                                                                process.env.TAKER_HEX20 ||
                                                                '0x0000000000000000000000000000000000000000'
                                                            const TOKEN = process.env.TOKEN_HEX20 || meta.takerAssetEvm
                                                            const AMOUNT = meta.makingAmount
                                                            const SAFETY_DEPOSIT = process.env.SAFETY_DEPOSIT || '0'
                                                            await callChange(
                                                                account,
                                                                ESCROW,
                                                                'create_dst_simple',
                                                                {
                                                                    order_hash_hex: ORDER_HASH,
                                                                    hashlock_hex: HASHLOCK,
                                                                    maker_hex20: MAKER,
                                                                    taker_hex20: TAKER,
                                                                    token_hex20: TOKEN,
                                                                    amount: AMOUNT,
                                                                    safety_deposit: SAFETY_DEPOSIT,
                                                                    timelocks: timelocksFromEnv(),
                                                                    maker_near: meta.makerNear,
                                                                    taker_near: meta.takerNear
                                                                },
                                                                SAFETY_DEPOSIT
                                                            )
                                                            console.log(
                                                                'ACTION=near-deploy-escrow: create_dst_simple submitted for',
                                                                ORDER_HASH
                                                            )
                                                        } catch (err) {
                                                            console.warn('ACTION=near-deploy-escrow failed:', err)
                                                        }
                                                    }
                                                }
                                            }
                                        } catch {
                                            // ignore malformed lines
                                        }
                                    }
                                }

                                txChecked += 1

                                if (txChecked >= MAX_TX) {
                                    break
                                }
                            }
                        }
                    }

                    lastHeight = currentHeight
                } catch (e) {
                    if ((process.env.NEAR_INTENTS_LOG_LEVEL || '').toLowerCase() === 'debug') {
                        console.warn('NEAR intents poll error:', e)
                    }
                }
            }
            // Poll every 10s
            setInterval(poll, 10000)
            // Kick once immediately
            poll().catch(() => {})
        } else {
            console.warn('NEAR provider not available; intents listener disabled')
        }
    }

    const coder = ethers.AbiCoder.defaultAbiCoder()
    contract.on(
        'DstEscrowCreated',
        async (
            immutables: Immutables,
            srcCancellationTimestamp: bigint,
            dstChainId: bigint,
            canonicalPayload: string
        ): Promise<void> => {
            try {
                console.log('DstEscrowCreated', {
                    dstChainId: dstChainId.toString(),
                    srcCancellationTimestamp: srcCancellationTimestamp.toString()
                })

                if (FILTER_DST_CHAIN_ID !== null && dstChainId !== FILTER_DST_CHAIN_ID) {
                    console.log('[Filter] Skipping event due to dstChainId mismatch', {
                        got: dstChainId.toString(),
                        want: FILTER_DST_CHAIN_ID.toString()
                    })

                    return
                }

                // Prefer canonical payload if present; fallback to tuple
                let ORDER_HASH = immutables.orderHash

                if (FILTER_ORDER_HASH && FILTER_ORDER_HASH !== '0x' && ORDER_HASH.toLowerCase() !== FILTER_ORDER_HASH) {
                    console.log('[Filter] Skipping event due to orderHash mismatch', {got: ORDER_HASH})

                    return
                }

                let HASHLOCK = immutables.hashlock
                let MAKER = immutables.maker
                let TAKER = immutables.taker
                let TOKEN = immutables.token
                let AMOUNT = immutables.amount.toString()
                let SAFETY_DEPOSIT = immutables.safetyDeposit.toString()

                if (canonicalPayload && canonicalPayload !== '0x') {
                    try {
                        const decoded = coder.decode(
                            ['bytes32', 'bytes32', 'address', 'address', 'address', 'uint256', 'uint256', 'bytes'],
                            canonicalPayload
                        )
                        ORDER_HASH = decoded[0]
                        HASHLOCK = decoded[1]
                        MAKER = decoded[2]
                        TAKER = decoded[3]
                        TOKEN = decoded[4]
                        AMOUNT = decoded[5].toString()
                        SAFETY_DEPOSIT = decoded[6].toString()
                    } catch (e) {
                        console.warn('canonicalPayload decode failed, using tuple immutables')
                    }
                }

                if (DRY_RUN) {
                    console.log('[DRY_RUN] Skipping create_dst_simple', {
                        ESCROW,
                        ORDER_HASH,
                        HASHLOCK,
                        MAKER,
                        TAKER,
                        TOKEN,
                        AMOUNT,
                        SAFETY_DEPOSIT
                    })
                } else {
                    await callChange(
                        account,
                        ESCROW,
                        'create_dst_simple',
                        {
                            order_hash_hex: ORDER_HASH,
                            hashlock_hex: HASHLOCK,
                            maker_hex20: MAKER,
                            taker_hex20: TAKER,
                            token_hex20: TOKEN,
                            amount: AMOUNT,
                            safety_deposit: SAFETY_DEPOSIT,
                            timelocks: timelocksFromEnv(),
                            maker_near: MAKER_NEAR,
                            taker_near: TAKER_NEAR
                        },
                        SAFETY_DEPOSIT
                    )

                    console.log('Mirrored NEAR dst escrow created for', ORDER_HASH)
                }

                if ((process.env.AUTO_LOCK || '').toLowerCase() === 'true') {
                    const FT = req('NEAR_FT_ACCOUNT_ID')

                    if (DRY_RUN) {
                        console.log('[DRY_RUN] Skipping AUTO_LOCK ft_transfer_call', {FT, ESCROW, AMOUNT, ORDER_HASH})
                    } else {
                        await ftTransferCall(account, FT, ESCROW, AMOUNT, ORDER_HASH)
                        console.log('AUTO_LOCK: ft_transfer_call submitted for', ORDER_HASH)
                    }
                }
            } catch (e) {
                console.error('Error handling DstEscrowCreated:', e)
            }
        }
    )

    contract.on('SrcEscrowPlanned', (immutables: Immutables, srcChainId: bigint) => {
        console.log('SrcEscrowPlanned', {srcChainId: srcChainId.toString(), orderHash: immutables.orderHash})
    })

    console.log('Agent listening to resolver events at', RESOLVER_ADDRESS)
}

// --------------------------
// Main
// --------------------------
async function main(): Promise<void> {
    const mode = (process.env.MODE || 'listen').toLowerCase()

    if (mode === 'create') return actionCreate()

    if (mode === 'lock') return actionLock()

    if (mode === 'withdraw') return actionWithdraw()

    if (mode === 'partial') return actionPartial()

    if (mode === 'cancel') return actionCancel()

    return actionListen()
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
