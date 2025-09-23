#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {ethers} from 'ethers'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

async function main(): Promise<void> {
    const RPC = req('EVM_RPC_HTTP')
    const RESOLVER = req('RESOLVER_ADDRESS')

    const abi = ['function owner() view returns (address)']

    const provider = new ethers.JsonRpcProvider(RPC)
    const resolver = new ethers.Contract(RESOLVER, abi, provider)
    const owner: string = await resolver.owner()
    console.log('[Resolver] owner =', owner)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
