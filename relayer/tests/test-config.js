// JS shim for test configuration so jest.setup.mjs can import without TS transforms

// Keep in sync with relayer/tests/test-config.ts
export const TEST_ETHEREUM_CONFIG = {
  rpcUrl: 'http://localhost:8545',
  chainId: 31337,
  contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  gasPrice: '20000000000',
  gasLimit: '1000000',
};

export const TEST_NEAR_CONFIG = {
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.near.org',
  walletUrl: 'https://wallet.testnet.near.org',
  helperUrl: 'https://helper.testnet.near.org',
  explorerUrl: 'https://explorer.testnet.near.org',
  accountId: 'test.near',
  contractName: 'test.contract.near',
  privateKey: 'ed25519:4Z1cW8Z5gXkQ1d9J9Q1J9Q1J9Q1J9Q1J9Q1J9Q1J9Q1J9Q1J9Q1J9Q1J9',
};

export const TEST_ORDER_CONFIG = {
  amount: '1000000000000000000',
  minAmountOut: '900000000000000000',
  tokenIn: 'token-in.near',
  tokenOut: 'token-out.eth',
  receiver: 'receiver.near',
  deadline: (Math.floor(Date.now() / 1000) + 3600).toString(),
  salt: '1234567890',
  signature: 'mock_signature',
};

export const MOCK_CONFIG = {
  ethereum: TEST_ETHEREUM_CONFIG,
  near: TEST_NEAR_CONFIG,
  order: TEST_ORDER_CONFIG,
};

export default {
  ...MOCK_CONFIG,
};
