#!/usr/bin/env -S tsx
/* eslint-disable no-empty */
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

async function main(): Promise<void> {
    const rpc = process.env.EVM_RPC_HTTP || process.env.SEPOLIA_RPC_URL

    if (!rpc) throw new Error('Set EVM_RPC_HTTP or SEPOLIA_RPC_URL in .env')

    const factoryAddr = req('SEPOLIA_FACTORY')
    const resolverAddr = req('RESOLVER_ADDRESS')

    const abiPath = path.resolve('dist/contracts/EscrowFactory.sol/EscrowFactory.json')

    if (!fs.existsSync(abiPath)) throw new Error(`Factory ABI not found at ${abiPath}`)

    const artifact = JSON.parse(fs.readFileSync(abiPath, 'utf8'))
    const abi = Array.isArray(artifact) ? artifact : (artifact.abi ?? artifact)

    const provider = new ethers.JsonRpcProvider(rpc)
    const walletPk = process.env.PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY
    let signerAddr = '(no signer)'
    let signer: ethers.Signer | undefined

    if (walletPk) {
        signer = new ethers.Wallet(walletPk, provider)
        signerAddr = await (signer as ethers.Wallet).getAddress()
    }

    const c = new ethers.Contract(factoryAddr, abi, provider)

    console.log('Factory:', factoryAddr)
    console.log('Resolver:', resolverAddr)
    console.log('Signer:', signerAddr)

    try {
        const ownerFn = (c as unknown as {owner?: () => Promise<string>}).owner

        if (typeof ownerFn === 'function') {
            const owner = await ownerFn()
            console.log('owner()', owner)
        } else {
            console.log('owner() not exposed')
        }
    } catch {
        console.log('owner() not exposed')
    }

    try {
        const feeBankFn = (c as unknown as {FEE_BANK?: () => Promise<string>}).FEE_BANK

        if (typeof feeBankFn === 'function') {
            const feeBank = await feeBankFn()
            console.log('FEE_BANK()', feeBank)
        } else {
            console.log('FEE_BANK() not exposed')
        }
    } catch {
        console.log('FEE_BANK() not exposed')
    }

    try {
        const availFn = (c as unknown as {availableCredit?: (addr: string) => Promise<unknown>}).availableCredit

        if (typeof availFn === 'function') {
            const credit = await availFn(resolverAddr)
            // try toString if BigNumberish
            const val = (credit as {toString?: () => string})?.toString
                ? (credit as {toString: () => string}).toString()
                : String(credit)
            console.log('availableCredit(resolver)', val)
        } else {
            console.log('availableCredit() not exposed')
        }
    } catch (e) {
        console.log('availableCredit(resolver) failed:', (e as Error).message)
    }

    // List functions and errors
    try {
        const abiArr = abi as unknown[]
        const isFn = (x: unknown): x is {type?: string; name?: string} =>
            !!x && typeof x === 'object' && 'type' in (x as Record<string, unknown>)

        const fnNames = abiArr
            .filter(isFn)
            .filter((x) => x.type === 'function')
            .map((x) => x.name || '')

        console.log('Functions:', fnNames)

        const errors = abiArr
            .filter(isFn)
            .filter((x) => x.type === 'error')
            .map((x) => x.name || '')
        console.log('Custom errors:', errors)
    } catch {}
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
