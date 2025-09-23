#!/usr/bin/env -S tsx
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable no-console */
import 'dotenv/config'
import {connect, keyStores, KeyPair} from 'near-api-js'
import BN from 'bn.js'
import fs from 'node:fs'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

function hexZero(bytes: number): string {
    return '0x' + '00'.repeat(bytes)
}

function timelocksFromEnv() {
    return {
        deployed_at: 0,
        src_withdrawal: Number(process.env.SRC_WITHDRAWAL || 0),
        src_public_withdrawal: 0,
        src_cancellation: 0,
        src_public_cancellation: 0,
        dst_withdrawal: Number(process.env.DST_WITHDRAWAL || 10),
        dst_public_withdrawal: 100,
        dst_cancellation: Number(process.env.DST_CANCELLATION || 120)
    }
}

async function main(): Promise<void> {
    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')

    const orderHashHex = (fs.readFileSync('.last-order-hash', 'utf8') || '').trim()

    if (!/^0x[0-9a-fA-F]{64}$/.test(orderHashHex)) throw new Error('Invalid .last-order-hash (need 0x + 32 bytes hex)')

    // Amounts
    const MAKING_DEFAULT = '2000000000000000000' // 2e18 as per e2e default
    const amountStr = String(process.env.MAKING_AMOUNT_YOCTO || MAKING_DEFAULT)
    const safetyDepositStr = String(process.env.SAFETY_DEPOSIT || '0')

    // Zero addresses for native ETH path; resolver will handle mapping
    const makerHex20 = process.env.MAKER_HEX20 || hexZero(20)
    const takerHex20 = process.env.TAKER_HEX20 || hexZero(20)
    const tokenHex20 =
        process.env.TOKEN_HEX20 && process.env.TOKEN_HEX20.toLowerCase() !== 'eth'
            ? process.env.TOKEN_HEX20!
            : hexZero(20)
    const hashlockHex = process.env.HASHLOCK || hexZero(32)

    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(NETWORK_ID, ACCOUNT_ID, KeyPair.fromString(PRIVATE_KEY))
    const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
    const account = await near.account(ACCOUNT_ID)

    console.log('[CreateEscrow] create_dst_simple on', ESCROW_ID, 'order', orderHashHex)
    const timelocks = timelocksFromEnv()
    const argsJson = `{"order_hash_hex":"${orderHashHex}","hashlock_hex":"${hashlockHex}","maker_hex20":"${makerHex20}","taker_hex20":"${takerHex20}","token_hex20":"${tokenHex20}","amount":${amountStr},"safety_deposit":${safetyDepositStr},"timelocks":${JSON.stringify(timelocks)},"maker_near":"${ACCOUNT_ID}","taker_near":"${ACCOUNT_ID}"}`
    const res = await account.functionCall({
        contractId: ESCROW_ID,
        methodName: 'create_dst_simple',
        args: Buffer.from(argsJson),
        gas: new BN('300000000000000'),
        attachedDeposit: new BN(safetyDepositStr)
    })
    console.log('[CreateEscrow] Done. Tx:', res.transaction_outcome.id)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
