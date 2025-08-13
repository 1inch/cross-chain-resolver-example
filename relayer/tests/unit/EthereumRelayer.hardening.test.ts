import { ethers } from 'ethers';
import { EthereumRelayer, EthereumRelayerConfig } from '../../src/relay/EthereumRelayer';
import { DepositMessage, MessageType } from '../../src/types/interfaces';
// Mock the contract service to avoid real ethers.Contract construction
jest.mock('../../src/services/EthereumContractService', () => {
  return {
    EthereumContractService: jest.fn().mockImplementation(() => ({
      executeFactoryTransaction: jest.fn(),
      getSignerAddress: jest.fn(async () => '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
    })),
  };
});
jest.mock('../../src/services/EthereumEventListener', () => {
  return {
    EthereumEventListener: jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      on: jest.fn(),
    })),
  };
});
jest.mock('../../src/services/StorageService', () => {
  return {
    StorageService: jest.fn().mockImplementation(() => ({
      initialize: jest.fn(async () => {}),
      saveProcessedMessage: jest.fn(async () => {}),
      markMessageStarted: jest.fn(async () => {}),
      markMessageSucceeded: jest.fn(async () => {}),
      markMessageFailed: jest.fn(async () => {}),
      getMessageStatus: jest.fn(() => undefined),
    })),
  };
});
// (no direct import of EthereumContractService needed here)

describe('EthereumRelayer Hardening', () => {
  const ZERO = ethers.constants.AddressZero;

  function buildRelayer(opts?: Partial<EthereumRelayerConfig>) {
    const provider = {} as unknown as ethers.providers.JsonRpcProvider;
    const signer = { provider } as unknown as ethers.Signer;
    const nearAccount = { functionCall: jest.fn() } as any;

    const config: EthereumRelayerConfig = {
      provider,
      signer,
      nearAccount,
      factoryAddress: '0x1111111111111111111111111111111111111111',
      bridgeAddress: '0x2222222222222222222222222222222222222222',
      resolverAddress: '0x3333333333333333333333333333333333333333',
      resolverAbi: [],
      pollIntervalMs: 100,
      storageDir: `storage/test-${Date.now()}`,
      concurrencyLimit: opts?.concurrencyLimit ?? 2,
      retry: opts?.retry,
      auctionConfig: opts?.auctionConfig,
    };
    const relayer = new EthereumRelayer(config);
    // Default stubs to ensure stable behavior unless overridden per-test
    (relayer as any).contractService.getSignerAddress = jest.fn(async () => '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    (relayer as any).contractService.executeFactoryTransaction = jest.fn(async () => ({
      wait: async () => ({ events: [{ event: 'DstEscrowCreated', args: { escrow: '0x' + 'b'.repeat(40) } }] }),
    }));
    return relayer;
  }

  function buildDepositMessage(id: string): DepositMessage {
    const now = Math.floor(Date.now() / 1000);
    const secretHash = '0x' + '5'.repeat(64);
    return {
      type: MessageType.DEPOSIT,
      messageId: id,
      sourceChain: 'NEAR',
      destChain: 'ETH',
      sender: 'alice.near',
      recipient: '0x2222222222222222222222222222222222222222',
      amount: '1000',
      token: ZERO,
      secretHash,
      timelock: now + 3600,
      data: { txHash: 'NEARtxHashE2E'.padEnd(32, 'E'), secretHash, timelock: now + 3600 },
      timestamp: Date.now(),
    };
  }

  it('respects concurrencyLimit when processing multiple messages', async () => {
    const relayer = buildRelayer({ concurrencyLimit: 2 });

    let active = 0;
    let maxActive = 0;
    // Override this relayer's contract service directly to avoid instance confusion
    (relayer as any).contractService.executeFactoryTransaction = jest.fn(async () => {
        active++;
        if (active > maxActive) maxActive = active;
        // simulate async work
        await new Promise((r) => setTimeout(r, 50));
        active--;
        return {
          wait: async () => ({
            events: [{ event: 'DstEscrowCreated', args: { escrow: '0x' + 'b'.repeat(40) } }],
          }),
        } as any;
      });
    (relayer as any).contractService.getSignerAddress = jest.fn(async () => '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

    const msgs = Array.from({ length: 5 }, (_, i) => buildDepositMessage(`conc_${i}_${Date.now()}`));
    await Promise.all(msgs.map((m) => relayer.processMessage(m)));

    expect(((relayer as any).contractService.executeFactoryTransaction as jest.Mock).mock.calls.length).toBe(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('applies retry overrides for factoryTx (fail twice then succeed)', async () => {
    const relayer = buildRelayer({
      retry: {
        factoryTx: { retries: 3, shouldRetry: () => true, minDelayMs: 1, maxDelayMs: 5, factor: 1.2, jitter: false },
      },
    });

    let calls = 0;
    (relayer as any).contractService.executeFactoryTransaction = jest.fn(async () => {
        calls++;
        if (calls < 3) {
          throw new Error('UNPREDICTABLE_GAS_LIMIT simulated');
        }
        return {
          wait: async () => ({ events: [{ event: 'DstEscrowCreated', args: { escrow: '0x' + 'b'.repeat(40) } }] }),
        } as any;
      });
    (relayer as any).contractService.getSignerAddress = jest.fn(async () => '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

    const msg = buildDepositMessage('retry_factory_' + Date.now());
    await relayer.processMessage(msg);
    expect(calls).toBe(3);
  });
});
