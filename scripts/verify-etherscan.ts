#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {ethers} from 'ethers'
import fs from 'node:fs'
import path from 'node:path'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

function sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms))
}

// Map chain -> etherscan endpoint
function etherscanApiBase(chain: string): string {
    const c = chain.toLowerCase()

    if (c === 'mainnet' || c === 'ethereum') return 'https://api.etherscan.io/api'

    if (c === 'sepolia') return 'https://api-sepolia.etherscan.io/api'

    if (c === 'goerli') return 'https://api-goerli.etherscan.io/api'

    if (c === 'holesky') return 'https://api-holesky.etherscan.io/api'

    throw new Error(`Unsupported chain for Etherscan: ${chain}`)
}

// Find a build-info JSON that contains the given contract name
function findBuildInfo(contractName: string): {input: unknown; solcVersion: string} {
    const buildInfoDir = path.resolve('dist/contracts/build-info')
    const files = fs.existsSync(buildInfoDir) ? fs.readdirSync(buildInfoDir) : []

    for (const f of files) {
        if (!f.endsWith('.json')) continue

        const full = path.join(buildInfoDir, f)
        try {
            const j = JSON.parse(fs.readFileSync(full, 'utf8'))
            // Foundry build-info shape contains input and solcVersion
            const input = j.input
            const solcVersion: string = j.solcVersion || j.solcLongVersion || ''
            // Heuristic: if contractName appears in sources keys or in output, accept this
            const sources = Object.keys((input?.sources ?? {}) as Record<string, unknown>)
            const hit = sources.some((s) => s.includes(contractName.split(':')[0]))

            if (input && solcVersion && hit) {
                return {input, solcVersion}
            }
        } catch {
            // skip broken file
        }
    }

    throw new Error(`Could not locate build-info for ${contractName} under dist/contracts/build-info`)
}

function normalizeSolcVersion(v: string): string {
    // Expect like: 0.8.23+commit.XXXX; Etherscan expects 'v0.8.23+commit.XXXX'
    if (!v.startsWith('v')) return 'v' + v

    return v
}

async function submitVerification(params: {
    apiBase: string
    apiKey: string
    contractAddress: string
    contractName: string
    compilerVersion: string
    sourceCode: string
    constructorArgs?: string
    licenseType?: string
}): Promise<string> {
    const body = new URLSearchParams()
    body.set('apikey', params.apiKey)
    body.set('module', 'contract')
    body.set('action', 'verifysourcecode')
    body.set('contractaddress', params.contractAddress)
    body.set('sourceCode', params.sourceCode)
    body.set('codeformat', 'solidity-standard-json-input')
    body.set('contractname', params.contractName)
    body.set('compilerversion', params.compilerVersion)

    if (params.constructorArgs) body.set('constructorArguements', params.constructorArgs) // note Etherscan misspelling

    if (params.licenseType) body.set('licenseType', params.licenseType)

    const res = await fetch(params.apiBase, {method: 'POST', body})
    const json = (await res.json()) as {status: string; message?: string; result?: string}

    if (json.status !== '1') {
        throw new Error(`Etherscan verify submission failed: ${json.message ?? ''} ${json.result ?? ''}`)
    }

    return String(json.result) // GUID
}

async function pollStatus(apiBase: string, apiKey: string, guid: string): Promise<void> {
    for (;;) {
        const url = `${apiBase}?module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}&apikey=${encodeURIComponent(apiKey)}`
        const res = await globalThis.fetch(url)
        const json = (await res.json()) as {status: string; message?: string; result?: string}

        if (json.status === '1') {
            console.log('[Etherscan] Verification successful:', json.result)

            return
        }

        if (json.status === '0') {
            const msg: string = json.result || json.message || ''

            if (msg.includes('Pending in queue')) {
                console.log('[Etherscan] Pending, retrying in 5s...')
                await sleep(5000)
                continue
            }

            console.warn('[Etherscan] Status:', json.message, json.result)
            await sleep(5000)
            continue
        }

        console.warn('[Etherscan] Unexpected status:', json)
        await sleep(5000)
    }
}

async function main(): Promise<void> {
    const ETHERSCAN_API_KEY = req('ETHERSCAN_API_KEY')
    const CONTRACT_ADDRESS = req('CONTRACT_ADDRESS')
    const CONTRACT_NAME = req('CONTRACT_NAME') // e.g. contracts/src/Resolver.sol:Resolver
    const CHAIN = process.env.CHAIN || 'sepolia'
    let CONSTRUCTOR_ARGS_HEX = (process.env.CONSTRUCTOR_ARGS_HEX || '').replace(/^0x/, '')
    const LICENSE_TYPE = process.env.LICENSE_TYPE || '' // optional

    const apiBase = etherscanApiBase(CHAIN)

    const {input, solcVersion} = findBuildInfo(CONTRACT_NAME)
    const compilerVersion = normalizeSolcVersion(solcVersion)
    const sourceCode = JSON.stringify(input)

    // Optionally compute constructor args from SIGNATURE/ARGS_JSON

    const SIGNATURE = process.env.SIGNATURE
    const ARGS_JSON = process.env.ARGS_JSON

    if (!CONSTRUCTOR_ARGS_HEX && SIGNATURE && ARGS_JSON) {
        try {
            const parsed = JSON.parse(ARGS_JSON) as unknown
            const arr = Array.isArray(parsed) ? parsed : [parsed]
            const iface = new ethers.Interface([`function ${SIGNATURE}`])
            const fn = iface.getFunction(SIGNATURE.split('(')[0])

            if (!fn) throw new Error('Invalid SIGNATURE, unable to parse')

            const abiCoder = ethers.AbiCoder.defaultAbiCoder()
            const encoded = abiCoder.encode(fn.inputs, arr as unknown[])
            CONSTRUCTOR_ARGS_HEX = encoded.replace(/^0x/, '')

            console.log('[Verify] Computed CONSTRUCTOR_ARGS_HEX from SIGNATURE/ARGS_JSON')
        } catch (e) {
            console.warn(
                '[Verify] Failed to compute CONSTRUCTOR_ARGS_HEX from SIGNATURE/ARGS_JSON:',
                (e as Error).message
            )
        }
    }

    console.log('[Verify] Submitting to Etherscan', {
        CHAIN,
        CONTRACT_ADDRESS,
        CONTRACT_NAME,
        compilerVersion
    })

    const guid = await submitVerification({
        apiBase,
        apiKey: ETHERSCAN_API_KEY,
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        compilerVersion,
        sourceCode,
        constructorArgs: CONSTRUCTOR_ARGS_HEX || undefined,
        licenseType: LICENSE_TYPE || undefined
    })

    console.log('[Verify] Submission GUID:', guid)
    await pollStatus(apiBase, ETHERSCAN_API_KEY, guid)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
