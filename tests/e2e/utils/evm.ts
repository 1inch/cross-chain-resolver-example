/* eslint-disable max-depth */
import {JsonRpcProvider, Log, Contract} from 'ethers'
import type {Env} from './env'

export function getEvmProvider(env: Env): JsonRpcProvider {
    if (!env.EVM_RPC_URL) throw new Error('Missing EVM_RPC_URL')

    return new JsonRpcProvider(env.EVM_RPC_URL)
}

export async function nativeBalanceOf(env: Env, holder: string): Promise<bigint> {
    const provider = getEvmProvider(env)

    return provider.getBalance(holder)
}

export async function waitForNativeDelta(
    env: Env,
    holder: string,
    minDelta: bigint,
    timeoutMs = 120_000,
    intervalMs = 5_000
): Promise<{before: bigint; after: bigint; ok: boolean}> {
    const before = await nativeBalanceOf(env, holder)
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
        const after = await nativeBalanceOf(env, holder)

        if (after - before >= minDelta) {
            return {before, after, ok: true}
        }

        await new Promise((r) => setTimeout(r, intervalMs))
    }
    const after = await nativeBalanceOf(env, holder)

    return {before, after, ok: after - before >= minDelta}
}

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']

export async function erc20BalanceOf(env: Env, token: string, holder: string): Promise<bigint> {
    const provider = getEvmProvider(env)
    const erc20 = new Contract(token, ERC20_ABI, provider)
    const bal: bigint = await erc20.balanceOf(holder)

    return bal
}

export async function erc20Decimals(env: Env, token: string): Promise<number> {
    const provider = getEvmProvider(env)
    const erc20 = new Contract(token, ERC20_ABI, provider)
    const d: number = await erc20.decimals()

    return Number(d)
}

export async function waitForErc20Delta(
    env: Env,
    token: string,
    holder: string,
    minDelta: bigint,
    timeoutMs = 120_000,
    intervalMs = 5_000
): Promise<{before: bigint; after: bigint; ok: boolean}> {
    const before = await erc20BalanceOf(env, token, holder)
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
        const after = await erc20BalanceOf(env, token, holder)

        if (after - before >= minDelta) {
            return {before, after, ok: true}
        }

        await new Promise((r) => setTimeout(r, intervalMs))
    }
    const after = await erc20BalanceOf(env, token, holder)

    return {before, after, ok: after - before >= minDelta}
}

export async function findResolverLogForOrder(env: Env, orderHashHex: string): Promise<Log | null> {
    if (!env.RESOLVER_ADDRESS || !env.EVM_RPC_URL) return null

    const provider = getEvmProvider(env)
    const needle = orderHashHex.toLowerCase().replace(/^0x/, '')
    const window = env.EVM_LOG_WINDOW && env.EVM_LOG_WINDOW > 0 ? env.EVM_LOG_WINDOW : 10
    const windowsBack = env.EVM_LOG_BACKOFF_WINDOWS && env.EVM_LOG_BACKOFF_WINDOWS > 0 ? env.EVM_LOG_BACKOFF_WINDOWS : 8

    // Outer wait loop: allow the agent some time to fill and emit logs
    const started = Date.now()
    const TIMEOUT_MS = 120_000
    while (Date.now() - started < TIMEOUT_MS) {
        const latest = await provider.getBlockNumber()

        for (let w = 0; w < windowsBack; w++) {
            const toBlock = latest - w * window
            const fromBlock = Math.max(0, toBlock - window)
            try {
                // debug: show scanned window to help with Free-tier ranges
                // eslint-disable-next-line no-console
                console.log(`[logs] scanning ${env.RESOLVER_ADDRESS} blocks [${fromBlock}, ${toBlock}] window=${window}`)
                const logs = await provider.getLogs({ address: env.RESOLVER_ADDRESS, fromBlock, toBlock })
                for (const l of logs) {
                    const data = l.data.toLowerCase().replace(/^0x/, '')
                    if (data.includes(needle)) return l
                    for (const t of l.topics) {
                        if (t.toLowerCase().replace(/^0x/, '') === needle) return l
                    }
                }
            } catch {
                // ignore provider window errors; next iteration will try a different window
            }
        }

        // not found; short sleep then retry
        await new Promise((r) => setTimeout(r, 5000))
    }
    return null
}
