#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {connect, keyStores, KeyPair} from 'near-api-js'
import BN from 'bn.js'
import fs from 'node:fs'
import path from 'node:path'

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
    const contractId = req('NEAR_INTENTS_ACCOUNT_ID')

    const keyStore = new keyStores.InMemoryKeyStore()
    await keyStore.setKey(networkId, accountId, KeyPair.fromString(privateKey))

    const near = await connect({networkId, nodeUrl, deps: {keyStore}})
    const account = await near.account(accountId)

    // Load intent JSON (default: intent2.json at project root)
    const intentPath = process.env.INTENT_PATH || path.resolve('intent2.json')
    const raw = fs.readFileSync(intentPath, 'utf8')
    const args = JSON.parse(raw)

    console.log('Submitting intake_intent with args from', intentPath)
    const res = await account.functionCall({
        contractId,
        methodName: 'intake_intent',
        args: {intent: args},
        gas: new BN('100000000000000'),
        attachedDeposit: new BN('0')
    })
    console.log('Transaction submitted. Status:', res?.status)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
