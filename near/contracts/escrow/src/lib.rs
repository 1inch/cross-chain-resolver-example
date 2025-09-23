// NEAR HTLC Escrow (MVP scaffold)
// This contract mirrors the EVM-side Immutables using Borsh and provides
// stub entrypoints for create_src/create_dst, withdraw_src/withdraw_dst, and cancel.

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen, AccountId, PanicOnDefault, PromiseOrValue};
use near_sdk::collections::{UnorderedMap, LookupMap};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use tiny_keccak::{Hasher, Keccak};
use serde::{Serialize, Deserialize};

// Expanded timelocks for readability and strict typing on NEAR.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Copy)]
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

// Accept FT transfers and lock funds for an order via ft_transfer_call
#[near_bindgen]
impl FungibleTokenReceiver for NearHtlcEscrow {
    /// Called via FT contract: ft_transfer_call(receiver_id, amount, msg)
    /// We expect msg to be base64 or JSON with { "order_hash": <hex32> }
    /// For MVP, we take raw bytes in `msg` and expect exactly 32 bytes order hash.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: near_sdk::json_types::U128, msg: String) -> PromiseOrValue<near_sdk::json_types::U128> {
        #[derive(Deserialize)]
        struct FtMsg { order_hash: String }
        let FtMsg { order_hash } = serde_json::from_str(&msg).expect("msg must be JSON {order_hash}");
        let oh = hex::decode(order_hash.trim_start_matches("0x")).expect("invalid hex order_hash");
        assert_eq!(oh.len(), 32, "order_hash must be 32 bytes");
        let mut key = vec![0u8; 32];
        key.copy_from_slice(&oh);
        let mut current = self.locked_amounts.get(&key).unwrap_or(0);
        current += amount.0;
        self.locked_amounts.insert(&key, &current);
        // keep amount in escrow; return 0 indicating all tokens are used
        PromiseOrValue::Value(0u128.into())
    }
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
pub struct ImmutablesBorsh {
    pub order_hash: [u8; 32],
    pub hashlock: [u8; 32],
    pub maker: [u8; 20],         // EVM address bytes
    pub taker: [u8; 20],         // EVM address bytes (agent/resolver on dst)
    pub token: [u8; 20],         // On NEAR: adapter maps to NEP-141
    pub amount: u128,            // token amount (yocto or mapped decimals)
    pub safety_deposit: u128,    // yoctoNEAR or mapped token
    pub timelocks: TimelocksExpanded,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
pub struct Escrow {
    pub immutables: ImmutablesBorsh,
    pub maker_near: String,  // NEAR account id stored as String for Borsh compatibility
    pub taker_near: String,  // NEAR account id stored as String for Borsh compatibility
    pub withdrawn: bool,
    pub cancelled: bool,
}

#[near_bindgen]
#[derive(BorshSerialize, BorshDeserialize, PanicOnDefault)]
pub struct NearHtlcEscrow {
    // key: order_hash
    escrows: UnorderedMap<Vec<u8>, Escrow>,
    // MOCK custody: token balance accounting by order (for tests only)
    locked_amounts: LookupMap<Vec<u8>, u128>,
    safety_deposits: LookupMap<Vec<u8>, u128>,
    // MOCK payouts ledger for assertions in tests
    payouts: LookupMap<String, u128>,
    // Spent leaves tracker: key = order_hash (32) || index (u32 little-endian)
    spent: LookupMap<Vec<u8>, bool>,
}

#[near_bindgen]
impl NearHtlcEscrow {
    #[init]
    pub fn new() -> Self {
        Self {
            escrows: UnorderedMap::new(b"e"),
            locked_amounts: LookupMap::new(b"l"),
            safety_deposits: LookupMap::new(b"s"),
            payouts: LookupMap::new(b"p"),
            spent: LookupMap::new(b"x"),
        }
    }

    // Deploy source-like escrow on NEAR when NEAR is destination (dst on EVM)
    pub fn create_dst(&mut self, imm: ImmutablesBorsh, maker_near: AccountId, taker_near: AccountId) {
        let key = imm.order_hash.to_vec();
        assert!(self.escrows.get(&key).is_none(), "exists");
        // Safety deposit in NEAR (yoctoNEAR) symmetry with EVM native; require attached deposit
        let attached = env::attached_deposit().as_yoctonear();
        assert_eq!(attached, imm.safety_deposit, "safety deposit mismatch");
        self.safety_deposits.insert(&key, &attached);
        // For token amount, we expect incoming FT via ft_transfer_call before withdraw; set initial lock to 0
        self.locked_amounts.insert(&key, &0u128);
        let esc = Escrow { immutables: imm, maker_near: maker_near.to_string(), taker_near: taker_near.to_string(), withdrawn: false, cancelled: false };
        self.escrows.insert(&key, &esc);
    }

    // Optional: create_src when NEAR is source chain side
    pub fn create_src(&mut self, imm: ImmutablesBorsh, maker_near: AccountId, taker_near: AccountId) {
        self.create_dst(imm, maker_near, taker_near);
    }

    // Withdraw funds using the preimage `secret` (single- or multi-fill leaf handled off-chain for MVP)
    pub fn withdraw_dst(&mut self, order_hash: [u8; 32], secret: [u8; 32]) {
        let key = order_hash.to_vec();
        let mut esc = self.escrows.get(&key).expect("not found");
        assert!(!esc.withdrawn, "withdrawn");
        assert!(!esc.cancelled, "cancelled");
        // verify sha256(secret) == hashlock (single fill path; multi-fill TBD)
        let digest = env::sha256(&secret);
        assert_eq!(digest.as_slice(), &esc.immutables.hashlock, "bad secret");
        // verify within dst withdrawal window: now >= deployed_at + dst_withdrawal AND now < deployed_at + dst_cancellation
        let now_sec = env::block_timestamp_ms() / 1000;
        let t = &esc.immutables.timelocks;
        let start = t.deployed_at + (t.dst_withdrawal as u64);
        let cancel_start = t.deployed_at + (t.dst_cancellation as u64);
        assert!(now_sec >= start, "too early");
        assert!(now_sec < cancel_start, "too late");
        esc.withdrawn = true;
        self.escrows.insert(&key, &esc);
        // MOCK payouts: transfer amount to maker, safety deposit to caller (resolver)
        let caller = env::predecessor_account_id();
        let amount = self.locked_amounts.get(&key).unwrap_or(0);
        let sdep = self.safety_deposits.get(&key).unwrap_or(0);
        self.credit(&esc.maker_near, amount);
        self.credit(caller.as_str(), sdep);
        // zero out remaining locked amount after full withdrawal
        self.locked_amounts.insert(&key, &0u128);
    }

    pub fn cancel_dst(&mut self, order_hash: [u8; 32]) {
        let key = order_hash.to_vec();
        let mut esc = self.escrows.get(&key).expect("not found");
        assert!(!esc.cancelled, "cancelled");
        // verify cancellation window: now >= deployed_at + dst_cancellation
        let now_sec = env::block_timestamp_ms() / 1000;
        let t = &esc.immutables.timelocks;
        let cancel_start = t.deployed_at + (t.dst_cancellation as u64);
        assert!(now_sec >= cancel_start, "too early");
        esc.cancelled = true;
        self.escrows.insert(&key, &esc);
        // MOCK refunds: funds back to taker, safety deposit to caller
        let caller = env::predecessor_account_id();
        let amount = self.locked_amounts.get(&key).unwrap_or(0);
        let sdep = self.safety_deposits.get(&key).unwrap_or(0);
        self.credit(&esc.taker_near, amount);
        self.credit(caller.as_str(), sdep);
    }

    // Symmetric functions for NEAR-as-source scenarios
    pub fn withdraw_src(&mut self, order_hash: [u8; 32], secret: [u8; 32]) {
        self.withdraw_dst(order_hash, secret);
    }

    pub fn cancel_src(&mut self, order_hash: [u8; 32]) {
        self.cancel_dst(order_hash);
    }

    // View helpers
    pub fn get_escrow(&self, order_hash: [u8; 32]) -> Option<Escrow> {
        self.escrows.get(&order_hash.to_vec())
    }

    fn credit(&mut self, acc: &str, amount: u128) {
        if amount == 0 { return; }
        let current = self.payouts.get(&acc.to_string()).unwrap_or(0);
        self.payouts.insert(&acc.to_string(), &(current + amount));
    }

    pub fn get_payout(&self, acc: AccountId) -> u128 {
        self.payouts.get(&acc.to_string()).unwrap_or(0)
    }

    // ------------------ Convenience JSON-friendly helpers for CLI/JS scripts ------------------
    fn parse_hex<const N: usize>(hex_str: &str) -> [u8; N] {
        let bytes = hex::decode(hex_str.trim_start_matches("0x")).expect("invalid hex");
        assert_eq!(bytes.len(), N, "invalid length");
        let mut out = [0u8; N];
        out.copy_from_slice(&bytes);
        out
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_dst_simple(
        &mut self,
        order_hash_hex: String,
        hashlock_hex: String,
        maker_hex20: String,
        taker_hex20: String,
        token_hex20: String,
        amount: u128,
        safety_deposit: u128,
        timelocks: TimelocksExpanded,
        maker_near: AccountId,
        taker_near: AccountId,
    ) {
        let imm = ImmutablesBorsh {
            order_hash: Self::parse_hex::<32>(&order_hash_hex),
            hashlock: Self::parse_hex::<32>(&hashlock_hex),
            maker: Self::parse_hex::<20>(&maker_hex20),
            taker: Self::parse_hex::<20>(&taker_hex20),
            token: Self::parse_hex::<20>(&token_hex20),
            amount,
            safety_deposit,
            timelocks,
        };
        self.create_dst(imm, maker_near, taker_near);
    }

    pub fn withdraw_dst_hex(&mut self, order_hash_hex: String, secret_hex: String) {
        self.withdraw_dst(Self::parse_hex::<32>(&order_hash_hex), Self::parse_hex::<32>(&secret_hex));
    }

    pub fn withdraw_dst_partial_hex(
        &mut self,
        order_hash_hex: String,
        secret_hex: String,
        proof_hex: Vec<String>,
        index: u32,
        amount: u128,
    ) {
        let proof: Vec<[u8;32]> = proof_hex.into_iter().map(|h| Self::parse_hex::<32>(&h)).collect();
        self.withdraw_dst_partial(Self::parse_hex::<32>(&order_hash_hex), Self::parse_hex::<32>(&secret_hex), proof, index, amount);
    }

    fn spent_key(order_hash: &[u8;32], index: u32) -> Vec<u8> {
        let mut k = Vec::with_capacity(36);
        k.extend_from_slice(order_hash);
        k.extend_from_slice(&index.to_le_bytes());
        k
    }

    fn verify_merkle(root_with_count: &[u8;32], leaf: &[u8;32], proof: &Vec<[u8;32]>) -> bool {
        let mut hash = *leaf;
        for sibling in proof {
            // Sorted pair hashing per OZ merkle-tree
            let (a, b) = if &hash <= sibling { (hash, *sibling) } else { (*sibling, hash) };
            let mut keccak = Keccak::v256();
            let mut out = [0u8; 32];
            let mut data = [0u8; 64];
            data[..32].copy_from_slice(&a);
            data[32..].copy_from_slice(&b);
            keccak.update(&data);
            keccak.finalize(&mut out);
            hash = out;
        }
        if &hash == root_with_count { return true; }
        // Also allow comparing with top 16 bits cleared (1inch SDK embeds parts-count there)
        let mut masked = *root_with_count;
        masked[0] = 0; masked[1] = 0;
        &hash == &masked
    }

    /// Partial withdraw for multi-fill using Merkle proof
    pub fn withdraw_dst_partial(&mut self, order_hash: [u8;32], secret: [u8;32], proof: Vec<[u8;32]>, index: u32, amount: u128) {
        let key = order_hash.to_vec();
        let mut esc = self.escrows.get(&key).expect("not found");
        assert!(!esc.cancelled, "cancelled");
        // time window checks (same as full withdraw)
        let now_sec = env::block_timestamp_ms() / 1000;
        let t = &esc.immutables.timelocks;
        let start = t.deployed_at + (t.dst_withdrawal as u64);
        let cancel_start = t.deployed_at + (t.dst_cancellation as u64);
        assert!(now_sec >= start, "too early");
        assert!(now_sec < cancel_start, "too late");

        // Verify leaf and root
        let leaf_arr = Self::leaf_hash(index, &secret);
        assert!(Self::verify_merkle(&esc.immutables.hashlock, &leaf_arr, &proof), "bad proof");

        // Prevent double spend of this leaf index
        let skey = Self::spent_key(&order_hash, index);
        assert!(self.spent.get(&skey).unwrap_or(false) == false, "spent");
        self.spent.insert(&skey, &true);

        // Deduct and payout partial amount
        let current = self.locked_amounts.get(&key).unwrap_or(0);
        assert!(amount <= current, "insufficient locked");
        self.locked_amounts.insert(&key, &(current - amount));

        let caller = env::predecessor_account_id();
        let sdep = self.safety_deposits.get(&key).unwrap_or(0);
        self.credit(&esc.maker_near, amount);
        self.credit(caller.as_str(), sdep);
    }

    // Compute 1inch SDK leaf: keccak( uint64_be(index) || keccak(secret) )
    fn leaf_hash(index: u32, secret: &[u8;32]) -> [u8;32] {
        // keccak(secret)
        let mut k = Keccak::v256();
        let mut s_out = [0u8;32];
        k.update(secret);
        k.finalize(&mut s_out);
        // pack uint64 big-endian
        let mut buf = [0u8; 8+32];
        buf[..8].copy_from_slice(&(index as u64).to_be_bytes());
        buf[8..].copy_from_slice(&s_out);
        let mut k2 = Keccak::v256();
        let mut out = [0u8;32];
        k2.update(&buf);
        k2.finalize(&mut out);
        out
    }
}

// --------------------------
// Unit tests (single-fill)
// --------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder};
    use near_sdk::{testing_env, NearToken};

    fn to_arr32(x: &[u8]) -> [u8;32] { let mut a=[0u8;32]; a.copy_from_slice(x); a }

    fn ctx(predecessor: &str, ts_sec: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor.parse().unwrap());
        b.block_timestamp(ts_sec * 1_000_000_000); // ns
        b
    }

    fn ctx_with_deposit(predecessor: &str, ts_sec: u64, deposit: u128) -> VMContextBuilder {
        let mut b = ctx(predecessor, ts_sec);
        b.attached_deposit(NearToken::from_yoctonear(deposit));
        b
    }

    fn sample_immutables(now: u64, amount: u128, sdep: u128, secret: [u8;32]) -> ImmutablesBorsh {
        let hash = env::sha256(&secret);
        ImmutablesBorsh {
            order_hash: [1u8;32],
            hashlock: to_arr32(&hash),
            maker: [2u8;20],
            taker: [3u8;20],
            token: [4u8;20],
            amount,
            safety_deposit: sdep,
            timelocks: TimelocksExpanded {
                deployed_at: now,
                src_withdrawal: 0, src_public_withdrawal: 0, src_cancellation: 0, src_public_cancellation: 0,
                dst_withdrawal: 10, dst_public_withdrawal: 100, dst_cancellation: 120,
            },
        }
    }

    #[test]
    fn withdraw_success() {
        let secret = [9u8;32];
        let now = 1_000_000;
        let imm = sample_immutables(now, 100, 5, secret);
        let mut contract = NearHtlcEscrow::new();

        testing_env!(ctx_with_deposit("resolver.testnet", now, imm.safety_deposit).build());
        contract.create_dst(imm.clone(), "maker.testnet".parse().unwrap(), "taker.testnet".parse().unwrap());
        // lock funds via FT
        testing_env!(ctx("ft.token.testnet", now + 1).build());
        let msg = format!("{{\"order_hash\":\"0x{}\"}}", hex::encode(imm.order_hash));
        let _ = contract.ft_on_transfer("user.testnet".parse().unwrap(), 100u128.into(), msg);

        // move time into withdrawal window
        testing_env!(ctx("resolver.testnet", now + 15).build());
        contract.withdraw_dst(imm.order_hash, secret);

        // maker got amount; resolver got safety deposit
        assert_eq!(contract.get_payout("maker.testnet".parse().unwrap()), 100);
        assert_eq!(contract.get_payout("resolver.testnet".parse().unwrap()), 5);
        // flags set
        let e = contract.get_escrow(imm.order_hash).unwrap();
        assert!(e.withdrawn);
        assert!(!e.cancelled);
    }

    #[test]
    #[should_panic(expected = "bad secret")]
    fn withdraw_bad_secret_panics() {
        let secret = [9u8;32];
        let now = 1_000_000;
        let imm = sample_immutables(now, 100, 5, secret);
        let mut contract = NearHtlcEscrow::new();
        testing_env!(ctx_with_deposit("resolver.testnet", now + 15, imm.safety_deposit).build());
        contract.create_dst(imm.clone(), "maker.testnet".parse().unwrap(), "taker.testnet".parse().unwrap());
        let wrong = [8u8;32];
        contract.withdraw_dst(imm.order_hash, wrong);
    }

    #[test]
    #[should_panic(expected = "too early")]
    fn withdraw_too_early_panics() {
        let secret = [9u8;32];
        let now = 1_000_000;
        let imm = sample_immutables(now, 100, 5, secret);
        let mut contract = NearHtlcEscrow::new();
        testing_env!(ctx_with_deposit("resolver.testnet", now + 5, imm.safety_deposit).build());
        contract.create_dst(imm.clone(), "maker.testnet".parse().unwrap(), "taker.testnet".parse().unwrap());
        contract.withdraw_dst(imm.order_hash, secret);
    }

    #[test]
    fn cancel_success_after_window() {
        let secret = [9u8;32];
        let now = 1_000_000;
        let imm = sample_immutables(now, 100, 5, secret);
        let mut contract = NearHtlcEscrow::new();
        testing_env!(ctx_with_deposit("resolver.testnet", now, imm.safety_deposit).build());
        contract.create_dst(imm.clone(), "maker.testnet".parse().unwrap(), "taker.testnet".parse().unwrap());
        // lock funds via FT before cancellation
        testing_env!(ctx("ft.token.testnet", now + 1).build());
        let msg = format!("{{\"order_hash\":\"0x{}\"}}", hex::encode(imm.order_hash));
        let _ = contract.ft_on_transfer("user.testnet".parse().unwrap(), 100u128.into(), msg);

        // move time beyond cancellation start
        testing_env!(ctx("resolver.testnet", now + 130).build());
        contract.cancel_dst(imm.order_hash);

        // taker got refund; resolver got safety deposit
        assert_eq!(contract.get_payout("taker.testnet".parse().unwrap()), 100);
        assert_eq!(contract.get_payout("resolver.testnet".parse().unwrap()), 5);
        let e = contract.get_escrow(imm.order_hash).unwrap();
        assert!(e.cancelled);
        assert!(!e.withdrawn);
    }

    // Merkle helpers for tests (keccak, sorted pair hashing)
    fn merkle_root(leaves: &[[u8;32]]) -> [u8;32] {
        if leaves.is_empty() { return [0u8;32]; }
        let mut level = leaves.to_vec();
        while level.len() > 1 {
            let mut next: Vec<[u8;32]> = Vec::new();
            for i in (0..level.len()).step_by(2) {
                let a = level[i];
                let b = if i+1 < level.len() { level[i+1] } else { level[i] };
                let (x,y) = if a <= b { (a,b) } else { (b,a) };
                let mut data = [0u8;64];
                data[..32].copy_from_slice(&x);
                data[32..].copy_from_slice(&y);
                let mut k = Keccak::v256();
                let mut out=[0u8;32];
                k.update(&data);
                k.finalize(&mut out);
                next.push(out);
            }
            level = next;
        }
        level[0]
    }

    #[test]
    fn partial_withdraw_success() {
        let s0 = [1u8;32];
        let s1 = [2u8;32];
        let l0 = NearHtlcEscrow::leaf_hash(0, &s0);
        let l1 = NearHtlcEscrow::leaf_hash(1, &s1);
        let root = merkle_root(&[l0, l1]);
        let now = 3_000_000;
        let mut imm = sample_immutables(now, 300, 7, s0);
        imm.hashlock = root; // use Merkle root
        let mut contract = NearHtlcEscrow::new();

        testing_env!(ctx_with_deposit("resolver.testnet", now, imm.safety_deposit).build());
        contract.create_dst(imm.clone(), "maker.testnet".parse().unwrap(), "taker.testnet".parse().unwrap());
        // lock total via FT
        testing_env!(ctx("ft.token.testnet", now + 1).build());
        let msg = format!("{{\"order_hash\":\"0x{}\"}}", hex::encode(imm.order_hash));
        let _ = contract.ft_on_transfer("user.testnet".parse().unwrap(), 300u128.into(), msg);

        // withdraw first leaf (index 0) for 150
        testing_env!(ctx("resolver.testnet", now + 20).build());
        contract.withdraw_dst_partial(imm.order_hash, s0, vec![l1], 0, 150);
        assert_eq!(contract.get_payout("maker.testnet".parse().unwrap()), 150);

        // withdraw second leaf (index 1) for remaining 150 using proof [l0]
        contract.withdraw_dst_partial(imm.order_hash, s1, vec![l0], 1, 150);
        assert_eq!(contract.get_payout("maker.testnet".parse().unwrap()), 300);
    }

    #[test]
    #[should_panic]
    fn partial_double_spend_panics() {
        let s0 = [1u8;32];
        let l0 = NearHtlcEscrow::leaf_hash(0, &s0);
        let root = merkle_root(&[l0]);
        let now = 3_000_000;
        let mut imm = sample_immutables(now, 300, 7, s0);
        imm.hashlock = root;
        let mut contract = NearHtlcEscrow::new();
        testing_env!(ctx_with_deposit("resolver.testnet", now, imm.safety_deposit).build());
        contract.create_dst(imm.clone(), "maker.testnet".parse().unwrap(), "taker.testnet".parse().unwrap());
        testing_env!(ctx("ft.token.testnet", now + 1).build());
        let msg = format!("{{\"order_hash\":\"0x{}\"}}", hex::encode(imm.order_hash));
        let _ = contract.ft_on_transfer("user.testnet".parse().unwrap(), 300u128.into(), msg);
        testing_env!(ctx("resolver.testnet", now + 20).build());
        contract.withdraw_dst_partial(imm.order_hash, s0, vec![], 0, 150);
        // second attempt on same leaf should panic
        contract.withdraw_dst_partial(imm.order_hash, s0, vec![], 0, 1);
    }

    #[test]
    #[should_panic]
    fn ft_on_transfer_rejects_non_json_msg() {
        let secret = [5u8;32];
        let now = 1_000_000;
        let imm = sample_immutables(now, 10, 1, secret);
        let mut contract = NearHtlcEscrow::new();
        testing_env!(ctx_with_deposit("resolver.testnet", now, imm.safety_deposit).build());
        contract.create_dst(imm.clone(), "maker.testnet".parse().unwrap(), "taker.testnet".parse().unwrap());
        testing_env!(ctx("ft.token.testnet", now + 1).build());
        let _ = contract.ft_on_transfer("user.testnet".parse().unwrap(), 1u128.into(), "not json".into());
    }

    #[test]
    #[should_panic(expected = "order_hash must be 32 bytes")]
    fn ft_on_transfer_rejects_wrong_hex_len() {
        let secret = [5u8;32];
        let now = 1_000_000;
        let imm = sample_immutables(now, 10, 1, secret);
        let mut contract = NearHtlcEscrow::new();
        testing_env!(ctx_with_deposit("resolver.testnet", now, imm.safety_deposit).build());
        contract.create_dst(imm.clone(), "maker.testnet".parse().unwrap(), "taker.testnet".parse().unwrap());
        testing_env!(ctx("ft.token.testnet", now + 1).build());
        let msg = "{\"order_hash\":\"0xdeadbeef\"}".to_string();
        let _ = contract.ft_on_transfer("user.testnet".parse().unwrap(), 1u128.into(), msg);
    }
}
