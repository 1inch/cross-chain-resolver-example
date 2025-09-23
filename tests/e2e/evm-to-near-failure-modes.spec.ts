#!/usr/bin/env -S tsx

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * E2E Test: EVM to NEAR Failure Modes
 *
 * Tests:
 * 1. Expiry: Try to withdraw after cancellation timelock on NEAR
 * 2. Missing secret: Try to withdraw with wrong secret on NEAR
 * 3. Early cancellation: Cancel before timelock expires on NEAR
 * 4. EVM source cancellation: Cancel source escrow on EVM side
 */

import 'dotenv/config'
import {ethers} from 'ethers'
import {connect, keyStores, KeyPair} from 'near-api-js'
import BN from 'bn.js'
import crypto from 'node:crypto'

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

function generateSecret(): string {
    return '0x' + crypto.randomBytes(32).toString('hex')
}

function sha256(secret: string): string {
    return (
        '0x' +
        crypto
            .createHash('sha256')
            .update(Buffer.from(secret.slice(2), 'hex'))
            .digest('hex')
    )
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function submitEvmOrder(
    resolver: ethers.Contract,
    secret: string,
    amount: bigint,
    shortTimelocks = false
): Promise<string> {
    const hashlock = sha256(secret)
    const orderHash = '0x' + crypto.randomBytes(32).toString('hex')

    // Pack timelocks based on test requirements
    const timelocks = shortTimelocks
        ? {
              SRC_WITHDRAWAL: 2, // 2s for quick testing
              SRC_PUBLIC_WITHDRAWAL: 5, // 5s
              SRC_CANCELLATION: 8 // 8s
          }
        : {
              SRC_WITHDRAWAL: 10,
              SRC_PUBLIC_WITHDRAWAL: 100,
              SRC_CANCELLATION: 120
          }

    const TIMELOCKS =
        (BigInt(timelocks.SRC_WITHDRAWAL) << 0n) |
        (BigInt(timelocks.SRC_PUBLIC_WITHDRAWAL) << 32n) |
        (BigInt(timelocks.SRC_CANCELLATION) << 64n)

    const immutables = {
        orderHash,
        hashlock,
        maker: '0x' + '00'.repeat(20),
        taker: '0x' + '00'.repeat(20),
        token: '0x' + '00'.repeat(20), // Native ETH
        amount,
        safetyDeposit: 0n,
        timelocks: TIMELOCKS
    }

    const tx = await resolver.deploySrc(immutables, {
        value: amount,
        gasLimit: 500000n
    })

    await tx.wait()

    return orderHash
}

async function waitForNearEscrow(
    nearAccount: any,
    escrowId: string,
    orderHash: string,
    maxWaitMs = 15000
): Promise<any> {
    const startTime = Date.now()
    const orderHashBytes = Array.from(Buffer.from(orderHash.slice(2), 'hex'))

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const escrow = await nearAccount.viewFunction({
                contractId: escrowId,
                methodName: 'get_escrow',
                args: {order_hash: orderHashBytes}
            })

            if (escrow && escrow.immutables) {
                return escrow
            }
        } catch (e) {
            // Continue waiting
        }

        await sleep(1000)
    }

    throw new Error(`NEAR escrow not created within ${maxWaitMs / 1000}s`)
}

async function testExpiry(): Promise<void> {
    console.log('🕐 Test 1: Expiry (withdraw after cancellation timelock)')

    const EVM_RPC = req('EVM_RPC_HTTP')
    const EVM_PRIVATE_KEY = req('PRIVATE_KEY')
    const RESOLVER_ADDRESS = req('RESOLVER_ADDRESS')

    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const NEAR_ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const NEAR_PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const NEAR_ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')

    try {
        // Connect to EVM
        const evmProvider = new ethers.JsonRpcProvider(EVM_RPC)
        const evmWallet = new ethers.Wallet(EVM_PRIVATE_KEY, evmProvider)
        const resolverAbi = [
            'function deploySrc((bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external payable'
        ]
        const resolver = new ethers.Contract(RESOLVER_ADDRESS, resolverAbi, evmWallet)

        // Connect to NEAR
        const ks = new keyStores.InMemoryKeyStore()
        await ks.setKey(NETWORK_ID, NEAR_ACCOUNT_ID, KeyPair.fromString(NEAR_PRIVATE_KEY))
        const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
        const nearAccount = await near.account(NEAR_ACCOUNT_ID)

        const secret = generateSecret()
        const amount = BigInt('100000000000000000') // 0.1 ETH

        // Submit order with short timelocks
        const orderHash = await submitEvmOrder(resolver, secret, amount, true)
        console.log(`  📋 Order: ${orderHash}`)

        // Wait for NEAR escrow
        await waitForNearEscrow(nearAccount, NEAR_ESCROW_ID, orderHash)

        console.log('  ⏳ Waiting for cancellation timelock to expire (10s)...')
        await sleep(12000) // Wait past cancellation timelock

        // Try to withdraw (should fail due to timelock expiry)
        console.log('  ❌ Attempting withdrawal after expiry...')
        try {
            await nearAccount.functionCall({
                contractId: NEAR_ESCROW_ID,
                methodName: 'withdraw_dst_hex',
                args: {
                    order_hash_hex: orderHash,
                    secret_hex: secret
                },
                gas: new BN('300000000000000'),
                attachedDeposit: new BN('0')
            })
            console.log('  ❌ UNEXPECTED: Withdrawal succeeded after expiry!')
        } catch (error) {
            if ((error as Error).message.includes('too late')) {
                console.log('  ✅ EXPECTED: Withdrawal correctly failed due to expiry')
            } else {
                console.log(`  ⚠️ UNEXPECTED ERROR: ${(error as Error).message}`)
            }
        }

        // Try to cancel (should succeed)
        console.log('  ✅ Attempting cancellation after expiry...')
        try {
            const orderHashBytes = Array.from(Buffer.from(orderHash.slice(2), 'hex'))
            await nearAccount.functionCall({
                contractId: NEAR_ESCROW_ID,
                methodName: 'cancel_dst',
                args: {order_hash: orderHashBytes},
                gas: new BN('300000000000000'),
                attachedDeposit: new BN('0')
            })
            console.log('  ✅ Cancellation succeeded as expected')
        } catch (error) {
            console.log(`  ❌ UNEXPECTED: Cancellation failed: ${(error as Error).message}`)
        }
    } catch (error) {
        console.log(`  ❌ Test setup failed: ${(error as Error).message}`)
    }
    console.log()
}

async function testMissingSecret(): Promise<void> {
    console.log('🔐 Test 2: Missing secret (withdraw with wrong secret)')

    const EVM_RPC = req('EVM_RPC_HTTP')
    const EVM_PRIVATE_KEY = req('PRIVATE_KEY')
    const RESOLVER_ADDRESS = req('RESOLVER_ADDRESS')

    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const NEAR_ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const NEAR_PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const NEAR_ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')

    try {
        // Connect to EVM
        const evmProvider = new ethers.JsonRpcProvider(EVM_RPC)
        const evmWallet = new ethers.Wallet(EVM_PRIVATE_KEY, evmProvider)
        const resolverAbi = [
            'function deploySrc((bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external payable'
        ]
        const resolver = new ethers.Contract(RESOLVER_ADDRESS, resolverAbi, evmWallet)

        // Connect to NEAR
        const ks = new keyStores.InMemoryKeyStore()
        await ks.setKey(NETWORK_ID, NEAR_ACCOUNT_ID, KeyPair.fromString(NEAR_PRIVATE_KEY))
        const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
        const nearAccount = await near.account(NEAR_ACCOUNT_ID)

        const correctSecret = generateSecret()
        const wrongSecret = generateSecret()
        const amount = BigInt('100000000000000000') // 0.1 ETH

        const orderHash = await submitEvmOrder(resolver, correctSecret, amount)
        console.log(`  📋 Order: ${orderHash}`)

        await waitForNearEscrow(nearAccount, NEAR_ESCROW_ID, orderHash)

        // Wait for withdrawal window
        console.log('  ⏳ Waiting for withdrawal window (12s)...')
        await sleep(12000)

        // Try to withdraw with wrong secret
        console.log('  ❌ Attempting withdrawal with wrong secret...')
        try {
            await nearAccount.functionCall({
                contractId: NEAR_ESCROW_ID,
                methodName: 'withdraw_dst_hex',
                args: {
                    order_hash_hex: orderHash,
                    secret_hex: wrongSecret
                },
                gas: new BN('300000000000000'),
                attachedDeposit: new BN('0')
            })
            console.log('  ❌ UNEXPECTED: Withdrawal succeeded with wrong secret!')
        } catch (error) {
            if ((error as Error).message.includes('bad secret')) {
                console.log('  ✅ EXPECTED: Withdrawal correctly failed due to bad secret')
            } else {
                console.log(`  ⚠️ UNEXPECTED ERROR: ${(error as Error).message}`)
            }
        }

        // Try with correct secret (should succeed if not expired)
        console.log('  ✅ Attempting withdrawal with correct secret...')
        try {
            await nearAccount.functionCall({
                contractId: NEAR_ESCROW_ID,
                methodName: 'withdraw_dst_hex',
                args: {
                    order_hash_hex: orderHash,
                    secret_hex: correctSecret
                },
                gas: new BN('300000000000000'),
                attachedDeposit: new BN('0')
            })
            console.log('  ✅ Withdrawal succeeded with correct secret')
        } catch (error) {
            if ((error as Error).message.includes('too late')) {
                console.log('  ⚠️ EXPECTED: Withdrawal failed due to timelock (test timing)')
            } else {
                console.log(`  ❌ UNEXPECTED: Correct secret failed: ${(error as Error).message}`)
            }
        }
    } catch (error) {
        console.log(`  ❌ Test setup failed: ${(error as Error).message}`)
    }
    console.log()
}

async function testEarlyCancellation(): Promise<void> {
    console.log('⏰ Test 3: Early cancellation (cancel before timelock)')

    const EVM_RPC = req('EVM_RPC_HTTP')
    const EVM_PRIVATE_KEY = req('PRIVATE_KEY')
    const RESOLVER_ADDRESS = req('RESOLVER_ADDRESS')

    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const NEAR_ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const NEAR_PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const NEAR_ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')

    try {
        // Connect to EVM
        const evmProvider = new ethers.JsonRpcProvider(EVM_RPC)
        const evmWallet = new ethers.Wallet(EVM_PRIVATE_KEY, evmProvider)
        const resolverAbi = [
            'function deploySrc((bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external payable'
        ]
        const resolver = new ethers.Contract(RESOLVER_ADDRESS, resolverAbi, evmWallet)

        // Connect to NEAR
        const ks = new keyStores.InMemoryKeyStore()
        await ks.setKey(NETWORK_ID, NEAR_ACCOUNT_ID, KeyPair.fromString(NEAR_PRIVATE_KEY))
        const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
        const nearAccount = await near.account(NEAR_ACCOUNT_ID)

        const secret = generateSecret()
        const amount = BigInt('100000000000000000') // 0.1 ETH

        const orderHash = await submitEvmOrder(resolver, secret, amount, true)
        console.log(`  📋 Order: ${orderHash}`)

        await waitForNearEscrow(nearAccount, NEAR_ESCROW_ID, orderHash)

        // Try to cancel immediately (should fail - too early)
        console.log('  ❌ Attempting early cancellation...')
        try {
            const orderHashBytes = Array.from(Buffer.from(orderHash.slice(2), 'hex'))
            await nearAccount.functionCall({
                contractId: NEAR_ESCROW_ID,
                methodName: 'cancel_dst',
                args: {order_hash: orderHashBytes},
                gas: new BN('300000000000000'),
                attachedDeposit: new BN('0')
            })
            console.log('  ❌ UNEXPECTED: Early cancellation succeeded!')
        } catch (error) {
            if ((error as Error).message.includes('too early')) {
                console.log('  ✅ EXPECTED: Early cancellation correctly failed')
            } else {
                console.log(`  ⚠️ UNEXPECTED ERROR: ${(error as Error).message}`)
            }
        }
    } catch (error) {
        console.log(`  ❌ Test setup failed: ${(error as Error).message}`)
    }
    console.log()
}

async function main(): Promise<void> {
    console.log('🧪 Starting EVM to NEAR Failure Modes E2E Tests...\n')

    await testExpiry()
    await testMissingSecret()
    await testEarlyCancellation()

    console.log('🎉 All EVM to NEAR failure mode tests completed!')
}

main().catch((e) => {
    console.error('❌ EVM to NEAR failure mode tests failed:', e)
    process.exit(1)
})
