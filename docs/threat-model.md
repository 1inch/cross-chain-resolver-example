# Threat Model v1: Ethereum <-> NEAR Atomic Swaps with 1inch Fusion+

This document outlines threats, assumptions, and mitigations for the bidirectional HTLC-based bridge using 1inch Fusion+, NEAR Intents, Chain Signatures, and Shade Agents.

## 1. System scope and assets

- Funds locked in EVM and NEAR escrows (ERC-20 / NEP-141).
- Secrets used for hashlocks (single- or multi-fill leaves).
- Safety deposits and resolver funds.
- Agent credentials (managed via Chain Signatures MPC) and relayer infra.

## 2. Trust assumptions

- No trust in centralized backend; agent runs in a TEE and uses Chain Signatures for key management.
- No cross-chain light client proofs; atomicity is provided by hashlock+timelock.
- RPC endpoints are honest-but-fallible; implement retries and diversified endpoints.

## 3. Threats and mitigations

- Replay or reorg effects across chains
    - Mitigation: conservative timelocks; wait for N confirmations before proceeding; use finality-aware windows.

- Secret leakage prior to intended reveal
    - Mitigation: never log or emit secrets on-chain; events include only hashes/roots; ensure agent logging scrubs sensitive values.

- Griefing/liquidity lock by counterparties
    - Mitigation: safety deposits on both chains; consider slashing conditions (future versions) and allowlists for MVP.

- Partial fill inconsistencies (Merkle misuse)
    - Mitigation: shared test vectors across EVM/NEAR; strict index/proof validation; per-leaf spend tracking.

- Re-entrancy and approval misuse on EVM/NEAR
    - Mitigation: re-entrancy guards; safe allowance patterns (reset-to-zero for USDT-like tokens); extensive unit tests.

- Timing skew and latency
    - Mitigation: buffer timelocks above chain finality; agent backoff and retry; clock drift tolerance.

- RPC/Infra outages (DoS)
    - Mitigation: multi-endpoint RPCs; exponential backoff; idempotent submissions; queueing.

- Agent key compromise
    - Mitigation: Chain Signatures MPC; no raw private keys on disk; rotate subkeys; least-privilege access.

- Frontend phishing or UI mis-signing
    - Mitigation: clearly display contract addresses and amounts; verify binaries and hashes; sign-what-you-see principles.

## 4. Operational guidance

- Monitoring: escrow lifecycle metrics, failed txs, delayed reveals/cancels.
- Alerting: stuck escrows (beyond timelock), persistent RPC failures, unexpected event orderings.
- Backups: intent queues and idempotency keys; reproducible env and deployment configs.

## 5. Open items

- Formal slashing specification for malicious resolvers (v2).
- Optional light-client proofs (future research) to reduce reliance on agents.
- Expanded adversarial testing plan (chaos testing across both chains).
