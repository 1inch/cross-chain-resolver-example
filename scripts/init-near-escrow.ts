#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {connect, keyStores, KeyPair} from 'near-api-js'
import BN from 'bn.js'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

async function main(): Promise<void> {
    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const MASTER_ID = req('NEAR_ACCOUNT_ID')
    const MASTER_PK = req('NEAR_PRIVATE_KEY')
    const ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')

    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(NETWORK_ID, MASTER_ID, KeyPair.fromString(MASTER_PK))

    const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
    const master = await near.account(MASTER_ID)

    console.log('[Init] Calling new on', ESCROW_ID)
    const res = await master.functionCall({
        contractId: ESCROW_ID,
        methodName: 'new',
        args: {},
        gas: new BN('300000000000000')
    })
    console.log('[Init] Done. Transaction:', res.transaction_outcome.id)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
