#!/usr/bin/env -S tsx

/* eslint-disable no-console */
import 'dotenv/config'
import {spawnSync} from 'node:child_process'

function run(cmd: string, args: string[], env?: Record<string, string>): void {
    console.log(`$ ${cmd} ${args.join(' ')}`)
    const res = spawnSync(cmd, args, {stdio: 'inherit', env: {...process.env, ...env}})

    if (res.status !== 0) {
        throw new Error(`${cmd} failed with code ${res.status}`)
    }
}

async function main(): Promise<void> {
    const rpc = process.env.EVM_RPC_HTTP || process.env.SEPOLIA_RPC_URL
    const pk = process.env.PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY

    if (!rpc) throw new Error('Set EVM_RPC_HTTP or SEPOLIA_RPC_URL')

    if (!pk) throw new Error('Set PRIVATE_KEY or SEPOLIA_PRIVATE_KEY')

    // Foundry script path and target
    const script = 'contracts/script/DeployResolver.s.sol:DeployResolver'

    // forge script ... --broadcast
    run('forge', ['script', script, '--rpc-url', rpc, '--private-key', pk, '--broadcast', '-vvvv'])

    console.log('\nDeployed Resolver. Check broadcast folder for run-latest.json outputs:')
    console.log('  broadcast/DeployResolver.s.sol/11155111/run-latest.json')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
