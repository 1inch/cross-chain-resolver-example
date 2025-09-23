import 'dotenv/config'

export type Env = {
    NEAR_NETWORK: string
    NEAR_NODE_URL: string
    NEAR_ACCOUNT_ID: string
    NEAR_PRIVATE_KEY: string
    NEAR_INTENTS_ACCOUNT_ID: string
    NEAR_ESCROW_ACCOUNT_ID?: string
    TOKEN_HEX20?: string
    EVM_RPC_URL?: string
    EVM_PRIVATE_KEY?: string
    RESOLVER_ADDRESS?: string
    EVM_RECIPIENT?: string
    EVM_TAKING_HUMAN?: string
    EVM_LOG_WINDOW?: number
    EVM_LOG_BACKOFF_WINDOWS?: number
}

export function getEnv(): Env {
    const e = process.env
    const required = [
        'NEAR_NETWORK',
        'NEAR_NODE_URL',
        'NEAR_ACCOUNT_ID',
        'NEAR_PRIVATE_KEY',
        'NEAR_INTENTS_ACCOUNT_ID'
    ] as const

    for (const k of required) {
        if (!e[k]) throw new Error(`Missing env ${k}`)
    }

    return {
        NEAR_NETWORK: e.NEAR_NETWORK!,
        NEAR_NODE_URL: e.NEAR_NODE_URL!,
        NEAR_ACCOUNT_ID: e.NEAR_ACCOUNT_ID!,
        NEAR_PRIVATE_KEY: e.NEAR_PRIVATE_KEY!,
        NEAR_INTENTS_ACCOUNT_ID: e.NEAR_INTENTS_ACCOUNT_ID!,
        NEAR_ESCROW_ACCOUNT_ID: e.NEAR_ESCROW_ACCOUNT_ID,
        TOKEN_HEX20: e.TOKEN_HEX20,
        EVM_RPC_URL: e.EVM_RPC_URL,
        EVM_PRIVATE_KEY: e.EVM_PRIVATE_KEY,
        RESOLVER_ADDRESS: e.RESOLVER_ADDRESS,
        EVM_RECIPIENT: e.EVM_RECIPIENT,
        EVM_TAKING_HUMAN: e.EVM_TAKING_HUMAN,
        EVM_LOG_WINDOW: e.EVM_LOG_WINDOW ? Number(e.EVM_LOG_WINDOW) : undefined,
        EVM_LOG_BACKOFF_WINDOWS: e.EVM_LOG_BACKOFF_WINDOWS ? Number(e.EVM_LOG_BACKOFF_WINDOWS) : undefined
    }
}
