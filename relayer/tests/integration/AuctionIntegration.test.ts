/**
 * Integration tests for auction flow wiring in EthereumRelayer
 * - Verifies that calculateCurrentRate is called with runtime params and auctionConfig
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ethers } from 'ethers';
import path from 'path';

import { MessageType, type DepositMessage } from '../../src/types/interfaces';
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
    constructor(_provider: any, _factory: string, _bridge: string, _handlers: any, _poll?: number) {}
    start = jest.fn(async () => {});
    stop = jest.fn(async () => {});
  },
}));

// Stub StorageService to avoid real filesystem writes in tests
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

// Import the relayer AFTER mocks
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EthereumRelayer } = require('../../src/relay/EthereumRelayer');

function setupTest(auctionConfig?: any) {
  const provider = new MockProvider();
  const signer = new MockJsonRpcSigner(provider, '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  (signer as any).provider = provider;
  const nearAccount = new MockNearAccount('relayer.near');
  const storageDir = path.join(
    process.cwd(),
    'storage',
    'jest',
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  );

  const mockAuctionService = {
    calculateCurrentRate: jest.fn().mockReturnValue({
      currentRate: 0.001,
      outputAmount: '900000000000000000', // 0.9 ETH or 0.9 NEAR depending on direction
      feeAmount: '100000000000000000',
      totalCost: '1000000000000000000',
      timeRemaining: 250,
    }),
  };

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
    auctionConfig,
  } as any, { auctionService: mockAuctionService as any });

  return { relayer, provider, signer, nearAccount, mockAuctionService };
}

describe('Auction flow wiring - Integration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NEAR_ESCROW_CONTRACT_ID = 'escrow.near';
  });

  it('passes auctionConfig and runtime params to calculateCurrentRate during NEAR→ETH processing', async () => {
    const auctionConfig = {
      duration: 300,
      initialRateBump: 0,
      points: [{ delay: 0, coefficient: 0 }],
      gasBumpEstimate: 21000,
      gasPriceEstimate: 10,
      minFillPercentage: 0.1,
      maxRateBump: 100,
    };

    const { relayer, mockAuctionService } = setupTest(auctionConfig);

    jest
      .spyOn(EthereumContractService.prototype, 'executeFactoryTransaction')
      .mockResolvedValue({
        wait: async () => ({
          transactionHash: '0x' + '1'.repeat(64),
          events: [
            { event: 'EscrowCreated', args: { escrowAddress: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD' } },
          ],
        }),
      } as any);

    const msg: DepositMessage = {
      type: MessageType.DEPOSIT,
      messageId: 'message_auction_1',
      sourceChain: 'NEAR',
      destChain: 'ETH',
      sender: 'alice.near',
      recipient: '0x2222222222222222222222222222222222222222',
      amount: '1000000000000000000',
      token: '0x0000000000000000000000000000000000000000',
      secretHash: '0x' + '4'.repeat(64),
      timelock: Math.floor(Date.now() / 1000) + 3600,
      data: {
        txHash: 'A'.repeat(32),
        secretHash: '0x' + '4'.repeat(64),
        timelock: Math.floor(Date.now() / 1000) + 3600,
      },
      timestamp: Date.now(),
    };

    await relayer.processMessage(msg);

    expect(mockAuctionService.calculateCurrentRate).toHaveBeenCalledTimes(1);
    const [paramsArg, cfgArg] = (mockAuctionService.calculateCurrentRate as jest.Mock).mock.calls[0];

    // Validate runtime params shape
    expect(paramsArg).toEqual(
      expect.objectContaining({
        fromChain: 'NEAR',
        toChain: 'ETH',
        fromAmount: msg.amount,
        orderId: msg.data.txHash,
      })
    );

    // Config should be forwarded
    expect(cfgArg).toEqual(auctionConfig);
  });

  it('passes auctionConfig and runtime params to calculateCurrentRate during ETH→NEAR escrow handling and uses auction output as NEAR deposit', async () => {
    const auctionConfig = {
      duration: 180,
      initialRateBump: 2500,
      points: [{ delay: 0, coefficient: 0 }],
      gasBumpEstimate: 21000,
      gasPriceEstimate: 15,
      minFillPercentage: 0.2,
      maxRateBump: 100000,
    };

    const { relayer, nearAccount, mockAuctionService } = setupTest(auctionConfig);

    // Spy on NEAR functionCall to capture attachedDeposit
    const fnSpy = jest.spyOn(nearAccount as any, 'functionCall');

    const event = {
      escrow: '0x' + 'e'.repeat(40),
      initiator: '0x1111111111111111111111111111111111111111',
      token: '0x0000000000000000000000000000000000000000',
      amount: BigInt('1000000000000000000'), // 1 ETH
      targetChain: 'near',
      targetAddress: 'bob.near',
      blockNumber: 12345,
      transactionHash: '0x' + 'a'.repeat(64),
    } as any;

    await (relayer as any).handleEscrowCreated(event);

    expect(mockAuctionService.calculateCurrentRate).toHaveBeenCalledTimes(1);
    const [paramsArg, cfgArg] = (mockAuctionService.calculateCurrentRate as jest.Mock).mock.calls[0];

    // Validate runtime params shape for ETH→NEAR
    expect(paramsArg).toEqual(
      expect.objectContaining({
        fromChain: 'ETH',
        toChain: 'NEAR',
        fromAmount: event.amount.toString(),
        orderId: event.escrow,
      })
    );

    // Config should be forwarded (by reference)
    expect(cfgArg).toBe(auctionConfig);

    // NEAR functionCall should receive attachedDeposit equal to auction outputAmount (yoctoNEAR)
    expect(fnSpy).toHaveBeenCalledTimes(1);
    const callArg = fnSpy.mock.calls[0][0] as { attachedDeposit: bigint };
    const resultVal = ((mockAuctionService.calculateCurrentRate as unknown) as jest.Mock).mock
      .results[0]?.value as { outputAmount: string };
    const outputYocto = BigInt(resultVal.outputAmount);
    expect(callArg.attachedDeposit).toBe(outputYocto);
  });
});
