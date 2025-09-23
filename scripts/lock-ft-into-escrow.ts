#!/usr/bin/env -S tsx
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

async function main(): Promise<void> {
    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')
    const FT_ID = req('NEAR_FT_ACCOUNT_ID') // wrap.testnet

    const orderHashHex = (fs.readFileSync('.last-order-hash', 'utf8') || '').trim()

    if (!/^0x[0-9a-fA-F]{64}$/.test(orderHashHex)) throw new Error('Invalid .last-order-hash (need 0x + 32 bytes hex)')

    // Amount to lock (yocto tokens of the FT)
    const amount = req('LOCK_AMOUNT_YOCTO')
    const mintAmount = String(process.env.MINT_AMOUNT_YOCTO || amount)
    const mintBefore = String(process.env.MINT_BEFORE || 'false').toLowerCase() === 'true'

    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(NETWORK_ID, ACCOUNT_ID, KeyPair.fromString(PRIVATE_KEY))
    const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
    const account = await near.account(ACCOUNT_ID)

    if (mintBefore) {
        // Ensure maker ACCOUNT_ID is registered on FT for storage
        try {
            console.log('[FT] storage_deposit for maker', ACCOUNT_ID)
            await account.functionCall({
                contractId: FT_ID,
                methodName: 'storage_deposit',
                args: {account_id: ACCOUNT_ID, registration_only: true},
                gas: new BN('100000000000000'),
                attachedDeposit: new BN('1250000000000000000000000') // 0.00125 NEAR
            })
        } catch (e) {
            console.warn('[FT] storage_deposit (maker) may have failed or already registered:', (e as Error).message)
        }

        // Mint wNEAR by depositing native NEAR into wrap.testnet
        console.log('[FT] near_deposit to mint wNEAR amount', mintAmount)
        await account.functionCall({
            contractId: FT_ID,
            methodName: 'near_deposit',
            args: {},
            gas: new BN('100000000000000'),
            attachedDeposit: new BN(mintAmount)
        })
    }

    // Ensure storage deposit for the ESCROW_ID on the FT contract
    try {
        console.log('[FT] storage_deposit for', ESCROW_ID)
        await account.functionCall({
            contractId: FT_ID,
            methodName: 'storage_deposit',
            args: {account_id: ESCROW_ID, registration_only: true},
            gas: new BN('100000000000000'),
            attachedDeposit: new BN('1250000000000000000000000') // 0.00125 NEAR
        })
    } catch (e) {
        console.warn('[FT] storage_deposit may have failed or already registered:', (e as Error).message)
    }

    // Lock tokens via ft_transfer_call
    console.log('[FT] ft_transfer_call amount', amount, 'to', ESCROW_ID)
    const msg = JSON.stringify({order_hash: orderHashHex})
    const res = await account.functionCall({
        contractId: FT_ID,
        methodName: 'ft_transfer_call',
        args: {receiver_id: ESCROW_ID, amount, msg},
        gas: new BN('100000000000000'),
        attachedDeposit: new BN('1') // 1 yoctoNEAR
    })
    console.log('[FT] Transfer submitted. Tx:', res.transaction_outcome.id)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
