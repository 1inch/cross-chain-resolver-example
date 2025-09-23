#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function run(cmd: string, args: string[], cwd?: string): void {
    console.log(`$ ${cmd} ${args.join(' ')}`)
    const res = spawnSync(cmd, args, {stdio: 'inherit', cwd})

    if (res.status !== 0) throw new Error(`${cmd} failed with code ${res.status}`)
}

async function main(): Promise<void> {
    const CRATE_PATH = process.env.NEAR_CRATE_PATH || 'near/contracts/escrow'
    const PROFILE = process.env.PROFILE || 'release'

    if (!fs.existsSync(CRATE_PATH)) throw new Error(`NEAR crate path not found: ${CRATE_PATH}`)

    // Build the crate for wasm32
    run('cargo', ['build', '--target', 'wasm32-unknown-unknown', `--${PROFILE}`], CRATE_PATH)

    const builtDir = path.join(CRATE_PATH, 'target', 'wasm32-unknown-unknown', PROFILE)

    if (!fs.existsSync(builtDir)) throw new Error(`Build output folder missing: ${builtDir}`)

    const wasmFiles = fs.readdirSync(builtDir).filter((f) => f.endsWith('.wasm'))

    if (wasmFiles.length === 0) throw new Error(`No .wasm files found under ${builtDir}`)

    // Pick the first .wasm (or specify WASM_NAME env to filter)
    const WASM_NAME = process.env.WASM_NAME
    const picked = WASM_NAME && wasmFiles.includes(WASM_NAME) ? WASM_NAME : wasmFiles[0]
    const wasmPath = path.resolve(path.join(builtDir, picked))

    console.log('\n[Compile] Success')
    console.log('WASM_PATH=' + wasmPath)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
