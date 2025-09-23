# Bidirectional Ethereum <-> NEAR Atomic Swaps with 1inch Fusion+

This document describes the end-to-end plan to build a decentralized, bidirectional bridge for atomic swaps between Ethereum and NEAR using 1inch Fusion+ technology together with NEAR Intents, Chain Signatures, and Shade Agents. It aligns with the goals in `requirements.md` and avoids reliance on 1inch REST backends.

## I. Objectives

- Enable atomic, hashlock/timelock-protected swaps between ERC-20 on Ethereum and NEP-141 on NEAR.
- Support partial fills (Merkle-based secrets) and bi-directional flows (ETH->NEAR and NEAR->ETH).
- Use a decentralized solver (Shade Agent in TEE) and NEAR Chain Signatures for key management and cross-chain signing.
- Integrate with 1inch Fusion+ meta-order paradigm on the EVM side. Mirror functionality on NEAR.
- Demonstrate on public testnets with a modern frontend for UX.

## II. Architecture Overview

- **EVM Side (Ethereum Sepolia)**
    - Escrow Factory + Escrow contracts (HTLC) similar to current `contracts/src/TestEscrowFactory.sol` and `contracts/src/Resolver.sol`, extended for NEAR interoperability.
    - 1inch Fusion+ Resolver logic to accept/produce orders (no 1inch REST dependencies).

- **NEAR Side (NEAR Testnet)**
    - Rust smart contract implementing HTLC primitives with single and multiple fills (Merkle tree of secrets), timelocks, and asset custody for NEP-141 tokens.
    - Token adapters for NEP-141; optional wrapper for native NEAR.

- **Decentralized Solver & Relayer (Shade Agent)**
    - Listens to events/intents on both chains.
    - Submits counterparty deposits, performs secret reveal, triggers withdrawals/cancellations.
    - Uses **NEAR Chain Signatures** (MPC) for key control without raw private keys.
    - Can create Fusion+ meta-orders from NEAR-originating intents using Chain Signatures.

- **Frontend (Next.js + Tailwind + shadcn UI)**
    - UI to create swaps, monitor escrows, reveal secrets, and demo partial fills in both directions.

## III. Protocol & Data Model

- **Canonical fields** (shared across chains):
    - maker, taker, makerAsset, takerAsset
    - makingAmount, takingAmount
    - hashlock: sha256(secret) for single fill or Merkle root for multiple fills
    - timelocks: srcWithdrawal, srcPublicWithdrawal, srcCancellation, srcPublicCancellation, dstWithdrawal, dstPublicWithdrawal, dstCancellation
    - chain IDs: srcChainId, dstChainId; safety deposits: srcSafetyDeposit, dstSafetyDeposit
    - salt/nonce; whitelist; auction details (Fusion+)

- **Serialization**
    - Define a canonical “Immutables” struct with versioning.
    - EVM uses ABI encoding; NEAR uses Borsh.
    - Provide shared TypeScript and Rust definitions to avoid ambiguity.

- **Partial fills**
    - Merkle-based secrets for multiple fills, mirroring `Sdk.HashLock.forMultipleFills` in NEAR contract.

## IV. Detailed Plan & Milestones

### Phase 1 — Research & Spec

- Deep-dive:
    - NEAR Intents (docs.near.org, docs.near-intents.org)
    - Chain Signatures (overview + getting-started)
    - Shade Agents (introduction + production deployment)
    - 1inch Fusion+ (whitepaper PDF), Fusion Resolver example, Fusion SDK
- Deliverables:
    - Protocol Spec: canonical payload schema, encoding (ABI/Borsh), and field semantics.
    - Threat Model v1: replay, liquidity lock, griefing, MEV, timing skews.

### Phase 2 — EVM Side Extensions

- Extend `contracts/src/Resolver.sol` and `contracts/src/TestEscrowFactory.sol`:
    - Embed NEAR counterparty data into events (canonical payload).
    - Ensure compatibility with single/multi-fill flows and add tests for new fields.
- Verify via `forge test` and extend `tests/main.spec.ts` scenarios to emit/consume new fields.

### Phase 3 — NEAR Contracts (Rust)

- Create `near/contracts/escrow/` with:
    - create_src/create_dst: deploy escrows with canonical payload.
    - withdraw_src/withdraw_dst: verify hashlock + timelock.
    - cancel_src/cancel_dst: allow refunds after timelock expiry.
    - Multi-fill: Merkle proof verification and per-leaf spend tracking.
- Token adapters:
    - NEP-141 interface integration; support wrapped NEAR if needed.
- Tests:
    - Unit tests using `near-sdk` simulation.

### Phase 4 — Shade Agent (Solver/Relayer)

- Build a service that:
    - Subscribes to EVM and NEAR events/intents.
    - Mirrors escrow deployments cross-chain and performs secret reveals.
    - Uses **Chain Signatures** for signing (no raw keys in code).
    - For NEAR-origin intents: generates Fusion+ meta-orders on EVM via Chain Signatures.
- Reliability & Ops:
    - Idempotent submissions, retries, and observability (logs/metrics).

### Phase 5 — NEAR Intents Integration

- Define intent schema for swap outcomes (NEAR -> EVM and EVM -> NEAR).
- Implement intake on NEAR; Agent consumes intents and acts (deploy escrow).

### Phase 6 — Frontend (Next.js)

- App Router (`app/`), Tailwind, shadcn UI.
- Features:
    - Compose swaps: chain/token selection, amounts, single vs multi-fill.
    - Status views for escrows on both chains; secret reveal controls.
    - Settings: RPCs, contract addresses, donor test accounts, fork blocks.

### Phase 7 — Testnets & E2E

- Deploy to Sepolia and NEAR Testnet.
- E2E scripts:
    - Single fill in both directions.
    - Multiple fills with Merkle proofs.
    - Failure modes: expiry, missing secret, partial cancellations.
- CI:
    - Foundry tests for EVM; Cargo tests for NEAR; Jest for agent; basic UI smoke tests.

### Phase 8 — Security & Ops

- Security review checklist (state transitions, re-entrancy, allowance management, timelocks).
- Monitoring: stuck escrows, missed timelocks, tx error rates.
- Keys via Chain Signatures; rate limits, allowlists (early phases).

### Phase 9 — Documentation & Runbooks

- Developer docs: contract APIs, protocol spec, message formats, agent configuration.
- Operator runbooks: deployments, upgrades, incident response (stuck funds), faucet/donor setup.

## V. Implementation Breakdown (Tasks)

- Contracts (EVM)
    - Extend events/payloads; ensure compatibility with Fusion+ and partial fills.
    - Add cross-chain fields and validation.
- Contracts (NEAR)
    - HTLC state machine (single + multiple fills); NEP-141 integration; tests.
- Agent
    - Event ingestors; cross-chain mirroring; Chain Signatures integration; retries/observability.
- Frontend
    - Next.js scaffold, components for swap creation and escrow monitoring.
- Tooling
    - Scripts for deployments to Sepolia/NEAR Testnet; env templates; faucet utilities.

## VI. Testnet Config Checklist

- RPCs: Sepolia, NEAR Testnet.
- Donor accounts/tokens for testing.
- Optional fork blocks for reproducibility (local dev).
- Agent env: polling intervals, endpoints, Chain Signatures config.
- Frontend env: NEXT_PUBLIC RPCs and contract addresses.

## VII. Risks & Mitigations

- Timing/Finality differences → conservative timelocks and buffers.
- Liquidity lock/griefing → safety deposits; potential slashing for misbehavior (v2).
- Multi-fill complexity → shared test vectors across EVM/NEAR; extensive tests.
- Ops risk → idempotency, retries, observability, runbooks.

## VIII. Milestones & Deliverables

1. Protocol Spec & Architecture doc (payload schema, encoding, threat model v1)
2. EVM Extensions Complete (contracts + tests)
3. NEAR Escrow MVP (single fill + unit tests)
4. Shade Agent MVP (EVM->NEAR single fill)
5. Full Bidirectional + Partial Fills (multi-fill Merkle on NEAR)
6. NEAR Intents + Fusion+ (NEAR-originating swaps)
7. Frontend Demo (Next.js + Tailwind + shadcn)
8. Hardening & Docs (security review checklist, runbooks)

---

This plan is designed to be incremental, with clear interfaces between the EVM contracts, NEAR contracts, solver agent, and the frontend, enabling parallel development and early demos.
