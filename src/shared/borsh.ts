// Minimal Borsh schema stubs for agent-side (TypeScript)
// NOTE: This is a stub to align types and field ordering with the Rust structs.
// Actual encoding/decoding can be implemented with the `borsh` npm package or a custom encoder.

export type TimelocksExpanded = {
    deployed_at: bigint // u64
    src_withdrawal: number // u32
    src_public_withdrawal: number // u32
    src_cancellation: number // u32
    src_public_cancellation: number // u32
    dst_withdrawal: number // u32
    dst_public_withdrawal: number // u32
    dst_cancellation: number // u32
}

export type ImmutablesBorsh = {
    order_hash: Uint8Array // length 32
    hashlock: Uint8Array // length 32
    maker: Uint8Array // length 20
    taker: Uint8Array // length 20
    token: Uint8Array // length 20
    amount: bigint // u128
    safety_deposit: bigint // u128
    timelocks: TimelocksExpanded
}

// Placeholder encoder/decoder to document expected field order.
// Replace with a real Borsh implementation when integrating the agent.
export function encodeImmutablesBorsh(_v: ImmutablesBorsh): Uint8Array {
    // TODO: Implement using `borsh` npm package or a custom encoder matching Rust struct layout.
    throw new Error('encodeImmutablesBorsh not implemented')
}

export function decodeImmutablesBorsh(_bytes: Uint8Array): ImmutablesBorsh {
    // TODO: Implement using `borsh` npm package or a custom decoder matching Rust struct layout.
    throw new Error('decodeImmutablesBorsh not implemented')
}
