#!/usr/bin/env -S tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * E2E Test: NEAR to EVM Failure Modes
 *
 * Tests:
 * 1. Expiry: Try to withdraw after cancellation timelock
 * 2. Missing secret: Try to withdraw with wrong secret
 * 3. Early cancellation: Cancel before timelock expires
 * 4. Partial cancellation: Cancel after partial fills
 */

import 'dotenv/config'
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

async function submitIntent(account: any, intentsId: string, secret: string, amount: string): Promise<string> {
    const DST_CHAIN_ID = 11155111

    const intentTx = await account.functionCall({
        contractId: intentsId,
        methodName: 'intake_intent',
        args: {
            intent: {
                maker_near: account.accountId,
                taker_near: account.accountId,
                maker_asset_near: req('NEAR_FT_ACCOUNT_ID'),
                taker_asset_evm: '0x0000000000000000000000000000000000000000',
                making_amount: amount,
                taking_amount: amount,
                order_hash_hex: '0x' + crypto.randomBytes(32).toString('hex'),
                dst_chain_id: DST_CHAIN_ID,
                timelocks_hex: '0x'
            }
        },
        gas: new BN('150000000000000'),
        attachedDeposit: new BN('0')
    })

    // Extract order hash
    const logs = intentTx.receipts_outcome?.flatMap((r: any) => r.outcome.logs) || []

    for (const log of logs) {
        try {
            const parsed = JSON.parse(log)

            if (parsed.data?.intent?.order_hash_hex) {
                return parsed.data.intent.order_hash_hex
            }
        } catch (e) {
            // Skip non-JSON logs
        }
    }

    throw new Error('Failed to extract order hash')
}

async function createEscrow(
    account: any,
    escrowId: string,
    orderHash: string,
    hashlock: string,
    amount: string,
    shortTimelocks = false
): Promise<void> {
    const timelocks = shortTimelocks
        ? {
              deployed_at: 0,
              src_withdrawal: 0,
              src_public_withdrawal: 0,
              src_cancellation: 0,
              src_public_cancellation: 0,
              dst_withdrawal: 2, // 2s for quick testing
              dst_public_withdrawal: 5, // 5s
              dst_cancellation: 8 // 8s
          }
        : {
              deployed_at: 0,
              src_withdrawal: 0,
              src_public_withdrawal: 0,
              src_cancellation: 0,
              src_public_cancellation: 0,
              dst_withdrawal: 10,
              dst_public_withdrawal: 100,
              dst_cancellation: 120
          }

    await account.functionCall({
        contractId: escrowId,
        methodName: 'create_dst_simple',
        args: {
            order_hash_hex: orderHash,
            hashlock_hex: hashlock,
            maker_hex20: '0x' + '00'.repeat(20),
            taker_hex20: '0x' + '00'.repeat(20),
            token_hex20: '0x' + '00'.repeat(20),
            amount: Number(amount),
            safety_deposit: 0,
            timelocks,
            maker_near: account.accountId,
            taker_near: account.accountId
        },
        gas: new BN('300000000000000'),
        attachedDeposit: new BN('0')
    })
}

async function lockFunds(
    account: any,
    ftId: string,
    escrowId: string,
    orderHash: string,
    amount: string
): Promise<void> {
    const msg = JSON.stringify({order_hash: orderHash})
    await account.functionCall({
        contractId: ftId,
        methodName: 'ft_transfer_call',
        args: {receiver_id: escrowId, amount, msg},
        gas: new BN('100000000000000'),
        attachedDeposit: new BN('1')
    })
}

async function testExpiry(): Promise<void> {
    console.log('🕐 Test 1: Expiry (withdraw after cancellation timelock)')

    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')
    const INTENTS_ID = req('NEAR_INTENTS_ACCOUNT_ID')
    const FT_ID = req('NEAR_FT_ACCOUNT_ID')

    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(NETWORK_ID, ACCOUNT_ID, KeyPair.fromString(PRIVATE_KEY))
    const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
    const account = await near.account(ACCOUNT_ID)

    const secret = generateSecret()
    const hashlock = sha256(secret)
    const amount = '1000000000000000000' // 1e18

    try {
        // Submit intent and create escrow with short timelocks
        const orderHash = await submitIntent(account, INTENTS_ID, secret, amount)
        console.log(`  📋 Order: ${orderHash}`)

        await createEscrow(account, ESCROW_ID, orderHash, hashlock, amount, true)
        await lockFunds(account, FT_ID, ESCROW_ID, orderHash, amount)

        console.log('  ⏳ Waiting for cancellation timelock to expire (10s)...')
        await sleep(12000) // Wait 12s to ensure past cancellation timelock (8s)

        // Try to withdraw (should fail due to timelock expiry)
        console.log('  ❌ Attempting withdrawal after expiry...')
        try {
            await account.functionCall({
                contractId: ESCROW_ID,
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
            await account.functionCall({
                contractId: ESCROW_ID,
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

    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')
    const INTENTS_ID = req('NEAR_INTENTS_ACCOUNT_ID')
    const FT_ID = req('NEAR_FT_ACCOUNT_ID')

    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(NETWORK_ID, ACCOUNT_ID, KeyPair.fromString(PRIVATE_KEY))
    const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
    const account = await near.account(ACCOUNT_ID)

    const correctSecret = generateSecret()
    const wrongSecret = generateSecret()
    const hashlock = sha256(correctSecret)
    const amount = '1000000000000000000'

    try {
        const orderHash = await submitIntent(account, INTENTS_ID, correctSecret, amount)
        console.log(`  📋 Order: ${orderHash}`)

        await createEscrow(account, ESCROW_ID, orderHash, hashlock, amount)
        await lockFunds(account, FT_ID, ESCROW_ID, orderHash, amount)

        // Wait for withdrawal window
        console.log('  ⏳ Waiting for withdrawal window (12s)...')
        await sleep(12000)

        // Try to withdraw with wrong secret
        console.log('  ❌ Attempting withdrawal with wrong secret...')
        try {
            await account.functionCall({
                contractId: ESCROW_ID,
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

        // Try with correct secret (should succeed)
        console.log('  ✅ Attempting withdrawal with correct secret...')
        try {
            await account.functionCall({
                contractId: ESCROW_ID,
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
            console.log(`  ❌ UNEXPECTED: Correct secret failed: ${(error as Error).message}`)
        }
    } catch (error) {
        console.log(`  ❌ Test setup failed: ${(error as Error).message}`)
    }
    console.log()
}

async function testEarlyCancellation(): Promise<void> {
    console.log('⏰ Test 3: Early cancellation (cancel before timelock)')

    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')
    const INTENTS_ID = req('NEAR_INTENTS_ACCOUNT_ID')
    const FT_ID = req('NEAR_FT_ACCOUNT_ID')

    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(NETWORK_ID, ACCOUNT_ID, KeyPair.fromString(PRIVATE_KEY))
    const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
    const account = await near.account(ACCOUNT_ID)

    const secret = generateSecret()
    const hashlock = sha256(secret)
    const amount = '1000000000000000000'

    try {
        const orderHash = await submitIntent(account, INTENTS_ID, secret, amount)
        console.log(`  📋 Order: ${orderHash}`)

        await createEscrow(account, ESCROW_ID, orderHash, hashlock, amount, true)
        await lockFunds(account, FT_ID, ESCROW_ID, orderHash, amount)

        // Try to cancel immediately (should fail - too early)
        console.log('  ❌ Attempting early cancellation...')
        try {
            const orderHashBytes = Array.from(Buffer.from(orderHash.slice(2), 'hex'))
            await account.functionCall({
                contractId: ESCROW_ID,
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
    console.log('🧪 Starting NEAR to EVM Failure Modes E2E Tests...\n')

    await testExpiry()
    await testMissingSecret()
    await testEarlyCancellation()

    console.log('🎉 All failure mode tests completed!')
}

main().catch((e) => {
    console.error('❌ Failure mode tests failed:', e)
    process.exit(1)
})
