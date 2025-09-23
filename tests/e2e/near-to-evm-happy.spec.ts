#!/usr/bin/env -S tsx
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import {parseUnits, isAddress} from 'ethers'
import fs from 'node:fs'
import path from 'node:path'
import {getEnv} from './utils/env'
import {intakeIntent} from './utils/near'
import {randomHex} from './utils/secrets'
import {findResolverLogForOrder, waitForErc20Delta, waitForNativeDelta, erc20Decimals} from './utils/evm'

async function main() {
    const env = getEnv()

    // Resolve taking_amount from human-friendly env (if provided)
    const t = env.TOKEN_HEX20?.toLowerCase()
    const isNative = !t || t === 'native' || t === 'eth'
    const human = env.EVM_TAKING_HUMAN || '2'
    let takingAmountWei: bigint

    if (isNative) {
        takingAmountWei = BigInt(parseUnits(human, 18).toString())
    } else {
        const decimals = await erc20Decimals(env, env.TOKEN_HEX20!)
        takingAmountWei = BigInt(parseUnits(human, decimals).toString())
    }

    // Construct a minimal intent matching your contract schema
    const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
    const intent = {
        maker_near: env.NEAR_ACCOUNT_ID,
        taker_near: env.NEAR_ACCOUNT_ID,
        maker_asset_near: 'wrap.testnet',
        taker_asset_evm: isNative ? ZERO_ADDR : env.TOKEN_HEX20 || '0xdd13e55209fd76afe204dbda4007c227904f0a81',
        making_amount: '2000000000000000000',
        taking_amount: takingAmountWei.toString(),
        order_hash_hex: randomHex(32),
        dst_chain_id: 11155111,
        timelocks_hex: '0x'
    }

    console.log('Submitting intent to', env.NEAR_INTENTS_ACCOUNT_ID)
    const {tx} = await intakeIntent(env, intent)
    console.log('Submitted tx:', tx)
    console.log('ORDER_HASH_HEX:', intent.order_hash_hex)
    try {
        const outPath = path.resolve('.last-order-hash')
        fs.writeFileSync(outPath, String(intent.order_hash_hex), 'utf8')
        console.log('Saved last order hash to', outPath)
    } catch {
        // ignore
    }

    // Optional: verify on EVM resolver if env present and agent has mirrored/fill executed
    if (env.EVM_RPC_URL && env.RESOLVER_ADDRESS && isAddress(env.RESOLVER_ADDRESS)) {
        console.log('Verifying on EVM resolver logs for order hash', intent.order_hash_hex)
        const started = Date.now()
        let found = null
        while (Date.now() - started < 120_000) {
            // wait up to 2 minutes
            found = await findResolverLogForOrder(env, intent.order_hash_hex)

            if (found) break

            await new Promise((r) => setTimeout(r, 5000))
        }

        if (found) {
            console.log('EVM resolver log found at block', found.blockNumber, 'tx', found.transactionHash)
        } else {
            console.warn('EVM verification: no log found within timeout (this is OK if agent not running yet)')
        }
    } else {
        console.log('EVM verification skipped (set EVM_RPC_URL and RESOLVER_ADDRESS to enable).')
    }

    // Optional: Balance delta check on recipient (native ETH or ERC-20)
    if (env.EVM_RPC_URL && env.EVM_RECIPIENT) {
        const minDelta = BigInt(intent.taking_amount)
        const t = env.TOKEN_HEX20?.toLowerCase()
        const isNative = !t || t === 'native' || t === 'eth'

        if (isNative) {
            console.log('Waiting for native ETH balance delta on', env.EVM_RECIPIENT, '>=', minDelta.toString(), 'wei')
            const {before, after, ok} = await waitForNativeDelta(env, env.EVM_RECIPIENT, minDelta)

            if (ok) {
                console.log('Native delta OK. Before=', before.toString(), 'After=', after.toString())
            } else {
                console.warn('Native delta NOT reached. Before=', before.toString(), 'After=', after.toString())
            }
        } else if (env.TOKEN_HEX20 && isAddress(env.TOKEN_HEX20)) {
            console.log(
                'Waiting for ERC-20 balance delta on',
                env.EVM_RECIPIENT,
                'token',
                env.TOKEN_HEX20,
                '>=',
                minDelta.toString()
            )
        } else if (env.TOKEN_HEX20) {
            console.log(
                'Waiting for ERC-20 balance delta on',
                env.EVM_RECIPIENT,
                'token',
                env.TOKEN_HEX20,
                '>=',
                minDelta.toString()
            )
            const {before, after, ok} = await waitForErc20Delta(env, env.TOKEN_HEX20, env.EVM_RECIPIENT, minDelta)

            if (ok) {
                console.log('ERC-20 delta OK. Before=', before.toString(), 'After=', after.toString())
            } else {
                console.warn('ERC-20 delta NOT reached. Before=', before.toString(), 'After=', after.toString())
            }
        }
    } else {
        console.log('Balance delta check skipped (set EVM_RPC_URL and EVM_RECIPIENT; TOKEN_HEX20 optional for ERC-20).')
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
