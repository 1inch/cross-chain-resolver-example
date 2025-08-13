/**
 * Integration tests for `EthereumRelayer`
 * - Uses standardized mocks in `tests/mocks/`
 * - Aligns strictly with `src/relay/EthereumRelayer.ts` public API
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ethers } from 'ethers';
import path from 'path';

import { MessageType, type DepositMessage, type WithdrawalMessage, type RefundMessage } from '../../src/types/interfaces';
import { MockProvider, MockJsonRpcSigner } from '../mocks/ethers-mock-enhanced';
import { MockNearAccount } from '../mocks/near-api-mock';
import { EthereumContractService } from '../../src/services/EthereumContractService';

// Silence logs
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
// Also mock with .js extension to match ESM import in source
jest.mock('../../src/utils/logger.js', () => ({
  __esModule: true,
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Stub the EthereumEventListener to avoid real polling
jest.mock('../../src/services/EthereumEventListener', () => ({
  __esModule: true,
  EthereumEventListener: class {
    // capture constructor args but ignore
    constructor(_provider: any, _factory: string, _bridge: string, _handlers: any, _poll?: number) {}
    start = jest.fn(async () => {});
    stop = jest.fn(async () => {});
  },
}));

// Stub StorageService to avoid real filesystem writes in tests (inline factories to avoid hoist issues)
jest.mock('../../src/services/StorageService', () => ({
  __esModule: true,
  StorageService: class {
    private processed: Set<string> = new Set();
    constructor(..._args: any[]) {}
    async initialize() { /* no-op */ }
    async loadProcessedMessages() { return Array.from(this.processed); }
    isMessageProcessed(id: string) { return this.processed.has(id); }
    async saveProcessedMessage(id: string) { this.processed.add(id); }
    getProcessedMessageCount() { return this.processed.size; }
  },
}));
// Match with .js extension (actual import in relayer source)
jest.mock('../../src/services/StorageService.js', () => ({
  __esModule: true,
  StorageService: class {
    private processed: Set<string> = new Set();
    constructor(..._args: any[]) {}
    async initialize() { /* no-op */ }
    async loadProcessedMessages() { return Array.from(this.processed); }
    isMessageProcessed(id: string) { return this.processed.has(id); }
    async saveProcessedMessage(id: string) { this.processed.add(id); }
    getProcessedMessageCount() { return this.processed.size; }
  },
}));

// Helpers
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Import the relayer AFTER mocks using require so mocks are applied before module evaluation
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EthereumRelayer } = require('../../src/relay/EthereumRelayer');

function setupTest() {
  const provider = new MockProvider();
  const signer = new MockJsonRpcSigner(provider, '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  // Ensure signer is connected to a provider for validation in EthereumContractService
  (signer as any).provider = provider;
  const nearAccount = new MockNearAccount('relayer.near');
  const storageDir = path.join(
    process.cwd(),
    'storage',
    'jest',
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  );

  const relayer = new EthereumRelayer({
    provider: provider as unknown as ethers.providers.JsonRpcProvider,
    signer: signer as unknown as ethers.Signer,
    nearAccount: nearAccount as any,
    factoryAddress: '0x1111111111111111111111111111111111111111',
    bridgeAddress: '0x2222222222222222222222222222222222222222',
    resolverAddress: '0x3333333333333333333333333333333333333333',
    resolverAbi: [
      'function processPartialFill(bytes32 orderId, uint256 amount) external',
    ],
    storageDir,
    // Optional: pollIntervalMs, storageDir can be left default
  } as any);

  return { relayer, provider, signer, nearAccount };
}

describe('EthereumRelayer - Integration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NEAR_ESCROW_CONTRACT_ID = 'escrow.near';
  });

  it('starts and stops the relayer', async () => {
    const { relayer } = setupTest();
    await relayer.start();
    expect(relayer.isRelayerRunning()).toBe(true);
    await relayer.stop();
    expect(relayer.isRelayerRunning()).toBe(false);
  });

  it('processes a DEPOSIT message and handles EscrowCreated', async () => {
    const { relayer } = setupTest();

    jest
      .spyOn(EthereumContractService.prototype, 'executeFactoryTransaction')
      .mockResolvedValue({
        wait: async () => ({
          transactionHash: '0x' + '1'.repeat(64),
          events: [
            { event: 'DstEscrowCreated', args: { escrow: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD' } },
          ],
        }),
      } as any);

    const msg: DepositMessage = {
      type: MessageType.DEPOSIT,
      messageId: 'message_1',
      sourceChain: 'NEAR',
      destChain: 'ETH',
      sender: 'alice.near',
      recipient: '0x2222222222222222222222222222222222222222',
      amount: '1000000000000000000',
      token: ZERO_ADDR,
      secretHash: '0x' + '4'.repeat(64),
      timelock: Math.floor(Date.now() / 1000) + 3600,
      data: {
        // NEAR tx hash: 32-64 alphanumeric characters (no 0x prefix)
        txHash: 'NEARtxHashDEPOSIT'.padEnd(32, 'A'),
        secretHash: '0x' + '4'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
      },
      timestamp: Date.now(),
    };

    await relayer.processMessage(msg);
    expect(relayer.getProcessedMessageCount()).toBe(1);
  });

  it('processes a WITHDRAWAL message', async () => {
    const { relayer } = setupTest();

    jest
      .spyOn(EthereumContractService.prototype, 'findEscrowByParams')
      .mockResolvedValue({ escrowAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' } as any);

    const execSpy = jest
      .spyOn(EthereumContractService.prototype, 'executeWithdrawal')
      .mockResolvedValue(undefined as any);

    const msg: WithdrawalMessage = {
      type: MessageType.WITHDRAWAL,
      messageId: 'message_2',
      sourceChain: 'ETH',
      destChain: 'NEAR',
      sender: '0x3333333333333333333333333333333333333333',
      recipient: 'bob.near',
      amount: '500000000000000000',
      token: ZERO_ADDR,
      data: { txHash: '0x' + '5'.repeat(64) },
      secret: '0x' + '6'.repeat(64),
      timestamp: Date.now(),
    };

    await relayer.processMessage(msg);
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(relayer.getProcessedMessageCount()).toBe(1);
  });

  it('processes a REFUND message', async () => {
    const { relayer } = setupTest();

    jest
      .spyOn(EthereumContractService.prototype, 'findEscrowByParams')
      .mockResolvedValue({ escrowAddress: '0xFfFfFfFFfFFfFFfFFfFFFFFffffFffffFFFfFFfF' } as any);

    const refundSpy = jest
      .spyOn(EthereumContractService.prototype, 'executeRefund')
      .mockResolvedValue(undefined as any);

    const msg: RefundMessage = {
      type: MessageType.REFUND,
      messageId: 'message_3',
      sourceChain: 'ETH',
      destChain: 'NEAR',
      sender: '0x4444444444444444444444444444444444444444',
      recipient: 'carol.near',
      amount: '1000000000000000000',
      token: ZERO_ADDR,
      // sourceChain is ETH: txHash must be 0x-prefixed 32-byte hex
      data: { txHash: '0x' + '7'.repeat(64) },
      reason: 'timeout',
      timestamp: Date.now(),
    };

    await relayer.processMessage(msg);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(relayer.getProcessedMessageCount()).toBe(1);
  });

  it('handles concurrent DEPOSIT messages', async () => {
    const { relayer } = setupTest();

    jest
      .spyOn(EthereumContractService.prototype, 'executeFactoryTransaction')
      .mockResolvedValue({
        wait: async () => ({
          transactionHash: '0x' + '2'.repeat(64),
          events: [
            { event: 'DstEscrowCreated', args: { escrow: '0x' + 'a'.repeat(40) } },
          ],
        }),
      } as any);

    const messages: DepositMessage[] = Array.from({ length: 5 }, (_, i) => ({
      type: MessageType.DEPOSIT,
      messageId: `message_${i}`,
      sourceChain: 'NEAR',
      destChain: 'ETH',
      sender: 'alice.near',
      recipient: '0x2222222222222222222222222222222222222222',
      amount: '1000000000000000000',
      token: ZERO_ADDR,
      secretHash: ('0x' + '8'.repeat(63) + i),
      timelock: Math.floor(Date.now() / 1000) + 3600,
      data: {
        txHash: `NEARtxHashBatch${i}`.padEnd(34, 'C'),
        secretHash: ('0x' + '8'.repeat(63) + i),
        timelock: Math.floor(Date.now() / 1000) + 3600,
      },
      timestamp: Date.now(),
    }));

    await Promise.all(messages.map((m) => relayer.processMessage(m)));
    expect(relayer.getProcessedMessageCount()).toBe(5);
  });

  it('rapid start/stop cycles are safe', async () => {
    const { relayer } = setupTest();
    for (let i = 0; i < 3; i++) {
      await relayer.start();
      expect(relayer.isRelayerRunning()).toBe(true);
      await relayer.stop();
      expect(relayer.isRelayerRunning()).toBe(false);
    }
  });

  it('handles very small ETH amounts precisely (auction output + safety deposit)', async () => {
    // Build a relayer with an injected auction service returning tiny amounts
    const provider = new MockProvider();
    const signer = new MockJsonRpcSigner(provider, '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    (signer as any).provider = provider;
    const nearAccount = new MockNearAccount('relayer.near');

    const fakeAuction = {
      calculateCurrentRate: () => ({
        outputAmount: '0.00001006',
        feeAmount: '0.0000001006',
        totalCost: '0.0000101606',
        currentRate: 0.0,
        timeRemaining: 180,
      }),
    } as any;

    const { EthereumRelayer } = require('../../src/relay/EthereumRelayer');
    const relayer = new EthereumRelayer({
      provider: provider as unknown as ethers.providers.JsonRpcProvider,
      signer: signer as unknown as ethers.Signer,
      nearAccount: nearAccount as any,
      factoryAddress: '0x1111111111111111111111111111111111111111',
      bridgeAddress: '0x2222222222222222222222222222222222222222',
      resolverAddress: '0x3333333333333333333333333333333333333333',
      resolverAbi: [],
    } as any, { auctionService: fakeAuction });

    const execSpy = jest
      .spyOn(EthereumContractService.prototype, 'executeFactoryTransaction')
      .mockImplementation(async (_method: string, _params: any[], value?: ethers.BigNumber) => {
        // expected precise sum of auction output + fee
        const expected = ethers.utils.parseEther('0.00001006').add(
          ethers.utils.parseEther('0.0000001006')
        );
        expect(value?.toString()).toBe(expected.toString());
        return {
          wait: async () => ({
            transactionHash: '0x' + '3'.repeat(64),
            events: [
              { event: 'DstEscrowCreated', args: { escrow: '0x' + 'b'.repeat(40) } },
            ],
          }),
        } as any;
      });

    const msg: DepositMessage = {
      type: MessageType.DEPOSIT,
      messageId: 'message_small',
      sourceChain: 'NEAR',
      destChain: 'ETH',
      sender: 'alice.near',
      recipient: '0x2222222222222222222222222222222222222222',
      amount: '1000', // not used by fake auction; present for validation
      token: ZERO_ADDR,
      secretHash: '0x' + '4'.repeat(64),
      timelock: Math.floor(Date.now() / 1000) + 3600,
      data: {
        txHash: 'NEARtxHashSMALL'.padEnd(32, 'S'),
        secretHash: '0x' + '4'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
      },
      timestamp: Date.now(),
    };

    await relayer.processMessage(msg);
    expect(execSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects withdrawal when timelock not yet expired (error normalization)', async () => {
    const { relayer } = setupTest();

    jest
      .spyOn(EthereumContractService.prototype, 'findEscrowByParams')
      .mockResolvedValue({ escrowAddress: '0xEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeE' } as any);

    const err = new Error('Refund not available yet. Timelock expires in 120 seconds');
    jest
      .spyOn(EthereumContractService.prototype, 'executeWithdrawal')
      .mockRejectedValue(err);

    const msg: WithdrawalMessage = {
      type: MessageType.WITHDRAWAL,
      messageId: 'message_wd_early',
      sourceChain: 'ETH',
      destChain: 'NEAR',
      sender: '0x3333333333333333333333333333333333333333',
      recipient: 'bob.near',
      amount: '500000000000000000',
      token: ZERO_ADDR,
      data: { txHash: '0x' + '9'.repeat(64) },
      secret: '0x' + '6'.repeat(64),
      timestamp: Date.now(),
    };

    await expect(relayer.processMessage(msg)).rejects.toThrow('Failed to process message');
  });
});
