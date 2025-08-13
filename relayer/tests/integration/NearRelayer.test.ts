/**
 * Comprehensive Integration Tests for NearRelayer
 * Tests the complete relayer functionality with proper mocking
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { NearRelayer } from '../../src/relay/NearRelayer';
import { ethers } from 'ethers';
import { MockProvider, MockSigner } from '../mocks/ethers-mock-enhanced';
import { MockNearAccount, MockNearProvider, MockNearConnection } from '../mocks/near-api-mock';
import { MessageType, CrossChainMessage } from '../../src/types/interfaces';

// Module-level mock: replace EthereumContractService before NearRelayer is evaluated (hoisted by Jest)
jest.mock('../../src/services/EthereumContractService.js', () => {
  return {
    EthereumContractService: (jest.fn().mockImplementation(function(...args: any[]) {
      const provider = args[0];
      const signer = args[1];
      const getMockEscrow = () => (provider && provider._mockEscrow) ? provider._mockEscrow : null;
      const getMockReceipt = (fallbackHash?: string) => {
        const r = provider && provider._mockTransactionReceipt ? provider._mockTransactionReceipt : null;
        if (r) return r;
        return {
          status: 1,
          transactionHash: fallbackHash || ('0x' + '1'.repeat(64)),
          blockNumber: 0,
          gasUsed: { toString: () => '21000' }
        };
      };
      return {
        // Used when creating escrows from NEAR orders
        getSignerAddress: jest.fn(async () => {
          return signer && typeof signer.getAddress === 'function' ? signer.getAddress() : '0x' + '0'.repeat(40);
        }),
        executeFactoryTransaction: jest.fn(async (_method: string, params: any[], value?: any) => {
          // Simulate a contract write by sending a tx from the injected signer
          if (signer && typeof signer.sendTransaction === 'function') {
            const to = params && params[0] && params[0].taker ? params[0].taker : '0x' + '0'.repeat(40);
            return signer.sendTransaction({ to, value });
          }
          // Fallback minimal tx response
          return {
            hash: '0x' + '1'.repeat(64),
            wait: async () => getMockReceipt('0x' + '1'.repeat(64))
          } as any;
        }),
        // Lookup helpers used in withdrawal path
        findEscrowBySecretHash: jest.fn(async (_secretHash: string) => getMockEscrow()),
        getEscrowDetails: jest.fn(async (_escrowAddress: string) => getMockEscrow()),
        // Withdrawal path should surface provider-configured receipt for deterministic txHash in tests
        executeWithdrawal: jest.fn(async (escrowAddress: string, secret: string) => {
          if (signer && typeof signer.sendTransaction === 'function') {
            await signer.sendTransaction({ to: escrowAddress, data: secret });
          }
          return getMockReceipt();
        })
      };
    })) as any
  };
});

// Define test context type
/** @typedef {Object} TestContext
 * @property {any} relayer - The NearRelayer instance
 * @property {Object} config - Configuration object
 * @property {any} mockNearAccount - Mock NEAR account
 * @property {any} mockNearProvider - Mock NEAR provider
 * @property {any} mockEthereumProvider - Mock Ethereum provider
 * @property {any} mockEthereumSigner - Mock Ethereum signer
 */

// Setup test environment
let lastRelayer: NearRelayer | null = null;
let lastStorageDir: string | null = null;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  // Ensure any started relayer is stopped to avoid hanging intervals
  try {
    if (lastRelayer) {
      await lastRelayer.stop();
      lastRelayer = null;
    }
  } finally {
    jest.useRealTimers();
  }
  // Cleanup temp storage dir if created
  if (lastStorageDir) {
    try {
      if (fs.existsSync(lastStorageDir)) {
        fs.rmSync(lastStorageDir, { recursive: true, force: true });
      }
    } catch (_) {
      // ignore cleanup errors in tests
    } finally {
      lastStorageDir = null;
    }
  }
});

// Test setup function
/**
 * @returns {TestContext} Test context with mocks and relayer instance
 */
function setupTest() {
  // Create mock NEAR provider and account
  const mockNearProvider = new MockNearProvider();
  const mockNearAccount = new MockNearAccount('test.near', new MockNearConnection('testnet', mockNearProvider));
  
  // Create mock Ethereum provider and signer
  const mockEthereumProvider = new MockProvider();
  const mockEthereumSigner = new MockSigner(mockEthereumProvider);

  // Set up NEAR account connection
  mockNearAccount.connection = {
    provider: mockNearProvider,
    signer: undefined
  } as any;

  // Create a unique storage directory inside project cwd to satisfy StorageService path validation
  const tempPrefix = path.join(process.cwd(), 'near-relayer-test-');
  const tmpStorageDir = fs.mkdtempSync(tempPrefix);

  // Configure relayer
  const config = {
    nearAccount: mockNearAccount as any,
    ethereum: {
      rpcUrl: 'http://localhost:8545',
      privateKey: '0x' + '11'.repeat(32),
      // Inject mocks so EthereumContractService uses them
      provider: mockEthereumProvider as any,
      signer: mockEthereumSigner as any
    },
    ethereumEscrowFactoryAddress: '0x1234567890123456789012345678901234567890',
    escrowContractId: 'escrow.test.near',
    startBlock: 1000,
    pollIntervalMs: 10,
    storageDir: tmpStorageDir
  };

  // Initialize relayer with config
  const relayer = new NearRelayer(config as any);
  // Track for universal teardown
  lastRelayer = relayer as any;
  lastStorageDir = config.storageDir;

  return {
    relayer,
    config,
    mockNearAccount,
    mockNearProvider,
    mockEthereumProvider,
    mockEthereumSigner
  };
}

// Main test suite for NearRelayer
describe('NearRelayer', () => {
  // Clear mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    test('should initialize with valid configuration', () => {
      const { relayer } = setupTest();
      expect(relayer).toBeDefined();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    test('should throw error with invalid configuration - missing NEAR account', () => {
      expect(() => {
        new NearRelayer({
          nearAccount: null as any,
          ethereum: {
            rpcUrl: 'http://localhost:8545',
            privateKey: '0x' + '11'.repeat(32)
          },
          ethereumEscrowFactoryAddress: '0x1234567890123456789012345678901234567890',
          escrowContractId: 'escrow.test.near'
        });
      }).toThrow();
    });

    test('should throw error with invalid Ethereum factory address', () => {
      const mockNearAccount = new MockNearAccount('test.near', new MockNearConnection('testnet', new MockNearProvider()));
      
      expect(() => {
        new NearRelayer({
          nearAccount: mockNearAccount as any,
          ethereum: {
            rpcUrl: 'http://localhost:8545',
            privateKey: '0x' + '11'.repeat(32)
          },
          ethereumEscrowFactoryAddress: 'invalid-address',
          escrowContractId: 'escrow.test.near'
        });
      }).toThrow();
    });
  });

  describe('Lifecycle Management', () => {
    test('should start relayer successfully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      await relayer.stop();
    });

    test('should stop relayer successfully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      await relayer.stop();
      expect(relayer.isRelayerRunning()).toBe(false);
    });
  });

  describe('Event Handling', () => {
    test('should poll NEAR blocks and emit events', async () => {
      const { relayer, config, mockNearProvider, mockEthereumSigner } = setupTest();
      
      // Ensure listener starts from height 1000
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: 1000 } });
      await relayer.start();
      
      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');
      
      // Prepare NEAR provider mocks to include EVENT_JSON log for swap_order_created at next block
      const blockHeight = 1001;
      const chunkHash = `chunk-hash-${blockHeight}`;
      const txHash = 'abcdEFGH1234567890abcdEFGH1234567890abc1';
      
      mockNearProvider.setMockChunk(chunkHash, {
        transactions: [
          {
            hash: txHash,
            signer_id: 'sender.near',
            receiver_id: config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_created',
                    data: {
                      order_id: 'test-order-1',
                      initiator: 'sender.near',
                      recipient: '0x1234567890123456789012345678901234567890',
                      amount: '1000000000000000000',
                      secret_hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                      timelock: Math.floor(Date.now() / 1000) + 3600,
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);
      
      // Attach listener before advancing status to avoid race
      const createdEvent = new Promise<any>((resolve) => {
        (relayer as any).getEventEmitter().once('ethereum:tx:sent', (payload: any) => resolve(payload));
      });
      // Advance status so poller processes new block
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: blockHeight } });
      const createdPayload = await createdEvent;
      expect(createdPayload.action).toBe('create-escrow');
      
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    test('should handle swap order completed event', async () => {
      const { relayer, config, mockNearProvider, mockEthereumSigner, mockEthereumProvider } = setupTest();

      // Mock escrow data used by relayer lookup
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x1234567890123456789012345678901234567890',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: ethers.utils.keccak256('0x' + '12'.repeat(32)),
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active',
      });

      // Ensure listener starts from height 1001
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: 1001 } });
      await relayer.start();

      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');

      // Ensure deterministic withdrawal receipt for emitted event
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0x' + 'ab'.repeat(32),
        blockNumber: 22222,
        gasUsed: '21000'
      });

      // Prepare NEAR provider mocks to include EVENT_JSON log for swap_order_completed at next block
      const blockHeight = 1002;
      const chunkHash = `chunk-hash-${blockHeight}`;
      const txHash = 'abcdEFGH1234567890abcdEFGH1234567890abc1';

      // NEAR find_escrow_by_secret_hash should return an active order for the revealed secret
      mockNearProvider.setMockCallFunctionResult('find_escrow_by_secret_hash', {
        id: 'test-order-1',
        initiator: 'sender.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secret_hash: ethers.utils.keccak256('0x' + '12'.repeat(32)),
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });

      mockNearProvider.setMockChunk(chunkHash, {
        transactions: [
          {
            hash: txHash,
            signer_id: 'sender.near',
            receiver_id: config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_completed',
                    data: {
                      order_id: 'test-order-1',
                      secret: '0x' + '12'.repeat(32),
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      // Attach listener before advancing status to avoid race
      const withdrawalEvent = new Promise<any>((resolve) => {
        (relayer as any).getEventEmitter().once('ethereum:tx:sent', (payload: any) => resolve(payload));
      });
      // Advance status so poller processes new block
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: blockHeight } });
      const withdrawalPayload = await withdrawalEvent;
      expect(withdrawalPayload.action).toBe('withdrawal');
      // Deterministic payload checks
      expect(withdrawalPayload.txHash).toBe('0x' + 'ab'.repeat(32));
      expect(withdrawalPayload.escrowAddress).toBe('0x1234567890123456789012345678901234567890');

      expect(sendSpy).toHaveBeenCalledTimes(1);
      await relayer.stop();
    });
  });

  describe('Error Handling', () => {
    test('should handle NEAR provider connection errors', async () => {
      const { relayer, mockNearProvider } = setupTest();
      
      // Mock provider error
      mockNearProvider.setMockError(new Error('NEAR provider connection failed'));
      
      // Expect start to throw
      await expect(relayer.start()).rejects.toThrow('Failed to start NEAR relayer: Failed to start NEAR event listener');
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle complete NEAR to Ethereum flow', async () => {
      const { relayer, mockNearProvider, mockEthereumSigner, mockEthereumProvider } = setupTest();
      
      // Mock transaction receipt for deposit
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345,
        gasUsed: '100000'
      });

      // Ensure listener starts from a baseline height
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: 1000 } });

      // Start the relayer
      await relayer.start();

      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');

      // Inject swap_order_created via EVENT_JSON log at block 1001
      const createdBlock = 1001;
      const createdChunkHash = `chunk-hash-${createdBlock}`;
      const createdTxHash = 'abcdEFGH1234567890abcdEFGH1234567890abc2';

      mockNearProvider.setMockChunk(createdChunkHash, {
        transactions: [
          {
            hash: createdTxHash,
            signer_id: 'test.near',
            receiver_id: (relayer as any).config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_created',
                    data: {
                      order_id: 'integration-order-123',
                      initiator: 'test.near',
                      recipient: '0x1234567890123456789012345678901234567890',
                      amount: '1000000000000000000',
                      secret_hash: '0x' + '12'.repeat(32),
                      timelock: Math.floor(Date.now() / 1000) + 86400,
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      // Advance status so poller processes created block
      const createdPromise = new Promise<any>((resolve) => {
        (relayer as any).getEventEmitter().once('ethereum:tx:sent', (payload: any) => resolve(payload));
      });
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: createdBlock } });
      const createPayload = await createdPromise;
      expect(createPayload.action).toBe('create-escrow');

      // Verify the transaction was sent once for escrow creation
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Prepare escrow details for completion path
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: ethers.utils.keccak256('0x' + '12'.repeat(32)),
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });

      // Inject swap_order_completed via EVENT_JSON log at block 1002
      const completedBlock = 1002;
      const completedChunkHash = `chunk-hash-${completedBlock}`;
      const completedTxHash = 'abcdEFGH1234567890abcdEFGH1234567890abc3';

      // NEAR find_escrow_by_secret_hash mock for full flow completion
      mockNearProvider.setMockCallFunctionResult('find_escrow_by_secret_hash', {
        id: 'integration-order-123',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secret_hash: ethers.utils.keccak256('0x' + '12'.repeat(32)),
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });

      mockNearProvider.setMockChunk(completedChunkHash, {
        transactions: [
          {
            hash: completedTxHash,
            signer_id: 'test.near',
            receiver_id: (relayer as any).config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_completed',
                    data: {
                      order_id: 'integration-order-123',
                      secret: '0x' + '12'.repeat(32),
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      // Ensure deterministic withdrawal receipt for emitted event in complete flow
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0x' + 'cd'.repeat(32),
        blockNumber: 33333,
        gasUsed: '21000'
      });

      // Advance status so poller processes completed block
      const withdrawalPromise = new Promise<any>((resolve) => {
        (relayer as any).getEventEmitter().once('ethereum:tx:sent', (payload: any) => resolve(payload));
      });
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: completedBlock } });
      const wdPayload = await withdrawalPromise;
      expect(wdPayload.action).toBe('withdrawal');
      // Deterministic payload checks
      expect(wdPayload.txHash).toBe('0x' + 'cd'.repeat(32));

      // Verify the follow-up transaction was sent
      expect(sendSpy).toHaveBeenCalledTimes(2);
      await relayer.stop();
    });
  });

  describe('Constructor and Configuration', () => {
    test('should create relayer with valid configuration', () => {
      const { relayer } = setupTest();
      expect(relayer).toBeDefined();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    test('should throw error with invalid configuration - missing NEAR account', () => {
      expect(() => {
        new NearRelayer({
          nearAccount: null as any,
          ethereum: {
            rpcUrl: 'http://localhost:8545',
            privateKey: '0x' + '11'.repeat(32)
          },
          ethereumEscrowFactoryAddress: '0x1234567890123456789012345678901234567890',
          escrowContractId: 'escrow.test.near'
        });
      }).toThrow();
    });

    test('should throw error with invalid Ethereum factory address', () => {
      const mockNearAccount = new MockNearAccount();
      mockNearAccount.connection = { provider: new MockNearProvider() } as any;
      
      expect(() => {
        new NearRelayer({
          nearAccount: mockNearAccount as any,
          ethereum: {
            rpcUrl: 'http://localhost:8545',
            privateKey: '0x' + '11'.repeat(32)
          },
          ethereumEscrowFactoryAddress: 'invalid-address',
          escrowContractId: 'escrow.test.near'
        });
      }).toThrow();
    });
  });

  describe('Lifecycle Management', () => {
    test('should start relayer successfully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      await relayer.stop();
    });

    test('should stop relayer successfully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      
      await relayer.stop();
      expect(relayer.isRelayerRunning()).toBe(false);
    });

    test('should handle multiple start calls gracefully', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      await relayer.stop();
    });
  });

  describe('Message Processing', () => {
    test('should process deposit message successfully', async () => {
      const { relayer, mockNearAccount } = setupTest();
      await relayer.start();
      
      const depositMessage: CrossChainMessage = {
        messageId: 'deposit-123',
        type: MessageType.DEPOSIT,
        sourceChain: 'ETH' as 'ETH',
        destChain: 'NEAR' as 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        data: {
          secretHash: '0x' + '12'.repeat(32),
          timelock: Math.floor(Date.now() / 1000) + 3600,
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        },
        timestamp: Date.now()
      };
      
      mockNearAccount.setMockFunctionCallResult({ status: { SuccessValue: '' } });
      const fnSpy = jest.spyOn(mockNearAccount as any, 'functionCall');
      await relayer.processMessage(depositMessage);
      
      expect(fnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          methodName: 'create_swap_order',
          args: expect.objectContaining({
            recipient: 'test.near'
          })
        })
      );
      await relayer.stop();
    });

    test('should process withdrawal message successfully', async () => {
      const { relayer, mockNearProvider, mockEthereumSigner, mockEthereumProvider } = setupTest();
      await relayer.start();
      
      const message: CrossChainMessage = {
        messageId: 'test-withdraw-1',
        type: MessageType.WITHDRAWAL,
        sourceChain: 'NEAR' as 'NEAR',
        destChain: 'ETH' as 'ETH',
        sender: 'sender.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        token: 'NEAR',
        timestamp: Math.floor(Date.now() / 1000),
        data: {
          secret: '12'.repeat(32),
          txHash: 'abcdEFGH1234567890abcdEFGH1234567890abc1'
        }
      };
      
      // Mock NEAR provider call_function result for find_escrow_by_secret_hash
      mockNearProvider.setMockCallFunctionResult('find_escrow_by_secret_hash', {
        id: 'test-order-1',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secret_hash: '0x' + '12'.repeat(32),
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });

      // Ensure Ethereum escrow lookup succeeds during withdrawal path
      mockEthereumProvider.setMockEscrow({
        escrowAddress: '0x9876543210987654321098765432109876543210',
        initiator: 'test.near',
        recipient: '0x1234567890123456789012345678901234567890',
        amount: '1000000000000000000',
        secretHash: ethers.utils.keccak256('0x' + '12'.repeat(32)),
        timelock: Math.floor(Date.now() / 1000) + 86400,
        status: 'active'
      });

      // Use module-level mock for EthereumContractService; no mid-test spies needed
      
      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');
      await relayer.processMessage(message);
      expect(sendSpy).toHaveBeenCalled();
      await relayer.stop();
    });

    test('should skip already processed messages', async () => {
      const { relayer } = setupTest();
      await relayer.start();
      
      const depositMessage: CrossChainMessage = {
        messageId: 'deposit-duplicate',
        type: MessageType.DEPOSIT,
        sourceChain: 'ETH' as 'ETH',
        destChain: 'NEAR' as 'NEAR',
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'test.near',
        amount: '1000000000000000000',
        token: '0x0000000000000000000000000000000000000000',
        data: {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          secretHash: '0x' + '34'.repeat(32),
          timelock: Math.floor(Date.now() / 1000) + 3600
        },
        timestamp: Date.now()
      };
      
      await relayer.processMessage(depositMessage);
      await relayer.processMessage(depositMessage);
      
      expect(relayer.getProcessedMessageCount()).toBe(1);
      await relayer.stop();
    });
  });

  describe('Event Handling', () => {
    test('should handle swap order created event', async () => {
      const { relayer, mockNearProvider, mockEthereumProvider, mockEthereumSigner } = setupTest();
      
      mockEthereumProvider.setMockTransactionReceipt({
        status: 1,
        transactionHash: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
        blockNumber: 12346,
        gasUsed: '100000'
      });

      // Start from baseline height and start relayer
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: 2000 } });
      await relayer.start();

      const sendSpy = jest.spyOn(mockEthereumSigner as any, 'sendTransaction');

      // Inject swap_order_created via EVENT_JSON log at next block
      const blockHeight = 2001;
      const chunkHash = `chunk-hash-${blockHeight}`;
      const txHash = 'abcdEFGH1234567890abcdEFGH1234567890abc4';

      mockNearProvider.setMockChunk(chunkHash, {
        transactions: [
          {
            hash: txHash,
            signer_id: 'sender.near',
            receiver_id: (relayer as any).config.escrowContractId,
            actions: [],
          },
        ],
        receipts: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:' +
                  JSON.stringify({
                    event: 'swap_order_created',
                    data: {
                      order_id: 'test-order-1',
                      initiator: 'sender.near',
                      recipient: '0x1234567890123456789012345678901234567890',
                      amount: '1000000000000000000',
                      secret_hash: '0x' + '12'.repeat(32),
                      timelock: Math.floor(Date.now() / 1000) + 86400,
                    },
                  }),
              ],
              receipt_ids: [],
              gas_burnt: 0,
              status: { SuccessValue: '' },
            },
          },
        ],
      } as any);

      const createdEvent = new Promise<any>((resolve) => {
        (relayer as any).getEventEmitter().once('ethereum:tx:sent', (payload: any) => resolve(payload));
      });
      mockNearProvider.setMockStatus({ sync_info: { latest_block_height: blockHeight } });
      const createdPayload2 = await createdEvent;
      expect(createdPayload2.action).toBe('create-escrow');

      // Verify the transaction was sent via signer
      expect(sendSpy).toHaveBeenCalled();
      await relayer.stop();
    });
  });
});
