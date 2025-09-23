# Protocol Spec: Canonical Payload and Event Schema for Ethereum <-> NEAR Atomic Swaps

This document defines the canonical payload schema, encoding rules, and the EVM event interface used by the decentralized solver (Shade Agent) to mirror HTLC escrows across Ethereum and NEAR.

Goals:

- Preserve hashlock/timelock semantics across chains
- Support single-fill and multi-fill (Merkle) modes
- Keep 1inch Fusion+ integration on EVM side without relying on 1inch REST backends
- Avoid contract signature changes to keep existing tests green; use events for cross-chain metadata

## 1. Canonical Payload (EVM ABI encoding)

The canonical payload is the ABI-encoded representation of the immutable swap parameters, equivalent to the EVM-side `IBaseEscrow.Immutables` struct. Off-chain components convert this ABI payload to the NEAR/Borsh format when mirroring on NEAR.

TypeScript pseudo-struct (for clarity; actual ABI layout matches Solidity):

```ts
export type ImmutablesCanonical = {
    // Assets and parties
    maker: string // EVM address
    taker: string // EVM address (resolver/whitelisted)
    makerAsset: string // ERC-20 address
    takerAsset: string // ERC-20 or placeholder for NEP-141 counterpart on NEAR

    // Amounts
    makingAmount: bigint // uint256
    takingAmount: bigint // uint256

    // Hashlock/Timelocks
    hashLockRoot: string // bytes32 (single-fill: sha256(secret); multi-fill: Merkle root)
    timelocks: {
        srcWithdrawal: bigint // uint32/uint64 depending on lib; seconds
        srcPublicWithdrawal: bigint // seconds
        srcCancellation: bigint // seconds
        srcPublicCancellation: bigint // seconds
        dstWithdrawal: bigint // seconds
        dstPublicWithdrawal: bigint // seconds
        dstCancellation: bigint // seconds
        deployedAt: bigint // set at src deployment
    }

    // Economic security
    srcSafetyDeposit: bigint // wei
    dstSafetyDeposit: bigint // wei or yoctoNEAR equivalent (mirrored semantics on NEAR)

    // Misc
    salt: bigint // unique maker salt/nonce
    srcChainId: bigint // EVM source chain id (redundant but helpful off-chain)
    dstChainId: bigint // NEAR chain id (use a fixed constant for NEAR Testnet)
}
```

### 1.1 Exact Solidity ABI field ordering

Based on `contracts/lib/cross-chain-swap/contracts/interfaces/IBaseEscrow.sol`:

Solidity struct layout (ABI order):

| Index | Field         | Solidity Type | Notes                                        |
| ----: | ------------- | ------------- | -------------------------------------------- |
|     0 | orderHash     | bytes32       | Hash of the Fusion/L1 order                  |
|     1 | hashlock      | bytes32       | sha256(secret) or Merkle root for multi-fill |
|     2 | maker         | address       | `Address` lib wraps `address` for ABI        |
|     3 | taker         | address       | `Address` lib wraps `address` for ABI        |
|     4 | token         | address       | Asset address on the current chain           |
|     5 | amount        | uint256       | Total amount for this side                   |
|     6 | safetyDeposit | uint256       | Native token deposit in wei                  |
|     7 | timelocks     | uint256       | Packed per `TimelocksLib` (see below)        |

Timelocks packing per `contracts/lib/cross-chain-swap/contracts/libraries/TimelocksLib.sol`:

- Stored in a single `uint256` where the top 32 bits (offset 224) encode `deployedAt` (timestamp).
- Seven 32-bit offsets (seconds) are added to `deployedAt` when accessed via `get(stage)` for the stages:
    - 0: SrcWithdrawal, 1: SrcPublicWithdrawal, 2: SrcCancellation, 3: SrcPublicCancellation,
    - 4: DstWithdrawal, 5: DstPublicWithdrawal, 6: DstCancellation.

Practical guidance: the ABI-encoded `Immutables` is simply `abi.encode(orderHash, hashlock, maker, taker, token, amount, safetyDeposit, timelocks)`.

### 1.2 NEAR Borsh mapping

On NEAR we expand the packed `timelocks` into explicit fields for clarity and safety. Suggested Borsh struct (Rust):

```rust
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize)]
pub struct TimelocksExpanded {
    pub deployed_at: u64,              // seconds since epoch
    pub src_withdrawal: u32,           // offsets in seconds
    pub src_public_withdrawal: u32,
    pub src_cancellation: u32,
    pub src_public_cancellation: u32,
    pub dst_withdrawal: u32,
    pub dst_public_withdrawal: u32,
    pub dst_cancellation: u32,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct ImmutablesBorsh {
    pub order_hash: [u8; 32],
    pub hashlock: [u8; 32],
    pub maker: [u8; 20],               // EVM address as 20-byte array
    pub taker: [u8; 20],
    pub token: [u8; 20],               // On NEAR this can be a mapping key to NEP-141
    pub amount: u128,
    pub safety_deposit: u128,
    pub timelocks: TimelocksExpanded,
}
```

And a minimal TypeScript representation for agent-side Borsh encoding:

```ts
// Pseudocode: keep aligned with Rust struct field order
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
```

Notes:

- The exact Solidity layout comes from `IBaseEscrow.Immutables`. We emit the entire struct via ABI encoding in events. Off-chain components unpack using the known ABI, then map to NEAR types for Borsh.
- For multi-fill, `hashLockRoot` is the Merkle root; per-fill proofs and indexes are provided during interaction (not part of the canonical payload).

## 2. Event Interface (EVM)

To avoid changing existing function signatures, we expose canonical payloads via events on the resolver:

- `SrcEscrowPlanned(IBaseEscrow.Immutables immutables, uint256 srcChainId, bytes canonicalPayload)`
    - Emitted by `deploySrc(...)` after `immutables.deployedAt` is set and funding is transferred to the computed escrow.
    - `canonicalPayload` is `abi.encode(immutables)`.
    - `srcChainId` is `block.chainid`.

- `DstEscrowCreated(IBaseEscrow.Immutables dstImmutables, uint256 srcCancellationTimestamp, uint256 dstChainId, bytes canonicalPayload)`
    - Emitted by `deployDst(...)` upon destination escrow creation request.
    - `dstChainId` is `block.chainid`.
    - `canonicalPayload` is `abi.encode(dstImmutables)`.

Future (optional) events, not required for MVP:

- `EscrowWithdrawn(address escrow, bytes32 secretHash)`
- `EscrowCancelled(address escrow)`

## 3. Encoding Rules

- EVM side: canonical payload is `abi.encode(IBaseEscrow.Immutables)`; downstream systems decode with the Resolver ABI.
- NEAR side: a corresponding Borsh struct mirrors all fields. Off-chain agent transforms ABI -> Borsh.
- Hash function: sha256 for single-fill secrets; Merkle root for multi-fill secrets using the same leaf hashing as the EVM implementation/tests.

## 4. Cross-Chain Flow (single fill)

1. Maker signs order/intents (EVM or NEAR origin).
2. Resolver deploys source escrow on chain A and emits `SrcEscrowPlanned` with canonical payload.
3. Agent consumes the event and deploys destination escrow on chain B, aligned to the payload; confirms `DstEscrowCreated`.
4. After finality windows, maker reveals `secret` on destination; funds are withdrawn to the user.
5. Agent uses the revealed `secret` to withdraw funds to resolver on the source chain.
6. If timeouts occur, eligible parties cancel and recover funds per timelocks.

## 5. Cross-Chain Flow (multi fill)

Same as above, but each partial fill references a Merkle proof and index, unlocking a fraction of the total amounts. Timelocks must be chosen conservatively across chains.

## 6. Security Considerations

- Timelock buffers must reflect finality and latency across chains.
- Safety deposits can discourage griefing; consider slashing in later versions.
- Avoid leaking secrets before intended reveal; events do not include the secret value.
- Use NEAR Chain Signatures for agent key management; no raw keys stored.

## 7. Chain IDs

- `srcChainId`: derived from `block.chainid` on EVM.
- `dstChainId`: for NEAR Testnet, define a constant (off-chain) such as `NEAR_TESTNET = 397` (example). Map chain IDs centrally in the agent and frontend. See `src/shared/chains.ts` for canonical mapping used by both the agent and the UI.

## 8. Compatibility

- Existing tests continue to pass; no function signatures changed.
- Off-chain agent can begin consuming events immediately.
