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
    // SIGNATURE example: "constructor(address,address,uint256)"
    // ARGS_JSON example: '["0xabc...","0xdef...","1000000000000000000"]'
    const SIGNATURE = req('SIGNATURE')
    const ARGS_JSON = req('ARGS_JSON')

    let args: unknown
    try {
        args = JSON.parse(ARGS_JSON)
    } catch (e) {
        throw new Error(`Failed to parse ARGS_JSON: ${(e as Error).message}`)
    }
    const arr = Array.isArray(args) ? args : [args]

    const iface = new ethers.Interface([`function ${SIGNATURE}`])
    // Extract the fragment name from signature like constructor(...) => we'll use unnamed fragment
    const fn = iface.getFunction(SIGNATURE.split('(')[0])

    if (!fn) throw new Error('Invalid SIGNATURE, unable to parse')

    // ABI-encode args; strip function selector to keep raw constructor args
    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(fn.inputs, arr as unknown[])
    const hex = encoded.replace(/^0x/, '')
    console.log('CONSTRUCTOR_ARGS_HEX=0x' + hex)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
