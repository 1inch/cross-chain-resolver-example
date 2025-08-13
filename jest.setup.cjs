'use strict';

// CJS Jest setup file compatible with Jest runtime
const { MOCK_CONFIG } = require('./relayer/tests/test-config.js');

// Set test timeout to 30s for all tests
if (typeof jest !== 'undefined') {
  jest.setTimeout(30000);
}

// Mock console methods to keep test output clean
const originalConsole = { ...console };

// Global test setup
beforeEach(() => {
  // Restore console methods before each test
  global.console = { ...originalConsole };

  // Reset all mocks before each test
  jest.clearAllMocks();

  // Use fake timers by default
  jest.useFakeTimers();

  // Set up global test configuration
  global.testConfig = MOCK_CONFIG;

  // Mock process.env with test configuration
  process.env = {
    NODE_ENV: 'test',
    ETHEREUM_RPC_URL: MOCK_CONFIG.ethereum.rpcUrl,
    ETHEREUM_CHAIN_ID: MOCK_CONFIG.ethereum.chainId.toString(),
    NEAR_NETWORK_ID: MOCK_CONFIG.near.networkId,
    NEAR_NODE_URL: MOCK_CONFIG.near.nodeUrl,
    NEAR_WALLET_URL: MOCK_CONFIG.near.walletUrl,
    NEAR_HELPER_URL: MOCK_CONFIG.near.helperUrl,
    NEAR_EXPLORER_URL: MOCK_CONFIG.near.explorerUrl,
    NEAR_ACCOUNT_ID: MOCK_CONFIG.near.accountId,
    NEAR_CONTRACT_NAME: MOCK_CONFIG.near.contractName,
    NEAR_PRIVATE_KEY: MOCK_CONFIG.near.privateKey,
  };
});

afterEach(() => {
  // Clean up after each test
  jest.clearAllTimers();
  jest.useRealTimers();

  // Clear global test configuration
  delete global.testConfig;
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  // Fail the test if there's an unhandled promise rejection
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Note: keep heavy mocks local to test files to avoid global side effects.
