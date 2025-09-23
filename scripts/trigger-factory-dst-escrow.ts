#!/usr/bin/env -S tsx
/* eslint-disable no-console */
import 'dotenv/config'
import {ethers, Interface} from 'ethers'
import fs from 'node:fs'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

async function main(): Promise<void> {
    const RPC = req('EVM_RPC_HTTP')
    const PK = req('PRIVATE_KEY')
    const FACTORY = req('SEPOLIA_FACTORY')

    const orderHashHex = (fs.readFileSync('.last-order-hash', 'utf8') || '').trim()

    if (!/^0x[0-9a-fA-F]{64}$/.test(orderHashHex)) throw new Error('Invalid .last-order-hash (need 0x + 32 bytes hex)')

    // Build immutables mirroring NEAR escrow we created
    const HASHLOCK = '0x' + '00'.repeat(32)
    const ZERO = '0x' + '00'.repeat(20)
    const AMOUNT = BigInt(process.env.MAKING_AMOUNT_WEI || process.env.AMOUNT || '100000000000000000') // 0.1 ETH
    const SAFETY = BigInt(process.env.SAFETY_DEPOSIT || '1000000000000000') // 0.001 ETH
    // Pack timelocks: dst stages at bits 128, 160, 192
    const DST_WITHDRAWAL = 10 // 10s
    const DST_PUBLIC_WITHDRAWAL = 100 // 100s
    const DST_CANCELLATION = 120 // 120s
    const TIMELOCKS =
        (BigInt(DST_WITHDRAWAL) << 128n) | (BigInt(DST_PUBLIC_WITHDRAWAL) << 160n) | (BigInt(DST_CANCELLATION) << 192n)
    const SRC_CANCEL_TS = BigInt(Math.floor(Date.now() / 1000) + 200) // 200s in future (must be > dst cancellation)

    const abi = [
        'function createDstEscrow((bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable'
    ]

    const provider = new ethers.JsonRpcProvider(RPC)
    const wallet = new ethers.Wallet(PK, provider)
    const iface = new Interface(abi)

    const imm = [orderHashHex, HASHLOCK, ZERO, ZERO, ZERO, AMOUNT, SAFETY, TIMELOCKS] as const

    console.log(
        '[Factory] createDstEscrow for order',
        orderHashHex,
        'amount',
        AMOUNT.toString(),
        'safety',
        SAFETY.toString()
    )
    const data = iface.encodeFunctionData('createDstEscrow', [imm, SRC_CANCEL_TS])
    const tx = await wallet.sendTransaction({to: FACTORY, data, value: AMOUNT + SAFETY, gasLimit: 500000n})
    console.log('[Factory] Submitted tx', tx.hash)
    const rcpt = await tx.wait()
    console.log('[Factory] Mined in', rcpt?.blockNumber)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
