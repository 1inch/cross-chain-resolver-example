// Minimal stub for near-api-js used only for tests when the real package is not installed

export const connect = async () => {
  return {
    account: async () => ({
      viewFunction: async () => ({
        filled_amount: '0',
        remaining_amount: '0',
        fill_count: 0,
        is_fully_filled: false,
        is_cancelled: false,
        last_fill_timestamp: Date.now() * 1_000_000,
        child_orders: [],
      }),
      functionCall: async () => ({
        transaction: { hash: 'mock_tx_hash' },
      }),
    }),
  };
};

export const keyStores = {
  InMemoryKeyStore: class {
    async setKey() { /* noop */ }
    async getKey() {
      return { toString: () => 'ed25519:mock_public_key' };
    }
  },
};

export const Account = {
  from: () => ({
    state: async () => ({
      amount: '1000000000000000000000000',
      locked: '0',
      code_hash: 'mock_code_hash',
      storage_usage: 1000,
      storage_paid_at: 0,
    }),
  }),
};
