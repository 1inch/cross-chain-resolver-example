#!/usr/bin/env -S tsx

/* eslint-disable no-console */
import 'dotenv/config'
import {spawnSync} from 'node:child_process'

function runBash(script: string): void {
    console.log(`$ bash -lc ${script}`)
    const res = spawnSync('bash', ['-lc', script], {stdio: 'inherit', env: {...process.env}})

    if (res.status !== 0) throw new Error(`script failed with code ${res.status}`)
}

async function main(): Promise<void> {
    // Wrapper to maintain behavior; calls the original shell script.
    runBash('./scripts/deploy-lop-sepolia.sh')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
