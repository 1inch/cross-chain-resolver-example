// Shared chain ID constants for agent and frontend
// Keep this file framework-agnostic so it can be imported from Node (agent) and Next.js (frontend).

export const EVM_CHAINS = {
    MAINNET: 1,
    SEPOLIA: 11155111,
    BSC_MAINNET: 56,
    BSC_TESTNET: 97
} as const

export const NEAR_CHAINS = {
    MAINNET: 397_000, // Example placeholder; align with your internal mapping if needed
    TESTNET: 397 // Example placeholder used in docs/protocol-spec.md
} as const

export type EvmChainId = (typeof EVM_CHAINS)[keyof typeof EVM_CHAINS]
export type NearChainId = (typeof NEAR_CHAINS)[keyof typeof NEAR_CHAINS]

export const CHAIN_NAMES: Record<number, string> = {
    [EVM_CHAINS.MAINNET]: 'ethereum-mainnet',
    [EVM_CHAINS.SEPOLIA]: 'ethereum-sepolia',
    [EVM_CHAINS.BSC_MAINNET]: 'bsc-mainnet',
    [EVM_CHAINS.BSC_TESTNET]: 'bsc-testnet',
    [NEAR_CHAINS.MAINNET]: 'near-mainnet',
    [NEAR_CHAINS.TESTNET]: 'near-testnet'
}

export function isNearChain(chainId: number): boolean {
    return chainId === NEAR_CHAINS.MAINNET || chainId === NEAR_CHAINS.TESTNET
}

export function isEvmChain(chainId: number): boolean {
    return !!CHAIN_NAMES[chainId] && !isNearChain(chainId)
}
