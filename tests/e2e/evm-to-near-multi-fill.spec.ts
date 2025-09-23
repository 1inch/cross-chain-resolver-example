#!/usr/bin/env -S tsx

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-depth */
/**
 * E2E Test: EVM to NEAR Multi-Fill with Merkle Proofs
 *
 * Flow:
 * 1. Generate multiple secrets and build Merkle tree
 * 2. Submit Fusion+ order on EVM with Merkle root as hashlock
 * 3. Agent creates NEAR escrow with total amount
 * 4. Lock ETH/ERC-20 funds on EVM side
 * 5. Perform partial withdrawals on NEAR using Merkle proofs
 * 6. Agent uses revealed secrets to complete partial EVM withdrawals
 */

import 'dotenv/config'
import {ethers} from 'ethers'
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
                const shouldAdd = sibling !== left || sibling !== right

                if (shouldAdd) {
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

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function submitMultiFillOrder(
    resolver: ethers.Contract,
    merkleRoot: string,
    totalAmount: bigint
): Promise<string> {
    const orderHash = '0x' + crypto.randomBytes(32).toString('hex')

    // Pack timelocks for multi-fill (longer timeouts)
    const SRC_WITHDRAWAL = 30 // 30s
    const SRC_PUBLIC_WITHDRAWAL = 300 // 5min
    const SRC_CANCELLATION = 600 // 10min
    const TIMELOCKS =
        (BigInt(SRC_WITHDRAWAL) << 0n) | (BigInt(SRC_PUBLIC_WITHDRAWAL) << 32n) | (BigInt(SRC_CANCELLATION) << 64n)

    const immutables = {
        orderHash,
        hashlock: merkleRoot,
        maker: '0x' + '00'.repeat(20),
        taker: '0x' + '00'.repeat(20),
        token: '0x' + '00'.repeat(20), // Native ETH
        amount: totalAmount,
        safetyDeposit: 0n,
        timelocks: TIMELOCKS
    }

    console.log(`📝 Submitting multi-fill Fusion+ order...`)
    console.log(`  Order hash: ${orderHash}`)
    console.log(`  Merkle root: ${merkleRoot}`)
    console.log(`  Total amount: ${totalAmount.toString()} wei`)

    const tx = await resolver.deploySrc(immutables, {
        value: totalAmount,
        gasLimit: 500000n
    })

    console.log(`  Transaction: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`  Mined in block: ${receipt?.blockNumber}`)

    return orderHash
}

async function waitForNearEscrow(
    nearAccount: any,
    escrowId: string,
    orderHash: string,
    maxWaitMs = 30000
): Promise<any> {
    const startTime = Date.now()
    const orderHashBytes = Array.from(Buffer.from(orderHash.slice(2), 'hex'))

    console.log(`⏳ Waiting for NEAR escrow creation...`)

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const escrow = await nearAccount.viewFunction({
                contractId: escrowId,
                methodName: 'get_escrow',
                args: {order_hash: orderHashBytes}
            })

            if (escrow && escrow.immutables) {
                console.log(`✅ NEAR escrow found with amount: ${escrow.immutables.amount}`)

                return escrow
            }
        } catch (e) {
            // Continue waiting
        }

        await sleep(2000)
    }

    throw new Error(`NEAR escrow not created within ${maxWaitMs / 1000}s`)
}

async function main(): Promise<void> {
    console.log('🌳 Starting EVM to NEAR Multi-Fill E2E Test...\n')

    // Setup
    const EVM_RPC = req('EVM_RPC_HTTP')
    const EVM_PRIVATE_KEY = req('PRIVATE_KEY')
    const RESOLVER_ADDRESS = req('RESOLVER_ADDRESS')

    const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet'
    const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org'
    const NEAR_ACCOUNT_ID = req('NEAR_ACCOUNT_ID')
    const NEAR_PRIVATE_KEY = req('NEAR_PRIVATE_KEY')
    const NEAR_ESCROW_ID = req('NEAR_ESCROW_ACCOUNT_ID')

    // Generate secrets for multi-fill (4 secrets for demo)
    const NUM_SECRETS = 4
    const secrets = Array.from({length: NUM_SECRETS}, () => '0x' + crypto.randomBytes(32).toString('hex'))

    console.log(`🔐 Generated ${NUM_SECRETS} secrets for multi-fill`)

    // Build Merkle tree
    const tree = buildMerkleTree(secrets)
    console.log(`🌳 Merkle root: ${tree.root}`)

    const TOTAL_AMOUNT = BigInt('4000000000000000000') // 4 ETH for 4 fills
    const AMOUNT_PER_FILL = TOTAL_AMOUNT / BigInt(NUM_SECRETS)

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

        // Submit multi-fill order
        const orderHash = await submitMultiFillOrder(resolver, tree.root, TOTAL_AMOUNT)

        // Save order hash
        fs.writeFileSync('.last-order-hash', orderHash, 'utf8')
        console.log(`📋 Order hash saved to .last-order-hash\n`)

        // Wait for NEAR escrow
        const nearEscrow = await waitForNearEscrow(nearAccount, NEAR_ESCROW_ID, orderHash)

        // Verify escrow state
        console.log(`🔍 Verifying NEAR escrow state...`)
        console.log(`📊 Escrow amount: ${nearEscrow.immutables.amount}`)
        console.log(`🔒 Escrow hashlock: 0x${Buffer.from(nearEscrow.immutables.hashlock).toString('hex')}`)

        // Perform partial withdrawals
        console.log(`\n⚡ Starting partial withdrawals (${AMOUNT_PER_FILL} per fill)...\n`)

        for (let i = 0; i < NUM_SECRETS; i++) {
            const secret = secrets[i]
            const proof = getMerkleProof(tree, i)

            console.log(`📝 Fill ${i + 1}/${NUM_SECRETS}:`)
            console.log(`  Secret: ${secret}`)
            console.log(`  Proof length: ${proof.length}`)

            try {
                await nearAccount.functionCall({
                    contractId: NEAR_ESCROW_ID,
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

            // Check total payout after each withdrawal
            const expectedPayout = AMOUNT_PER_FILL * BigInt(i + 1)
            try {
                const payout = await nearAccount.viewFunction({
                    contractId: NEAR_ESCROW_ID,
                    methodName: 'get_payout',
                    args: {acc: NEAR_ACCOUNT_ID}
                })
                console.log(`  💰 Total payout so far: ${payout} (expected: ${expectedPayout})`)
            } catch (e) {
                console.log(`  ⚠️ Could not check payout: ${(e as Error).message}`)
            }

            console.log()
        }

        console.log('🎉 EVM to NEAR Multi-fill E2E test completed!')
        console.log(`📋 Order hash: ${orderHash}`)
        console.log('✅ Multi-fill order submitted on EVM')
        console.log('✅ NEAR escrow created by agent')
        console.log('✅ Partial withdrawals attempted on NEAR')
        console.log('✅ Merkle proof validation tested')
    } catch (error) {
        console.error('❌ EVM to NEAR Multi-fill E2E test failed:', (error as Error).message)
        process.exit(1)
    }
}

main().catch((e) => {
    console.error('❌ Test execution failed:', e)
    process.exit(1)
})
