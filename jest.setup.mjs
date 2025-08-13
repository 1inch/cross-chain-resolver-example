// Jest ESM setup file
import { jest } from '@jest/globals';
import { MOCK_CONFIG } from './relayer/tests/test-config.js';

// Set test timeout to 30s for all tests
jest.setTimeout(30000);

// Mock console methods to keep test output clean
const originalConsole = { ...console };

// Global test setup
beforeEach(() => {
  // Restore console methods before each test
  global.console = { ...originalConsole };
  
  // Reset all mocks before each test
  jest.clearAllMocks();
  
  // Use real timers by default (integration tests rely on real time for polling)
  // Individual tests can switch to fake timers when needed
  jest.useRealTimers();
  
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

// Mock common modules
jest.mock('ethers', () => {
  const original = jest.requireActual('ethers');
  return {
    ...original,
    providers: {
      ...original.providers,
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getBlockNumber: jest.fn().mockResolvedValue(12345),
        getNetwork: jest.fn().mockResolvedValue({ chainId: 31337 }),
        // Use bigint to align with ethers v6 return types
        getGasPrice: jest.fn().mockResolvedValue(20000000000n),
        estimateGas: jest.fn().mockResolvedValue(100000n),
        getSigner: jest.fn().mockImplementation(() => ({
          getAddress: jest.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
          signTransaction: jest.fn().mockResolvedValue('mock_signed_tx'),
          sendTransaction: jest.fn().mockResolvedValue({
            wait: jest.fn().mockResolvedValue({
              transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              status: 1,
              logs: [],
            }),
          }),
        })),
      })),
    },
    // Contract mock that supports:
    // - Writes: route through signer.sendTransaction (so spies fire)
    // - Reads: getDetails() returns provider._mockEscrow shape
    // - Events: filters.EscrowCreated + queryFilter
    // - Gas: estimateGas.withdraw
    Contract: jest.fn().mockImplementation((address, _abi, signerOrProvider) => {
      const state = {
        address,
        _signer: signerOrProvider && typeof signerOrProvider.sendTransaction === 'function' ? signerOrProvider : null,
        _provider: signerOrProvider && typeof signerOrProvider.sendTransaction !== 'function' ? signerOrProvider : null,
      };

      const handler = {
        get(_target, prop) {
          if (prop === 'address') return state.address;
          if (prop === 'connect') {
            return (signer) => {
              state._signer = signer;
              return new Proxy({}, handler);
            };
          }
          if (prop === 'filters') {
            return {
              EscrowCreated: () => ({ event: 'EscrowCreated' }),
            };
          }
          if (prop === 'queryFilter') {
            return async (_filter, _fromBlock, _toBlock) => {
              const escrow = state._provider && state._provider._mockEscrow ? state._provider._mockEscrow : null;
              const escrowAddress = escrow && escrow.escrowAddress ? escrow.escrowAddress : '0x' + '5'.repeat(40);
              return [
                {
                  args: [escrowAddress],
                  blockNumber: 1,
                },
              ];
            };
          }
          if (prop === 'estimateGas') {
            return new Proxy({}, {
              get(_t, gasProp) {
                if (gasProp === 'withdraw') {
                  return async () => 100000n;
                }
                return async () => 100000n;
              },
            });
          }
          // Read: getDetails via provider mock
          if (prop === 'getDetails') {
            return async () => {
              const escrow = state._provider && state._provider._mockEscrow ? state._provider._mockEscrow : null;
              if (!escrow) {
                return {
                  status: 1,
                  token: '0x' + '0'.repeat(40),
                  amount: original.BigNumber.from('0'),
                  timelock: original.BigNumber.from(Math.floor(Date.now() / 1000) + 3600),
                  secretHash: '0x' + '1'.repeat(64),
                  initiator: '0x' + '2'.repeat(40),
                  recipient: '0x' + '3'.repeat(40),
                  chainId: original.BigNumber.from(11155111),
                };
              }
              const toBN = (v) => (typeof v === 'string' || typeof v === 'number') ? original.BigNumber.from(v.toString()) : v;
              return {
                status: escrow.status === 'active' ? 1 : (escrow.status === 'withdrawn' ? 2 : 0),
                token: escrow.token || '0x' + '0'.repeat(40),
                amount: toBN(escrow.amount || '0'),
                timelock: toBN(escrow.timelock || Math.floor(Date.now() / 1000) + 3600),
                secretHash: escrow.secretHash || ('0x' + '1'.repeat(64)),
                initiator: escrow.initiator || ('0x' + '2'.repeat(40)),
                recipient: escrow.recipient || ('0x' + '3'.repeat(40)),
                chainId: toBN(escrow.chainId || 11155111),
              };
            };
          }
          // Writes: any contract method routes through signer.sendTransaction
          if (typeof prop === 'string') {
            return (...args) => {
              const last = args.length > 0 ? args[args.length - 1] : undefined;
              const overrides = last && typeof last === 'object' && (('gasLimit' in last) || ('value' in last)) ? last : undefined;
              if (state._signer && typeof state._signer.sendTransaction === 'function') {
                const txRequest = {
                  to: state.address,
                  data: '0x',
                  ...(overrides && overrides.value ? { value: overrides.value } : {}),
                };
                return state._signer.sendTransaction(txRequest);
              }
              return Promise.resolve({
                hash: '0x' + '1'.repeat(64),
                wait: jest.fn().mockResolvedValue({ status: 1, logs: [], transactionHash: '0x' + '1'.repeat(64) }),
              });
            };
          }
          return undefined;
        },
      };

      return new Proxy({}, handler);
    }),
  };
});

// Mock near-api-js
jest.mock('near-api-js', () => {
  return {
    connect: jest.fn().mockResolvedValue({
      account: jest.fn().mockImplementation(() => ({
        viewFunction: jest.fn().mockResolvedValue({
          filled_amount: '500000000000000000000000',
          remaining_amount: '500000000000000000000000',
          fill_count: 1,
          is_fully_filled: false,
          is_cancelled: false,
          last_fill_timestamp: Date.now() * 1000000,
          child_orders: [],
        }),
        functionCall: jest.fn().mockResolvedValue({
          transaction: { hash: 'mock_tx_hash' },
        }),
      })),
    }),
    keyStores: {
      InMemoryKeyStore: jest.fn().mockImplementation(() => ({
        setKey: jest.fn().mockResolvedValue(undefined),
        getKey: jest.fn().mockResolvedValue({
          toString: () => 'ed25519:mock_public_key',
        }),
      })),
    },
    Account: {
      from: jest.fn().mockImplementation(() => ({
        state: jest.fn().mockResolvedValue({
          amount: '1000000000000000000000000',
          locked: '0',
          code_hash: 'mock_code_hash',
          storage_usage: 1000,
          storage_paid_at: 0,
        }),
      })),
    },
  };
});
