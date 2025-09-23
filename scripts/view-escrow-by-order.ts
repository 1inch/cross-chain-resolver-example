#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {connect, keyStores, KeyPair} from 'near-api-js'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

function hex32ToBytes(hex: string): number[] {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('ORDER_HASH must be 0x + 32 bytes hex')

    return Array.from(Buffer.from(hex.slice(2), 'hex'))
}

async function main(): Promise<void> {
    const networkId = process.env.NEAR_NETWORK || 'testnet'
    const nodeUrl = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const accountId = req('NEAR_ACCOUNT_ID')
    const privateKey = req('NEAR_PRIVATE_KEY')

    const contractId = process.env.CONTRACT_ID || process.env.NEAR_ESCROW_ACCOUNT_ID

    if (!contractId) throw new Error('Missing env CONTRACT_ID or NEAR_ESCROW_ACCOUNT_ID')

    const method = process.env.VIEW_BY_ORDER_METHOD || 'get_escrow'
    const orderHashHex = req('ORDER_HASH')
    const order_hash = hex32ToBytes(orderHashHex)

    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(networkId, accountId, KeyPair.fromString(privateKey))

    const near = await connect({networkId, nodeUrl, deps: {keyStore: ks}})
    const account = await near.account(accountId)

    const res = await account.viewFunction({contractId, methodName: method, args: {order_hash}})
    console.log(`[ViewByOrder] ${contractId}.${method}({ order_hash: ${orderHashHex} }) =>`)
    console.dir(res, {depth: null})
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
