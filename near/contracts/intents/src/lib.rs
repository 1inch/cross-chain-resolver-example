use near_sdk::{env, near, AccountId, BorshStorageKey};
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct V1Intent {
    pub maker_near: AccountId,
    pub taker_near: AccountId,
    pub maker_asset_near: AccountId,
    pub taker_asset_evm: String, // hex 0x...
    pub making_amount: String,   // decimal string
    pub taking_amount: String,   // decimal string
    pub order_hash_hex: String,  // 0x + 32 bytes
    pub dst_chain_id: u64,
    pub timelocks_hex: String,   // 0x...
}

#[near(contract_state)]
#[derive(Default)]
pub struct Contract {
    intents_count: u64,
}

#[derive(BorshSerialize, BorshDeserialize, BorshStorageKey)]
enum StorageKey {
    Intents,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self { intents_count: 0 }
    }

    pub fn intake_intent(&mut self, intent: V1Intent) {
        self.intents_count = self.intents_count.saturating_add(1);

        // Emit a canonical event log the agent can parse
        let ev = serde_json::json!({
            "standard": "near-intents",
            "version": "1.0.0",
            "event": "IntentIntake",
            "data": {
                "seq": self.intents_count,
                "intent": intent,
            }
        });
        env::log_str(&ev.to_string());
    }

    pub fn get_intents_count(&self) -> u64 {
        self.intents_count
    }
}
