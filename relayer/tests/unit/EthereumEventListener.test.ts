/**
 * Comprehensive unit tests for EthereumEventListener
 * Tests Ethereum blockchain event listening, parsing, and handling
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { ethers } from 'ethers';
import {
  EthereumEventListener,
  type EthereumEventHandlers,
  type DepositInitiatedEvent,
  type MessageSentEvent,
  type WithdrawalCompletedEvent,
  type EscrowCreatedEvent
} from '../../src/services/EthereumEventListener';
import { ValidationError } from '../../src/utils/errors';

// Mock ethers provider and contracts
class MockProvider extends ethers.providers.JsonRpcProvider {
  private mockBlockNumber = 1000;
  private mockBlock: any;
  private mockError: Error | null = null;
  private mockLogs: any[] = [];

  constructor() {
    super('http://localhost:8545');
    this.mockBlock = {
      number: this.mockBlockNumber,
      timestamp: Math.floor(Date.now() / 1000)
    };
  }

  async getBlockNumber(): Promise<number> {
    if (this.mockError) throw this.mockError;
    return this.mockBlockNumber;
  }

  async getBlock(blockNumber: number): Promise<any> {
    if (this.mockError) throw this.mockError;
    return { ...this.mockBlock, number: blockNumber };
  }

  async getLogs(filter: ethers.EventFilter): Promise<any[]> {
    if (this.mockError) throw this.mockError;
    return this.mockLogs.filter(log => 
      log.address === filter.address && 
      log.topics?.[0] === filter.topics?.[0]
    );
  }

  setMockBlockNumber(blockNumber: number): void {
    this.mockBlockNumber = blockNumber;
    this.mockBlock.number = blockNumber;
  }

  setMockBlock(block: any): void {
    this.mockBlock = block;
  }

  setMockLogs(logs: any[]): void {
    this.mockLogs = logs;
  }

  setMockError(error: Error | null): void {
    this.mockError = error;
  }

  private mockQueryFilter: jest.Mock = jest.fn().mockResolvedValue([]);

  setMockQueryFilter(mockFn: jest.Mock): void {
    this.mockQueryFilter = mockFn;
  }

  // Override the queryFilter method to use our mock
  async queryFilter(
    event: ethers.EventFilter | string,
    fromBlock?: ethers.providers.BlockTag,
    toBlock?: ethers.providers.BlockTag
  ): Promise<ethers.Event[]> {
    if (this.mockError) throw this.mockError;
    return this.mockQueryFilter(event, fromBlock, toBlock);
  }
}

describe('EthereumEventListener', () => {
  let ethereumEventListener: EthereumEventListener;
  let mockProvider: MockProvider;
  let mockHandlers: EthereumEventHandlers;
  const factoryAddress = '0x' + 'a'.repeat(40);
  const bridgeAddress = '0x' + 'b'.repeat(40);
  const escrowAddress = '0x' + 'c'.repeat(40);
  let lastEvent: any = null;

  // Helper function to create a mock event with proper typing
  function createMockEvent(
    eventName: string, 
    args: Record<string, any>,
    blockNumber: number = 1001, 
    txHash: string = '0x' + 'd'.repeat(64)
  ): ethers.Event {
    const event: any = {
      address: eventName.includes('EscrowCreated') ? factoryAddress : bridgeAddress,
      blockNumber,
      transactionHash: txHash,
      event: eventName,
      args: Object.entries(args).map(([name, value]) => ({
        name,
        value,
        type: typeof value === 'string' ? 'string' : 
              typeof value === 'bigint' || (value && typeof value === 'object' && '_isBigNumber' in value) ? 'uint256' :
              'address'
      })),
      getBlock: async () => ({
        timestamp: Math.floor(Date.now() / 1000) - 1000
      }),
      // Add type assertions for ethers.Event properties
      eventSignature: '',
      decode: () => ({}),
      removeListener: () => {},
      getTransaction: () => ({} as any),
      getTransactionReceipt: () => ({} as any)
    };

    // Add direct property access for args
    for (const [key, value] of Object.entries(args)) {
      event[key] = value;
    }

    return event as ethers.Event;
  }

  beforeEach(() => {
    // Reset mocks
    mockProvider = new MockProvider();
    mockProvider.setMockError(null);
    lastEvent = null;
    
    // Set up default mock handlers with proper async functions
    mockHandlers = {
      onDepositInitiated: async (event: DepositInitiatedEvent) => {
        lastEvent = { type: 'DepositInitiated', ...event };
        return Promise.resolve();
      },
      onMessageSent: async (event: MessageSentEvent) => {
        lastEvent = { type: 'MessageSent', ...event };
        return Promise.resolve();
      },
      onWithdrawalCompleted: async (event: WithdrawalCompletedEvent) => {
        lastEvent = { type: 'WithdrawalCompleted', ...event };
        return Promise.resolve();
      },
      onEscrowCreated: async (event: EscrowCreatedEvent) => {
        lastEvent = { type: 'EscrowCreated', ...event };
        return Promise.resolve();
      }
    };

    // Create a fresh instance for each test
    ethereumEventListener = new EthereumEventListener(
      mockProvider as any,
      factoryAddress,
      bridgeAddress,
      mockHandlers,
      100 // Shorter poll interval for tests
    );
  });

  afterEach(async () => {
    // Clean up after each test
    await ethereumEventListener.stop();
  });

  describe('Constructor', () => {
    test('should initialize with valid parameters', () => {
      expect(ethereumEventListener).toBeInstanceOf(EthereumEventListener);
      expect(ethereumEventListener.getIsRunning()).toBe(false);
      expect(ethereumEventListener.getLastProcessedBlock()).toBe(0);
    });

    test('should throw error for invalid provider', () => {
      expect(() => {
        new EthereumEventListener(null as any, factoryAddress, bridgeAddress, mockHandlers);
      }).toThrow(ValidationError);
    });

    test('should throw error for invalid factory address', () => {
      expect(() => {
        new EthereumEventListener(mockProvider as any, 'invalid_address', bridgeAddress, mockHandlers);
      }).toThrow(ValidationError);
    });

    test('should throw error for invalid bridge address', () => {
      expect(() => {
        new EthereumEventListener(mockProvider as any, factoryAddress, 'invalid_address', mockHandlers);
      }).toThrow(ValidationError);
    });

    test('should throw error for missing handlers', () => {
      // Test with empty handlers object
      expect(() => {
        new EthereumEventListener(
          mockProvider as any, 
          factoryAddress, 
          bridgeAddress, 
          {} as any
        );
      }).toThrow('Missing required event handlers');
      
      // Test with undefined handlers
      expect(() => {
        new EthereumEventListener(
          mockProvider as any,
          factoryAddress,
          bridgeAddress,
          undefined as any
        );
      }).toThrow('Missing required event handlers');
      
      // Test with null handlers
      expect(() => {
        new EthereumEventListener(
          mockProvider as any,
          factoryAddress,
          bridgeAddress,
          null as any
        );
      }).toThrow('Missing required event handlers');
    });
  });

  describe('Start/Stop', () => {
    test('should start and stop the listener', async () => {
      // Mock the provider's block number
      mockProvider.setMockBlockNumber(1000);
      
      await ethereumEventListener.start();
      expect(ethereumEventListener.getIsRunning()).toBe(true);
      expect(ethereumEventListener.getLastProcessedBlock()).toBe(1000);

      await ethereumEventListener.stop();
      expect(ethereumEventListener.getIsRunning()).toBe(false);
    });

    test('should handle provider errors during start', async () => {
      mockProvider.setMockError(new Error('Provider error'));
      // start should not throw; it logs a warning and starts from block 0
      await expect(ethereumEventListener.start()).resolves.toBeUndefined();
      expect(ethereumEventListener.getIsRunning()).toBe(true);
      expect(ethereumEventListener.getLastProcessedBlock()).toBe(0);
    });

    test('should process DepositInitiated event', async () => {
      // Create test data
      const depositId = '0x' + '1'.repeat(64);
      const blockNumber = 1001;
      const txHash = '0x' + '2'.repeat(64);
      const sender = '0x' + '3'.repeat(40);
      const token = ethers.constants.AddressZero;
      const amount = '1000000000000000000'; // 1 ETH
      const fee = '10000000000000000'; // 0.01 ETH
      const nearRecipient = 'test.near';
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Mock the block data
      mockProvider.setMockBlock({
        number: blockNumber,
        timestamp,
        transactions: [txHash]
      });
      
      // Create a test event with all required fields in the format expected by ethers.js
      const mockEvent = {
        event: 'DepositInitiated',
        args: {
          depositId,
          sender,
          nearRecipient,
          token,
          amount: ethers.BigNumber.from(amount),
          fee: ethers.BigNumber.from(fee),
          timestamp: ethers.BigNumber.from(timestamp),
        },
        blockNumber,
        transactionHash: txHash,
        getBlock: async () => ({
          number: blockNumber,
          timestamp,
        }),
        getTransaction: async () => ({
          hash: txHash,
          from: sender,
          to: token,
          value: amount,
        }),
        // Add ethers.js event properties
        eventSignature: 'DepositInitiated(bytes32,address,string,address,uint256,uint256,uint256)',
        decode: jest.fn(),
        removeListener: jest.fn(),
        getTransactionReceipt: jest.fn().mockResolvedValue({ logs: [] }),
      };
      
      // Mock the queryFilter method to return our test event
      const mockQueryFilter = jest.fn().mockResolvedValue([mockEvent]);
      mockProvider.setMockQueryFilter(mockQueryFilter);
      
      // Set up the mock provider to return our test event
      mockProvider.setMockLogs([mockEvent]);
      mockProvider.setMockBlockNumber(blockNumber);
      
      // Reset lastEvent before test
      lastEvent = null;
      
      // Set up handler to capture the event
      mockHandlers.onDepositInitiated = async (event) => {
        lastEvent = event;
      };
      
      // Start the listener and process the block
      await ethereumEventListener.start();
      
      // Manually trigger the poll to ensure our mock is used
      await (ethereumEventListener as any).pollForEvents();
      
      // Check that the event was processed
      expect(lastEvent).toBeDefined();
      if (!lastEvent) {
        throw new Error('Event not captured');
      }
      
      // Verify all event properties
      expect(lastEvent).toMatchObject({
        depositId,
        sender,
        nearRecipient,
        token,
        amount: BigInt(amount),
        fee: BigInt(fee),
        timestamp: BigInt(timestamp),
        blockNumber,
        transactionHash: txHash,
      });
    });

    test('should handle provider errors during polling', async () => {
      // Set up provider to throw error
      const error = new Error('Provider error');
      mockProvider.setMockError(error);
      
      // Start the listener
      await ethereumEventListener.start();
      
      // Test that the error is properly handled by the polling mechanism
      await expect(ethereumEventListener.start()).resolves.toBeUndefined();
      
      // The error should be caught and logged, but not re-thrown
      await expect(ethereumEventListener['pollForEvents']()).resolves.toBeUndefined();
      
      // Verify listener is still running
      expect(ethereumEventListener.getIsRunning()).toBe(true);
    });

    test('should process EscrowCreated event', async () => {
      // Create test data
      const initiator = '0x' + 'a'.repeat(40);
      const token = '0x' + 'e'.repeat(40);
      const amount = '1000';
      const targetChain = 'near';
      const targetAddress = 'near-recipient.near';
      
      // Create a test event with all required fields
      const mockEvent = createMockEvent('EscrowCreated', {
        escrow: escrowAddress,
        initiator,
        token,
        amount: ethers.BigNumber.from(amount),
        targetChain,
        targetAddress,
        blockNumber: 1001,
        transactionHash: '0x' + 'd'.repeat(64)
      });
      
      // Set up the mock provider to return our test event
      mockProvider.setMockLogs([mockEvent]);
      mockProvider.setMockBlockNumber(1001);
      
      // Reset lastEvent before test
      lastEvent = null;
      
      // Start the listener and process the block
      await ethereumEventListener.start();
      
      // Manually trigger the poll to ensure our mock is used
      await (ethereumEventListener as any).pollForEvents();
      
      // Check that the event was processed
      expect(lastEvent).toBeDefined();
      expect(lastEvent).toMatchObject({
        type: 'EscrowCreated',
        escrow: escrowAddress,
        initiator,
        token,
        amount: expect.anything(),
        targetChain,
        targetAddress,
        blockNumber: 1001,
        transactionHash: '0x' + 'd'.repeat(64)
      });
      
      // Check BigNumber values separately
      expect(lastEvent.amount.toString()).toBe(amount);
    });
  });

  describe('Error Handling', () => {
    test('should handle provider errors during polling', async () => {
      // Set up provider to throw error
      const error = new Error('Provider error');
      mockProvider.setMockError(error);
      
      // Start the listener
      await ethereumEventListener.start();
      
      // Test that the error is properly handled by the polling mechanism
      await expect(ethereumEventListener.start()).resolves.toBeUndefined();
      
      // The error should be caught and logged, but not re-thrown
      await expect(ethereumEventListener['pollForEvents']()).resolves.toBeUndefined();
      
      // Verify listener is still running
      expect(ethereumEventListener.getIsRunning()).toBe(true);
    });

    test('should handle handler errors gracefully', async () => {
      // Set up a handler that throws an error
      const handlerError = new Error('Handler error');
      mockHandlers.onDepositInitiated = async () => {
        throw handlerError;
      };
      
      // Mock console.error
      const originalError = console.error;
      let errorLogged = false;
      console.error = (message: string) => {
        if (message.includes('Error processing event')) {
          errorLogged = true;
        }
      };
      
      try {
        // Create a test event
        const mockEvent = createMockEvent('DepositInitiated', {
          depositId: '0x1234',
          sender: '0x' + 'a'.repeat(40),
          nearRecipient: 'near-recipient.near',
          token: '0x' + 'e'.repeat(40),
          amount: ethers.BigNumber.from('1000'),
          fee: ethers.BigNumber.from('10')
        });
        
        mockProvider.setMockLogs([mockEvent]);
        
        // Start the listener and process the block
        await ethereumEventListener.start();
        await (ethereumEventListener as any).pollForEvents();
        
        // Verify the error was logged
        expect(errorLogged).toBe(true);
        
        // Verify the listener is still running
        expect(ethereumEventListener.getIsRunning()).toBe(true);
      } finally {
        // Restore console.error
        console.error = originalError;
      }
    });
  });

  describe('Block Processing', () => {
    test('should process multiple blocks in order', async () => {
      // Setup mocks for two blocks with different events
      const block1 = 1004;
      const block2 = 1005;
      
      // Create mock events for block1
      const depositEvent = createMockEvent('DepositInitiated', {
        depositId: '0x' + '9'.repeat(64),
        sender: '0x' + 'a'.repeat(40),
        nearRecipient: 'test1.near',
        token: ethers.constants.AddressZero,
        amount: ethers.BigNumber.from('1000000000000000000'),
        fee: ethers.BigNumber.from('10000000000000000'),
        timestamp: Math.floor(Date.now() / 1000)
      }, block1, '0x' + 'b'.repeat(64));
      
      // Create mock events for block2
      const escrowEvent = createMockEvent('EscrowCreated', {
        escrow: escrowAddress,
        initiator: '0x' + 'c'.repeat(40),
        token: ethers.constants.AddressZero,
        amount: ethers.BigNumber.from('2000000000000000000'),
        targetChain: 'near-testnet',
        targetAddress: 'test2.near'
      }, block2, '0x' + 'd'.repeat(64));
      
      // Set up the provider to return different logs based on block number
      mockProvider.getLogs = async (filter: any) => {
        if (filter.fromBlock === block1 && filter.toBlock === block1) {
          return [depositEvent];
        } else if (filter.fromBlock === block2 && filter.toBlock === block2) {
          return [escrowEvent];
        }
        return [];
      };
      
      // Track processed events
      const processedEvents: string[] = [];
      
      mockHandlers.onDepositInitiated = async () => {
        processedEvents.push('deposit');
      };
      
      mockHandlers.onEscrowCreated = async () => {
        processedEvents.push('escrow');
      };
      
      // Start with block1
      mockProvider.setMockBlockNumber(block1);
      await ethereumEventListener.start();
      
      // Process block1
      await (ethereumEventListener as any).pollForEvents();
      
      // Move to block2 and process again
      mockProvider.setMockBlockNumber(block2);
      await (ethereumEventListener as any).pollForEvents();
      
      // Verify both events were processed in order
      expect(processedEvents).toHaveLength(2);
      expect(processedEvents[0]).toBe('deposit');
      expect(processedEvents[1]).toBe('escrow');
      expect(ethereumEventListener.getLastProcessedBlock()).toBe(block2);
    });
  });
});
