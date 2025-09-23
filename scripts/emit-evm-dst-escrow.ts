#!/usr/bin/env -S tsx
/* eslint-disable max-depth */
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
    const rpc = process.env.SEPOLIA_RPC_URL || process.env.EVM_RPC_HTTP

    if (!rpc) throw new Error('Set SEPOLIA_RPC_URL or EVM_RPC_HTTP')

    const pk = req('SEPOLIA_PRIVATE_KEY')
    const to = req('RESOLVER_ADDRESS')
    const txValueWei = process.env.TX_VALUE_WEI

    const provider = new ethers.JsonRpcProvider(rpc)
    const wallet = new ethers.Wallet(pk, provider)

    // Option A: Call a contract function using an ABI file and args
    const abiPath = process.env.RESOLVER_ABI_PATH
    const funcName = process.env.FUNCTION_NAME
    const argsJson = process.env.ARGS_JSON

    if (abiPath && funcName && argsJson) {
        const absAbiPath = path.resolve(abiPath)

        if (!fs.existsSync(absAbiPath)) throw new Error(`ABI not found at ${absAbiPath}`)

        const artifactOrAbi = JSON.parse(fs.readFileSync(absAbiPath, 'utf8'))
        const abi = Array.isArray(artifactOrAbi) ? artifactOrAbi : (artifactOrAbi.abi ?? artifactOrAbi)
        const contract = new ethers.Contract(to, abi, wallet)

        let args: unknown
        try {
            args = JSON.parse(argsJson)
        } catch (e) {
            throw new Error(`Failed to parse ARGS_JSON: ${(e as Error).message}`)
        }
        const arr: unknown[] = Array.isArray(args) ? args : [args]

        // If first arg looks like dstImmutables and timelocks is an array/object, pack into uint256
        if (arr.length > 0 && arr[0] && typeof arr[0] === 'object') {
            const imm = arr[0] as Record<string, unknown>

            if (typeof imm.timelocksPacked === 'string') {
                // use provided packed value directly
                ;(imm as Record<string, unknown>).timelocks = imm.timelocksPacked
                delete (imm as Record<string, unknown>).timelocksPacked
            } else if (Array.isArray(imm.timelocks)) {
                const stagesSrc = imm.timelocks as unknown[]
                const stages: bigint[] = stagesSrc.map((v) => BigInt(v as string | number | bigint))

                if (stages.length !== 7) throw new Error('timelocks array must have 7 uint32 offsets')

                // Order: SrcWithdrawal(0), SrcPublicWithdrawal(1), SrcCancellation(2), SrcPublicCancellation(3), DstWithdrawal(4), DstPublicWithdrawal(5), DstCancellation(6)
                let packed = 0n

                for (let i = 0; i < 7; i++) {
                    const off = stages[i]

                    if (off < 0n || off > 0xffffffffn) throw new Error('timelock offset must fit uint32')

                    packed += off << BigInt(32 * i)
                }

                ;(imm as Record<string, unknown>).timelocks = '0x' + packed.toString(16)
            }
        }

        console.log(`Calling ${funcName} on ${to} with`, arr, txValueWei ? `(value: ${txValueWei})` : '')
        const overrides = txValueWei ? {value: BigInt(txValueWei)} : {}

        const fn = (contract as unknown as Record<string, unknown>)[funcName]

        if (typeof fn !== 'function') throw new Error(`Function ${funcName} not found in ABI`)

        const tx = await (fn as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(
            ...(arr as unknown[]),
            overrides
        )
        console.log('Sent tx:', tx.hash)
        const rc = await tx.wait()
        console.log('Receipt status:', rc?.status)

        return
    }

    // Option B: Send raw calldata directly
    const rawData = process.env.RAW_CALLDATA

    if (rawData) {
        if (!rawData.startsWith('0x')) throw new Error('RAW_CALLDATA must be 0x-prefixed hex')

        console.log(`Sending raw calldata to ${to}`, txValueWei ? `(value: ${txValueWei})` : '')
        const tx = await wallet.sendTransaction({to, data: rawData, value: txValueWei ? BigInt(txValueWei) : undefined})
        console.log('Sent tx:', tx.hash)
        const rc = await tx.wait()
        console.log('Receipt status:', rc?.status)

        return
    }

    // Guidance for configuring the script
    console.log('No ABI/args or RAW_CALLDATA provided.')
    console.log('Two ways to use this helper:')
    console.log('- Provide RESOLVER_ABI_PATH, FUNCTION_NAME, and ARGS_JSON to call a function by name')
    console.log(
        "  Example: FUNCTION_NAME=emitTest ARGS_JSON='[" +
            `"0x...orderHash","0x...hashlock","0xmaker","0xtaker","0xtoken","1000000000000000000","100000000000000000"` +
            "]'"
    )
    console.log('- Or provide RAW_CALLDATA (0x...) to send a raw transaction to the resolver address')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
