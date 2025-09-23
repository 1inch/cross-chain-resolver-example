#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {spawnSync} from 'node:child_process'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

function runTsx(script: string, extraEnv: Record<string, string>): void {
    const env = {...process.env, ...extraEnv}
    const args = ['-e', `import('${script}')`]
    console.log(`$ tsx ${script}`)
    const res = spawnSync('tsx', args, {stdio: 'inherit', env})

    if (res.status !== 0) throw new Error(`tsx ${script} failed with code ${res.status}`)
}

async function main(): Promise<void> {
    const ETHERSCAN_API_KEY = req('ETHERSCAN_API_KEY')
    const FACTORY_ADDR = process.env.SEPOLIA_FACTORY || process.env.FACTORY_ADDR

    if (!FACTORY_ADDR) throw new Error('Set SEPOLIA_FACTORY or FACTORY_ADDR')

    // Default contract name for factory
    const CONTRACT_NAME =
        process.env.CONTRACT_NAME || 'contracts/lib/cross-chain-swap/contracts/EscrowFactory.sol:EscrowFactory'
    const CHAIN = process.env.CHAIN || 'sepolia'

    // Optional constructor args helpers
    const SIGNATURE = process.env.SIGNATURE || ''
    const ARGS_JSON = process.env.ARGS_JSON || ''
    const CONSTRUCTOR_ARGS_HEX = process.env.CONSTRUCTOR_ARGS_HEX || ''

    const extraEnv: Record<string, string> = {
        ETHERSCAN_API_KEY,
        CONTRACT_ADDRESS: FACTORY_ADDR,
        CONTRACT_NAME,
        CHAIN
    }

    if (CONSTRUCTOR_ARGS_HEX) extraEnv.CONSTRUCTOR_ARGS_HEX = CONSTRUCTOR_ARGS_HEX

    if (SIGNATURE) extraEnv.SIGNATURE = SIGNATURE

    if (ARGS_JSON) extraEnv.ARGS_JSON = ARGS_JSON

    // Delegate to shared verifier
    runTsx('./scripts/verify-etherscan.ts', extraEnv)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
