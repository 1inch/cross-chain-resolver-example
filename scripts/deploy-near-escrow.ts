#!/usr/bin/env -S tsx

/* eslint-disable no-console */
import 'dotenv/config'
import {connect, keyStores, KeyPair, utils} from 'near-api-js'
import BN from 'bn.js'
import fs from 'node:fs'
import path from 'node:path'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

async function main(): Promise<void> {
    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://near-testnet.api.pagoda.co/rpc/v1'

    const MASTER_ID = req('NEAR_ACCOUNT_ID')
    const MASTER_PK = req('NEAR_PRIVATE_KEY')

    const ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')
    const ESCROW_PK = process.env.NEAR_ESCROW_PRIVATE_KEY || '' // required to deploy if account already exists and is not a subaccount we control

    const WASM_PATH = req('WASM_PATH') // e.g. near/target/wasm32-unknown-unknown/release/escrow.wasm
    const INIT_METHOD = process.env.INIT_METHOD || '' // e.g. new
    const INIT_ARGS_JSON = process.env.INIT_ARGS_JSON || '' // e.g. {"owner":"your-acc.testnet"}
    const VIEW_METHOD = process.env.VIEW_METHOD || ''
    const VIEW_ARGS_JSON = process.env.VIEW_ARGS_JSON || ''

    if (!fs.existsSync(WASM_PATH)) throw new Error(`WASM not found at ${WASM_PATH}`)

    const wasm = fs.readFileSync(path.resolve(WASM_PATH))

    // KeyStore
    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(NETWORK_ID, MASTER_ID, KeyPair.fromString(MASTER_PK))

    if (ESCROW_PK) {
        await ks.setKey(NETWORK_ID, ESCROW_ID, KeyPair.fromString(ESCROW_PK))
    }

    const near = await connect({
        networkId: NETWORK_ID,
        nodeUrl: NODE_URL,
        deps: {keyStore: ks}
    })

    // If we have escrow key, deploy as escrow directly
    if (ESCROW_PK) {
        const escrow = await near.account(ESCROW_ID)
        console.log(`[Deploy] Deploying WASM to ${ESCROW_ID} as account owner`)
        await escrow.deployContract(wasm)

        if (INIT_METHOD) {
            const args = INIT_ARGS_JSON ? JSON.parse(INIT_ARGS_JSON) : {}
            console.log(`[Init] Calling ${INIT_METHOD} on ${ESCROW_ID} with`, args)
            await escrow.functionCall({
                contractId: ESCROW_ID,
                methodName: INIT_METHOD,
                args,
                gas: new BN('300000000000000')
            })
        }

        const st = await escrow.state()
        console.log('[State] code_hash:', st.code_hash)

        if (VIEW_METHOD) {
            const vargs = VIEW_ARGS_JSON ? JSON.parse(VIEW_ARGS_JSON) : {}
            const res = await escrow.viewFunction({contractId: ESCROW_ID, methodName: VIEW_METHOD, args: vargs})
            console.log('[View]', VIEW_METHOD, res)
        }

        console.log('[Done] NEAR escrow deployed:', ESCROW_ID)

        return
    }

    // Otherwise, attempt deploy via master only if ESCROW_ID is a subaccount of MASTER_ID
    if (!ESCROW_ID.endsWith(`.${MASTER_ID}`)) {
        throw new Error(
            `NEAR_ESCROW_PRIVATE_KEY missing. To deploy without escrow key, ESCROW must be subaccount of ${MASTER_ID}. ` +
                `Either set NEAR_ESCROW_PRIVATE_KEY for ${ESCROW_ID} or choose a subaccount like escrow.${MASTER_ID}`
        )
    }

    const master = await near.account(MASTER_ID)

    // Create the subaccount if it doesn't exist; if it exists and AUTO_GENERATE=true, generate a fresh subaccount name.
    const createWithName = async (name: string): Promise<string> => {
        const PUBLIC_KEY = KeyPair.fromString(MASTER_PK).getPublicKey()
        const AMOUNT = process.env.ESCROW_ACCOUNT_INITIAL_BALANCE || utils.format.parseNearAmount('3')! // 3 NEAR
        try {
            console.log(`[Create] Creating subaccount ${name} with ${AMOUNT} yoctoNEAR`)
            await master.createAccount(name, PUBLIC_KEY, new BN(AMOUNT))
            await ks.setKey(NETWORK_ID, name, KeyPair.fromString(MASTER_PK))

            return name
        } catch (e: unknown) {
            const msg = String((e as Error)?.message || e)

            if (msg.includes('AccountAlreadyExists') || msg.includes('already exists')) {
                console.log(`[Info] Target account ${name} already exists`)

                // do not set key since we don't control it; caller may choose another
                return ''
            }

            throw e
        }
    }

    let targetEscrowId = ESCROW_ID
    // Try to create requested ESCROW_ID; if it already exists and AUTO_GENERATE=true, try candidates until creation succeeds
    {
        const made = await createWithName(ESCROW_ID)

        if (made) targetEscrowId = made
    }

    if ((process.env.AUTO_GENERATE || '').toLowerCase() === 'true') {
        // If we don't control requested account (exists), try generating one we can create
        let attempts = 0
        while (attempts < 20) {
            const suffix = Math.random().toString(36).slice(2, 10)
            const ts = Date.now()
            const candidate = `escrow-${ts}-${suffix}.${MASTER_ID}`
            console.log(`[Auto] Trying subaccount: ${candidate}`)
            const made = await createWithName(candidate)

            // If we could create it, we also added the key and can proceed
            if (made) {
                targetEscrowId = candidate
                break
            }

            attempts += 1
        }

        if (attempts >= 20) throw new Error('AUTO_GENERATE failed to create a fresh subaccount after 20 attempts')
    }

    const escrow = await near.account(targetEscrowId)
    console.log(`[Deploy] Deploying WASM to ${targetEscrowId} as master (subaccount)`)
    await escrow.deployContract(wasm)

    if (INIT_METHOD) {
        const args = INIT_ARGS_JSON ? JSON.parse(INIT_ARGS_JSON) : {}
        console.log(`[Init] Calling ${INIT_METHOD} on ${targetEscrowId} with`, args)
        await escrow.functionCall({
            contractId: targetEscrowId,
            methodName: INIT_METHOD,
            args,
            gas: new BN('300000000000000')
        })
    }

    const st = await escrow.state()
    console.log('[State] code_hash:', st.code_hash)

    if (VIEW_METHOD) {
        const vargs = VIEW_ARGS_JSON ? JSON.parse(VIEW_ARGS_JSON) : {}
        const res = await escrow.viewFunction({contractId: targetEscrowId, methodName: VIEW_METHOD, args: vargs})
        console.log('[View]', VIEW_METHOD, res)
    }

    console.log('[Done] NEAR escrow deployed:', targetEscrowId)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
