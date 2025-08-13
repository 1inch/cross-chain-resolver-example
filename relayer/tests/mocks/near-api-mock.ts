/**
 * Mock implementation for NEAR API
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Type definitions for mock responses
interface MockBlockResult {
  header: {
    height: number;
    hash: string;
    timestamp: bigint;
    prev_hash: string;
    epoch_id?: string;
    next_epoch_id?: string;
    prev_state_root?: string;
    chunk_receipts_root?: string;
    chunk_headers_root?: string;
    chunk_tx_root?: string;
    outcome_root?: string;
    random_value?: string;
    latest_protocol_version?: number;
  };
  chunks: Array<{
    chunk_hash: string;
    prev_block_hash: string;
    outcome_root: string;
    prev_state_root: string;
    encoded_merkle_root: string;
    encoded_length: number;
    height_created: number;
    height_included: number;
    shard_id: number;
    gas_used: number;
    gas_limit: number;
    balance_burnt: string;
    outgoing_receipts_root: string;
    tx_root: string;
    validator_proposals: any[];
    signature: string;
  }>;
}

/**
 * Mock Near Connection that holds a provider reference
 */
export class MockNearConnection {
  public readonly networkId: string;
  public readonly provider: MockNearProvider;

  constructor(networkId: string, provider: MockNearProvider) {
    this.networkId = networkId;
    this.provider = provider;
  }
}

/**
 * Mock NEAR Account implementing minimal interface and event emitting
 */
export class MockNearAccount extends EventEmitter {
  public accountId: string;
  public connection: { provider: MockNearProvider; signer: any };

  private mockError: Error | null = null;
  private mockFunctionCallResult: any = null;
  private mockViewFunctionResult: any = null;

  constructor(accountId: string = 'test.near', connection?: MockNearConnection) {
    super();
    this.accountId = accountId;
    const provider = connection?.provider ?? new MockNearProvider();
    this.connection = { provider, signer: { signMessage: jest.fn() } as any };
  }

  public setMockError(error: Error | null) {
    this.mockError = error;
  }

  public setMockFunctionCallResult(result: any) {
    this.mockFunctionCallResult = result;
  }

  public setMockViewFunctionResult(result: any) {
    this.mockViewFunctionResult = result;
    // Also forward to provider so provider.query can return this data
    if (this.connection && this.connection.provider && (this.connection.provider as any).setMockViewFunctionResult) {
      (this.connection.provider as any).setMockViewFunctionResult(result);
    }
  }

  public async functionCall(params: any): Promise<FinalExecutionOutcome> {
    if (this.mockError) throw this.mockError;
    const { args, gas, attachedDeposit } = params || {};

    // Simulate NEAR JSON serialization requirement: args must not contain BigInt
    try {
      // This will throw if args includes any BigInt
      JSON.stringify(args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to serialize functionCall args: ${msg}`);
    }

    // Be tolerant with gas/deposit types: coerce to bigint if provided as number/string
    if (gas !== undefined && typeof gas !== 'bigint') {
      try {
        params.gas = BigInt(gas);
      } catch {
        throw new Error('gas must be a bigint');
      }
    }
    if (attachedDeposit !== undefined && typeof attachedDeposit !== 'bigint') {
      try {
        params.attachedDeposit = BigInt(attachedDeposit);
      } catch {
        throw new Error('attachedDeposit must be a bigint');
      }
    }

    return (
      this.mockFunctionCallResult ?? {
        transaction: { hash: 'tx123' },
        receipts_outcome: [],
        // Provide a NEAR-like success status by default so services treat call as successful
        status: { SuccessValue: '' }
      }
    );
  }

  public async viewFunction(_contractId: string, _method: string, _args?: any): Promise<any> {
    if (this.mockError) throw this.mockError;
    return this.mockViewFunctionResult ?? {};
  }

  public async getAccountBalance(): Promise<{ total: string; available: string }> {
    return {
      total: '1000000000000000000000000',
      available: '1000000000000000000000000'
    };
  }

  public async state(): Promise<{ amount: string; code_hash: string }> {
    return {
      amount: '1000000000000000000000000',
      code_hash: 'hash123'
    };
  }
}

interface MockChunkResult {
  transactions: Array<{
    hash: string;
    signer_id: string;
    receiver_id: string;
    actions: any[];
  }>;
  receipts: any[];
}

interface MockTransactionOutcome {
  transaction: {
    hash: string;
    signer_id: string;
    receiver_id: string;
    actions: any[];
  };
  receipts_outcome: Array<{
    id: string;
    outcome: {
      logs: string[];
      receipt_ids: string[];
      gas_burnt: number;
      status: any;
    };
  }>;
}

// Minimal type to satisfy tests where we cast sendTransaction result
interface FinalExecutionOutcome {
  transaction: { hash: string };
  receipts_outcome: Array<{
    id?: string;
    outcome?: any;
  }>;
}

/**
 * Mock Near Provider for testing
 */
export class MockNearProvider {
  private mockBlock: MockBlockResult | null = null;
  private mockChunks: Record<string, MockChunkResult> = {};
  private mockStatus: any = null;
  private mockError: Error | null = null;
  private mockTransactionOutcome: MockTransactionOutcome | null = null;
  private mockViewFunctionResult: any = null;
  private mockCallFunctionResultsByMethod: Record<string, any> = {};

  setMockBlock(block: MockBlockResult) {
    this.mockBlock = block;
  }

  setMockChunk(chunkHash: string, chunk: MockChunkResult) {
    this.mockChunks[chunkHash] = chunk;
  }

  setMockStatus(status: any) {
    this.mockStatus = status;
  }

  setMockError(error: Error) {
    this.mockError = error;
  }

  setMockTransactionOutcome(outcome: MockTransactionOutcome) {
    this.mockTransactionOutcome = outcome;
  }

  setMockViewFunctionResult(result: any) {
    this.mockViewFunctionResult = result;
  }

  setMockCallFunctionResult(methodName: string, result: any) {
    this.mockCallFunctionResultsByMethod[methodName] = result;
  }

  async block(params: { blockId: number | string } | number): Promise<{ header: { hash: string; timestamp: number }; chunks: Array<{ chunk_hash: string; hash?: string }> }> {
    if (this.mockError) {
      throw this.mockError;
    }
    const blockId = typeof params === 'number' ? params : Number(params.blockId);
    if (this.mockBlock) {
      // Adapt stored mock to simplified interface shape
      return {
        header: {
          hash: this.mockBlock.header.hash,
          // Convert bigint ns to number ms -> seconds
          timestamp: Number(this.mockBlock.header.timestamp / 1_000_000n),
        },
        chunks: this.mockBlock.chunks.map((c) => ({ chunk_hash: c.chunk_hash, hash: (c as any).hash }))
      };
    }
    return {
      header: {
        hash: `mock-hash-${blockId}`,
        timestamp: Math.floor(Date.now() / 1000),
      },
      chunks: [{
        chunk_hash: `chunk-hash-${blockId}`,
        hash: `chunk-hash-${blockId}`
      }],
    };
  }

  async chunk(chunkHash: string): Promise<{ transactions: Array<{ hash: string; signer_id: string; receiver_id: string }>; receipts: Array<{ outcome: { logs: string[]; status: { SuccessValue?: string; Failure?: any } } }> }> {
    if (this.mockError) {
      throw this.mockError;
    }
    const chunk = this.mockChunks[chunkHash];
    if (chunk) {
      return {
        transactions: chunk.transactions.map(t => ({ hash: t.hash, signer_id: t.signer_id, receiver_id: t.receiver_id })),
        receipts: (chunk as any).receipts?.map((r: any) => ({ outcome: r.outcome ?? { logs: [], status: {} } })) ?? []
      };
    }
    return {
      transactions: [],
      receipts: [],
    };
  }

  async status() {
    if (this.mockError) {
      throw this.mockError;
    }
    return this.mockStatus || {
      sync_info: {
        latest_block_height: 1000,
      },
    };
  }

  async txStatus(txHash: string, senderId: string): Promise<MockTransactionOutcome> {
    if (this.mockError) {
      throw this.mockError;
    }
    if (this.mockTransactionOutcome) {
      return this.mockTransactionOutcome;
    }
    return {
      transaction: {
        hash: txHash,
        signer_id: senderId,
        receiver_id: 'test-receiver',
        actions: [],
      },
      receipts_outcome: [{
        id: 'test-receipt-id',
        outcome: {
          logs: [],
          receipt_ids: [],
          gas_burnt: 0,
          status: { SuccessValue: '' },
        },
      }],
    };
  }

  // Minimal implementation of near provider.query used by NearContractService
  async query(params: any): Promise<any> {
    if (this.mockError) {
      throw this.mockError;
    }

    const { request_type } = params || {};
    if (request_type === 'call_function') {
      const methodName = params.method_name as string;
      const payload =
        (methodName && this.mockCallFunctionResultsByMethod[methodName] !== undefined)
          ? this.mockCallFunctionResultsByMethod[methodName]
          : (this.mockViewFunctionResult ?? {});
      return {
        // NEAR returns a result buffer; our service decodes Buffer.from(result.result)
        result: Buffer.from(JSON.stringify(payload))
      } as any;
    }

    if (request_type === 'view_account') {
      // Return a minimal account state object
      return {
        amount: '1000000000000000000000000',
        code_hash: 'hash123'
      } as any;
    }

    // Default fallback
    return {} as any;
  }
}

// Create a mock NEAR account with all required methods
export const createMockNearAccount = (accountId: string) => new MockNearAccount(accountId);

// Default export for backward compatibility
export const mockNearAccount = createMockNearAccount('test.near');

export const mockNearConnection = new MockNearConnection('testnet', new MockNearProvider());

export const nearApi = {
  // Explicitly type the connect mock to return a Promise<MockNearConnection>
  connect: jest.fn<() => Promise<MockNearConnection>>().mockResolvedValue(mockNearConnection),
  keyStores: {
    InMemoryKeyStore: jest.fn().mockImplementation(() => ({
      setKey: jest.fn(),
      getKey: jest.fn(),
      clear: jest.fn()
    }))
  },
  utils: {
    format: {
      parseNearAmount: jest.fn().mockImplementation((...args: unknown[]) => {
        const amount = String(args[0] ?? '0');
        return (parseFloat(amount) * 1e24).toString();
      }),
      formatNearAmount: jest.fn().mockImplementation((...args: unknown[]) => {
        const amount = String(args[0] ?? '0');
        return (parseFloat(amount) / 1e24).toString();
      })
    }
  }
};

export default nearApi;
