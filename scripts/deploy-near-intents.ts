#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {connect, keyStores} from 'near-api-js'
import BN from 'bn.js'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const req = (k: string): string => {
    const v = process.env[k]

    if (!v) throw new Error(`Missing env ${k}`)

    return v
}

const PROJECT_ROOT = path.resolve(__dirname, '..') // scripts/
const CONTRACT_DIR = path.resolve(PROJECT_ROOT, 'near/contracts/intents')
const WASM_PATH = path.resolve(CONTRACT_DIR, 'target/wasm32-unknown-unknown/release/near_intents.wasm')

// (intentionally no makeNearAccount helper—deploy uses a fresh Near connection for target)

function buildWasm(): void {
    if ((process.env.SKIP_BUILD || '').toLowerCase() === 'true') {
        if (!fs.existsSync(WASM_PATH)) {
            throw new Error(`SKIP_BUILD is true but WASM missing at ${WASM_PATH}`)
        }

        console.log('Skipping build (SKIP_BUILD=true); using existing WASM')

        return
    }

    console.log('Building NEAR intents contract…')
    const home = process.env.HOME || ''
    const defaultCargo = home ? path.join(home, '.cargo/bin/cargo') : 'cargo'
    const cargoCmd = process.env.CARGO || (fs.existsSync(defaultCargo) ? defaultCargo : 'cargo')
    const res = spawnSync(cargoCmd, ['build', '--target', 'wasm32-unknown-unknown', '--release'], {
        cwd: CONTRACT_DIR,
        stdio: 'inherit'
    })

    if (res.status !== 0) {
        throw new Error(
            `Cargo build failed. Ensure Rust toolchain is installed and visible to this process.\n` +
                `Tried cargo at: ${cargoCmd}.\n` +
                `Options: (1) run "source ~/.cargo/env" then re-run, (2) set env CARGO=$HOME/.cargo/bin/cargo, or (3) set SKIP_BUILD=true with a prebuilt WASM.`
        )
    }

    if (!fs.existsSync(WASM_PATH)) {
        throw new Error(`WASM not found at ${WASM_PATH}`)
    }

    const stats = fs.statSync(WASM_PATH)
    console.log(`WASM ready: ${WASM_PATH} (${stats.size} bytes)`)
}

async function deployAndInit(): Promise<void> {
    const target = req('NEAR_INTENTS_ACCOUNT_ID')

    console.log(`Deploying to ${target}…`)
    const wasm = fs.readFileSync(WASM_PATH)

    const networkId = process.env.NEAR_NETWORK || 'testnet'
    const nodeUrl = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'

    const credsDir = process.env.NEAR_CREDENTIALS_DIR || path.join(os.homedir(), '.near-credentials')
    const ks = new keyStores.UnencryptedFileSystemKeyStore(credsDir)

    const near = await connect({networkId, nodeUrl, deps: {keyStore: ks}})
    const targetAccount = await near.account(target)

    await targetAccount.deployContract(wasm)
    console.log('Deployed. Calling new()…')
    try {
        await targetAccount.functionCall({
            contractId: target,
            methodName: 'new',
            args: {},
            gas: new BN('300000000000000')
        })
    } catch (e: unknown) {
        const msg = String((e as Error)?.message || e)

        if (!msg.includes('already initialized') && !msg.includes('MethodNotFound')) {
            throw e
        }

        console.warn('new() skipped:', msg)
    }
    console.log('Intents contract is ready at', target)
}

async function main(): Promise<void> {
    buildWasm()
    await deployAndInit()
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
