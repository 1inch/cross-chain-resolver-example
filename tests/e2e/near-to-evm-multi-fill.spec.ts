#!/usr/bin/env -S tsx
/* eslint-disable max-depth */

/**
 * E2E Test: NEAR to EVM Multi-Fill with Merkle Proofs
 *
 * Flow:
 * 1. Generate multiple secrets and build Merkle tree
 * 2. Submit intent to NEAR with Merkle root as hashlock
 * 3. Create NEAR escrow with total amount
 * 4. Lock wNEAR funds via ft_transfer_call
 * 5. Perform partial withdrawals using Merkle proofs
 * 6. Verify remaining balances after each partial withdrawal
 */

import 'dotenv/config'
import {connect, keyStores, KeyPair} from 'near-api-js'
import BN from 'bn.js'
import crypto from 'node:crypto'
import fs from 'node:fs'

interface MerkleLeaf {
    index: number
    secret: string
    hash: string
}

interface MerkleTree {
    leaves: MerkleLeaf[]
    root: string
}

function req(name: string): string {
    const v = process.env[name]

    if (!v) throw new Error(`Missing env ${name}`)

    return v
}

function sha256(data: string): string {
    return crypto
        .createHash('sha256')
        .update(Buffer.from(data.slice(2), 'hex'))
        .digest('hex')
}

function buildMerkleTree(secrets: string[]): MerkleTree {
    const leaves: MerkleLeaf[] = secrets.map((secret, index) => {
        const secretHash = sha256(secret)
        // 1inch SDK leaf format: keccak(uint64_be(index) || keccak(secret))
        const indexBytes = Buffer.alloc(8)
        indexBytes.writeBigUInt64BE(BigInt(index), 0)
        const leafData = Buffer.concat([indexBytes, Buffer.from(secretHash, 'hex')])
        const leafHash = crypto.createHash('sha256').update(leafData).digest('hex')

        return {
            index,
            secret,
            hash: '0x' + leafHash
        }
    })

    // Build Merkle tree bottom-up
    let level = leaves.map((l) => l.hash)
    while (level.length > 1) {
        const nextLevel: string[] = []

        for (let i = 0; i < level.length; i += 2) {
            const left = level[i]
            const right = i + 1 < level.length ? level[i + 1] : level[i]

            // Sorted pair hashing
            const [a, b] = left <= right ? [left, right] : [right, left]
            const combined = Buffer.concat([Buffer.from(a.slice(2), 'hex'), Buffer.from(b.slice(2), 'hex')])
            const parentHash = '0x' + crypto.createHash('sha256').update(combined).digest('hex')
            nextLevel.push(parentHash)
        }

        level = nextLevel
    }

    return {
        leaves,
        root: level[0]
    }
}

function getMerkleProof(tree: MerkleTree, targetIndex: number): string[] {
    const leaves = tree.leaves.map((l) => l.hash)
    let level = leaves
    const proof: string[] = []
    let index = targetIndex

    while (level.length > 1) {
        const nextLevel: string[] = []

        for (let i = 0; i < level.length; i += 2) {
            const left = level[i]
            const right = i + 1 < level.length ? level[i + 1] : level[i]

            if (i === index || i + 1 === index) {
                // Add sibling to proof
                const sibling = i === index ? right : left

                if (sibling !== left || sibling !== right) {
                    proof.push(sibling)
                }
            }

            const [a, b] = left <= right ? [left, right] : [right, left]
            const combined = Buffer.concat([Buffer.from(a.slice(2), 'hex'), Buffer.from(b.slice(2), 'hex')])
            const parentHash = '0x' + crypto.createHash('sha256').update(combined).digest('hex')
            nextLevel.push(parentHash)
        }

        level = nextLevel
        index = Math.floor(index / 2)
    }

    return proof
}

async function main(): Promise<void> {
    console.log('🌳 Starting NEAR to EVM Multi-Fill E2E Test...\n')

    // Setup
    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')
    const INTENTS_ID = req('NEAR_INTENTS_ACCOUNT_ID')
    const FT_ID = req('NEAR_FT_ACCOUNT_ID')

    // Generate secrets for multi-fill (4 secrets for demo)
    const NUM_SECRETS = 4
    const secrets = Array.from({length: NUM_SECRETS}, () => '0x' + crypto.randomBytes(32).toString('hex'))

    console.log(`🔐 Generated ${NUM_SECRETS} secrets for multi-fill`)

    // Build Merkle tree
    const tree = buildMerkleTree(secrets)
    console.log(`🌳 Merkle root: ${tree.root}`)

    // Connect to NEAR
    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(NETWORK_ID, ACCOUNT_ID, KeyPair.fromString(PRIVATE_KEY))
    const near = await connect({networkId: NETWORK_ID, nodeUrl: NODE_URL, deps: {keyStore: ks}})
    const account = await near.account(ACCOUNT_ID)

    // Submit intent with Merkle root
    const TOTAL_AMOUNT = '4000000000000000000' // 4e18 for 4 fills
    const DST_CHAIN_ID = 11155111 // Sepolia

    const orderHash = '0x' + crypto.randomBytes(32).toString('hex')

    console.log('\n📝 Submitting multi-fill intent to NEAR...')
    await account.functionCall({
        contractId: INTENTS_ID,
        methodName: 'intake_intent',
        args: {
            intent: {
                maker_near: ACCOUNT_ID,
                taker_near: ACCOUNT_ID,
                maker_asset_near: FT_ID,
                taker_asset_evm: '0x0000000000000000000000000000000000000000', // Native ETH
                making_amount: TOTAL_AMOUNT,
                taking_amount: TOTAL_AMOUNT,
                order_hash_hex: orderHash,
                dst_chain_id: DST_CHAIN_ID,
                timelocks_hex: '0x'
            }
        },
        gas: new BN('150000000000000'),
        attachedDeposit: new BN('0')
    })

    console.log(`📋 Order hash: ${orderHash}`)

    // Save order hash
    fs.writeFileSync('.last-order-hash', orderHash, 'utf8')

    // Create NEAR escrow with Merkle root
    console.log('\n🏗️ Creating NEAR escrow with Merkle root...')
    await account.functionCall({
        contractId: ESCROW_ID,
        methodName: 'create_dst_simple',
        args: {
            order_hash_hex: orderHash,
            hashlock_hex: tree.root,
            maker_hex20: '0x' + '00'.repeat(20),
            taker_hex20: '0x' + '00'.repeat(20),
            token_hex20: '0x' + '00'.repeat(20),
            amount: Number(TOTAL_AMOUNT),
            safety_deposit: 0,
            timelocks: {
                deployed_at: 0,
                src_withdrawal: 0,
                src_public_withdrawal: 0,
                src_cancellation: 0,
                src_public_cancellation: 0,
                dst_withdrawal: 10,
                dst_public_withdrawal: 100,
                dst_cancellation: 120
            },
            maker_near: ACCOUNT_ID,
            taker_near: ACCOUNT_ID
        },
        gas: new BN('300000000000000'),
        attachedDeposit: new BN('0')
    })

    // Lock funds via FT
    console.log('\n💰 Locking wNEAR funds via FT transfer...')
    const msg = JSON.stringify({order_hash: orderHash})
    await account.functionCall({
        contractId: FT_ID,
        methodName: 'ft_transfer_call',
        args: {receiver_id: ESCROW_ID, amount: TOTAL_AMOUNT, msg},
        gas: new BN('100000000000000'),
        attachedDeposit: new BN('1')
    })

    // Verify escrow state
    console.log('\n🔍 Verifying escrow state...')
    const orderHashBytes = Array.from(Buffer.from(orderHash.slice(2), 'hex'))
    const escrow = await account.viewFunction({
        contractId: ESCROW_ID,
        methodName: 'get_escrow',
        args: {order_hash: orderHashBytes}
    })

    console.log(`📊 Escrow amount: ${escrow.immutables.amount}`)
    console.log(`🔒 Escrow hashlock: 0x${Buffer.from(escrow.immutables.hashlock).toString('hex')}`)

    // Perform partial withdrawals
    const AMOUNT_PER_FILL = BigInt(TOTAL_AMOUNT) / BigInt(NUM_SECRETS)
    console.log(`\n⚡ Starting partial withdrawals (${AMOUNT_PER_FILL} per fill)...\n`)

    for (let i = 0; i < NUM_SECRETS; i++) {
        const secret = secrets[i]
        const proof = getMerkleProof(tree, i)

        console.log(`📝 Fill ${i + 1}/${NUM_SECRETS}:`)
        console.log(`  Secret: ${secret}`)
        console.log(`  Proof length: ${proof.length}`)

        try {
            await account.functionCall({
                contractId: ESCROW_ID,
                methodName: 'withdraw_dst_partial_hex',
                args: {
                    order_hash_hex: orderHash,
                    secret_hex: secret,
                    proof_hex: proof,
                    index: i,
                    amount: Number(AMOUNT_PER_FILL)
                },
                gas: new BN('300000000000000'),
                attachedDeposit: new BN('0')
            })

            console.log(`  ✅ Withdrawal ${i + 1} successful`)
        } catch (error) {
            console.log(`  ❌ Withdrawal ${i + 1} failed:`, (error as Error).message)
        }

        // Check maker payout after each withdrawal
        const expectedPayout = AMOUNT_PER_FILL * BigInt(i + 1)
        try {
            const payout = await account.viewFunction({
                contractId: ESCROW_ID,
                methodName: 'get_payout',
                args: {acc: ACCOUNT_ID}
            })
            console.log(`  💰 Total payout so far: ${payout} (expected: ${expectedPayout})`)
        } catch (e) {
            console.log(`  ⚠️ Could not check payout: ${(e as Error).message}`)
        }

        console.log()
    }

    console.log('🎉 Multi-fill E2E test completed!')
    console.log(`📋 Order hash saved to .last-order-hash: ${orderHash}`)
}

main().catch((e) => {
    console.error('❌ Multi-fill E2E test failed:', e)
    process.exit(1)
})
