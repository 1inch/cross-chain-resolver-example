// Test configuration for the relayer tests

// Test Ethereum configuration
export const TEST_ETHEREUM_CONFIG = {
  rpcUrl: 'http://localhost:8545', // Local testnet or mock URL
  chainId: 31337, // Common test chain ID (e.g., Hardhat)
  contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3', // Mock contract address
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Hardhat test private key
  gasPrice: '20000000000', // 20 Gwei
  gasLimit: '1000000',
};

// Test NEAR configuration
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

// Test order configuration
export const TEST_ORDER_CONFIG = {
  amount: '1000000000000000000', // 1.0 tokens
  minAmountOut: '900000000000000000', // 0.9 tokens (10% slippage)
  tokenIn: 'token-in.near',
  tokenOut: 'token-out.eth',
  receiver: 'receiver.near',
  deadline: (Math.floor(Date.now() / 1000) + 3600).toString(), // 1 hour from now
  salt: '1234567890',
  signature: 'mock_signature',
};

// Mock configuration for tests
export const MOCK_CONFIG = {
  ethereum: TEST_ETHEREUM_CONFIG,
  near: TEST_NEAR_CONFIG,
  order: TEST_ORDER_CONFIG,
  // Add any additional mock configurations here
};

// Export default configuration
export default {
  ...MOCK_CONFIG,
  // Add any additional default exports here
};
