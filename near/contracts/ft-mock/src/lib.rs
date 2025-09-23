use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::LazyOption;
use near_sdk::{env, near_bindgen, AccountId, Balance, PanicOnDefault, PromiseOrValue};

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct FtMock {
    pub token: FungibleToken,
    pub owner_id: AccountId,
    pub metadata: LazyOption<FungibleTokenMetadata>,
}

#[near_bindgen]
impl FtMock {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: Balance, name: String, symbol: String, decimals: u8) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let mut this = Self {
            token: FungibleToken::new(b"t".to_vec()),
            owner_id: owner_id.clone(),
            metadata: LazyOption::new(b"m".to_vec(), None),
        };
        this.metadata.set(&FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name,
            symbol,
            icon: None,
            reference: None,
            reference_hash: None,
            decimals,
        });
        // Mint initial supply to owner
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, total_supply);
        FtMint { owner_id: &owner_id, amount: &total_supply, memo: Some("initial") }.emit();
        this
    }

    pub fn mint(&mut self, account_id: AccountId, amount: Balance) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "only owner");
        if !self.token.accounts_contains(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount);
        FtMint { owner_id: &account_id, amount: &amount, memo: Some("mint") }.emit();
    }
}

near_contract_standards::impl_fungible_token_core!(FtMock, token);
near_contract_standards::impl_fungible_token_storage!(FtMock, token);
near_contract_standards::impl_fungible_token_resolver!(FtMock, token);

#[near_bindgen]
impl FungibleTokenMetadataProvider for FtMock {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}
