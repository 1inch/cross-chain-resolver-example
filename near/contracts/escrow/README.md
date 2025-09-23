# NEAR HTLC Escrow (MVP)

This contract mirrors the EVM-side HTLC for cross-chain atomic swaps with NEAR Testnet as one side.
It implements single-fill sha256(secret) checks and timelock verification, with a mock custody ledger
for initial tests. Token adapter wiring (NEP-141) can be added next.

## Build

Prereqs: Rust toolchain, `wasm32-unknown-unknown` target, cargo.

```bash
rustup target add wasm32-unknown-unknown
cd near/contracts/escrow
cargo build --target wasm32-unknown-unknown --release
```

Wasm artifact: `target/wasm32-unknown-unknown/release/near_htlc_escrow.wasm`

## Local unit tests

```bash
cd near/contracts/escrow
cargo test -- --nocapture
```

## Key entrypoints

- `new()` — initialize contract
- `create_dst(immutables, maker_near, taker_near)` — create an escrow (dst side)
- `withdraw_dst(order_hash, secret)` — withdraw funds with the preimage, within timelock window
- `cancel_dst(order_hash)` — cancel after cancellation window begins
- `get_escrow(order_hash)` — view escrow
- `get_payout(account)` — mock ledger used in tests to assert payouts

## Notes

- Timelocks follow the expanded structure in `docs/protocol-spec.md` (Borsh mapping section).
- Multi-fill (Merkle) support and real NEP-141 custody will be implemented next.

## FT transfer flow (NEP-141)

Use `ft_transfer_call` from your FT contract to lock funds for a specific order. The `msg` must be JSON with a hex-encoded 32-byte order hash:

```json
{"order_hash": "0x<64-hex>"}
```

Example (pseudocode):

```bash
# create dst escrow with NEAR safety deposit attached (yoctoNEAR)
near call <ESCROW> create_dst '{"imm": <...>, "maker_near":"maker.testnet", "taker_near":"resolver.testnet"}' --amount <safety_deposit>

# lock token amount via FT transfer-call
near call <FT> ft_transfer_call '{"receiver_id":"<ESCROW>", "amount":"200000000", "msg":"{\"order_hash\":\"0x<64-hex>\"}"}' --accountId <YOUR_ACCOUNT> --amount 0 --gas 100000000000000

# withdraw (single fill)
near call <ESCROW> withdraw_dst '{"order_hash":"<bytes32_base64>", "secret":"<bytes32_base64>"}' --accountId resolver.testnet

# partial withdraw (multi-fill)
near call <ESCROW> withdraw_dst_partial '{"order_hash":"<...>", "secret":"<...>", "proof":["<bytes32_base64>", ...], "index": 0, "amount": "150000000"}' --accountId resolver.testnet

# cancel after window
near call <ESCROW> cancel_dst '{"order_hash":"<...>"}' --accountId resolver.testnet
```

Notes:

- For multi-fill, leaves are computed as `keccak( uint64_be(index) || keccak(secret) )` and the Merkle tree uses sorted pair keccak hashing. The root in EVM is masked with a part-count in the top bits; the contract strips those to compare roots.
