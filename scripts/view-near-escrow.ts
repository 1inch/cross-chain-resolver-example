#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {connect, keyStores, KeyPair} from 'near-api-js'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

async function main(): Promise<void> {
    const networkId = process.env.NEAR_NETWORK || 'testnet'
    const nodeUrl = process.env.NEAR_NODE_URL || 'https://near-testnet.api.pagoda.co/rpc/v1'

    const accountId = req('NEAR_ACCOUNT_ID')
    const privateKey = req('NEAR_PRIVATE_KEY')

    const contractId = process.env.CONTRACT_ID || process.env.NEAR_ESCROW_ACCOUNT_ID

    if (!contractId) throw new Error('Missing env CONTRACT_ID or NEAR_ESCROW_ACCOUNT_ID')

    const method = req('VIEW_METHOD')
    const argsJson = process.env.VIEW_ARGS_JSON || '{}'
    let args: Record<string, unknown>
    try {
        args = JSON.parse(argsJson)
    } catch (e) {
        throw new Error(`Invalid VIEW_ARGS_JSON: ${(e as Error).message}`)
    }

    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(networkId, accountId, KeyPair.fromString(privateKey))

    const near = await connect({networkId, nodeUrl, deps: {keyStore: ks}})
    const account = await near.account(accountId)

    const res = await account.viewFunction({contractId, methodName: method, args})
    console.log(`[View] ${contractId}.${method}(${JSON.stringify(args)}) =>`)
    console.dir(res, {depth: null})
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
