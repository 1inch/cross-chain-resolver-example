import { ethers, providers, BigNumber, Signer, Contract, ContractInterface, BigNumberish } from 'ethers';
import { jest } from '@jest/globals';

// Extend the TransactionResponse interface to include the wait method
interface TransactionResponse extends providers.TransactionResponse {
  wait(confirmations?: number): Promise<ethers.providers.TransactionReceipt>;
}

// Create a mock receipt that matches the TransactionReceipt interface
interface MockTransactionReceipt extends Omit<ethers.providers.TransactionReceipt, 'contractAddress'> {
  contractAddress: string;
  events: Array<any>;
  status?: number;
  type: number;
}

// Create a mock signer class that implements the necessary signer interface
export class MockJsonRpcSigner {
  private _address: string;
  private _provider: any;

  constructor(provider?: any, address?: string) {
    this._provider = provider;
    this._address = address || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    // Mark as a valid ethers Signer
    (this as any)._isSigner = true;
  }

  async getAddress(): Promise<string> {
    return this._address;
  }

  async signMessage(_message: string): Promise<string> {
    return '0x' + 'signature'.repeat(8);
  }

  async sendTransaction(_transaction: any): Promise<any> {
    const provider = this._provider as any;
    return {
      hash: '0x' + '1'.repeat(64),
      wait: () => {
        const fallback = {
          status: 1,
          transactionHash: '0x' + '1'.repeat(64),
          blockNumber: 12345678,
          gasUsed: BigNumber.from(21000),
        };
        const receipt = provider && provider._mockTransactionReceipt
          ? provider._mockTransactionReceipt
          : fallback;
        // Normalize gasUsed/cumulativeGasUsed/effectiveGasPrice if provided as strings
        if (receipt && receipt.gasUsed && !BigNumber.isBigNumber(receipt.gasUsed)) {
          receipt.gasUsed = BigNumber.from(receipt.gasUsed);
        }
        if (receipt && receipt.cumulativeGasUsed && !BigNumber.isBigNumber(receipt.cumulativeGasUsed)) {
          receipt.cumulativeGasUsed = BigNumber.from(receipt.cumulativeGasUsed);
        }
        if (receipt && receipt.effectiveGasPrice && !BigNumber.isBigNumber(receipt.effectiveGasPrice)) {
          receipt.effectiveGasPrice = BigNumber.from(receipt.effectiveGasPrice);
        }
        return Promise.resolve(receipt);
      }
    };
  }

  async signTransaction(_transaction: any): Promise<string> {
    return '0x' + 'signed'.repeat(8);
  }

  connect(provider: any): MockJsonRpcSigner {
    return new MockJsonRpcSigner(provider);
  }

  connectUnchecked(): MockJsonRpcSigner {
    return this;
  }

  async getBalance(_blockTag?: any): Promise<any> {
    return { toString: () => '1000000000000000000' };
  }

  async getTransactionCount(_blockTag?: any): Promise<number> {
    return 42;
  }

  async estimateGas(_transaction: any): Promise<any> {
    return { toString: () => '21000' };
  }

  async call(_transaction: any, _blockTag?: any): Promise<string> {
    return '0x';
  }

  async resolveName(_name: string): Promise<string> {
    return '0x0000000000000000000000000000000000000000';
  }

  async _signTypedData(_domain: any, _types: any, _value: any): Promise<string> {
    return '0x' + 'typedSignature'.repeat(4);
  }

  // Add missing properties required by JsonRpcSigner
  async _legacySignMessage(_message: string): Promise<string> {
    return '0x' + 'legacySignature'.repeat(4);
  }

  async unlock(_password: string): Promise<boolean> {
    return true;
  }
}

export class MockProvider extends providers.JsonRpcProvider {
  private _blockNumber = 12345678;
  private _signer: MockJsonRpcSigner;
  private _mockError: Error | null = null;
  private _mockEscrow: any = null;
  private _mockTransactionReceipt: any = null;
  public _network: providers.Network;

  // Internal no-op to ensure private fields are "read" for TS
  private _touchInternals(): void {
    void this._mockError;
    void this._mockEscrow;
    void this._mockTransactionReceipt;
  }

  // Mock methods for testing
  public setMockError(error: Error | null) {
    this._mockError = error;
  }

  public setMockEscrow(escrow: any) {
    this._mockEscrow = escrow;
  }

  public setMockTransactionReceipt(receipt: any) {
    const normalized: any = { ...receipt };
    if (normalized.gasUsed && !BigNumber.isBigNumber(normalized.gasUsed)) {
      normalized.gasUsed = BigNumber.from(normalized.gasUsed);
    }
    if (normalized.cumulativeGasUsed && !BigNumber.isBigNumber(normalized.cumulativeGasUsed)) {
      normalized.cumulativeGasUsed = BigNumber.from(normalized.cumulativeGasUsed);
    }
    if (normalized.effectiveGasPrice && !BigNumber.isBigNumber(normalized.effectiveGasPrice)) {
      normalized.effectiveGasPrice = BigNumber.from(normalized.effectiveGasPrice);
    }
    this._mockTransactionReceipt = normalized;
  }

  public static create(): MockProvider {
    return new MockProvider();
  }

  constructor() {
    super('http://localhost:8545');
    this._network = { chainId: 11155111, name: 'sepolia' };
    this._signer = new MockJsonRpcSigner(this);
    this._touchInternals();
  }

  // Override getNetwork to return our mock network
  public async getNetwork(): Promise<providers.Network> {
    return this._network;
  }

  public async getBlockNumber(): Promise<number> {
    return this._blockNumber;
  }

  public async getCode(_address: string): Promise<string> {
    return '0x' + '00'.repeat(32);
  }

  public async getBalance(_address: string): Promise<BigNumber> {
    return BigNumber.from('1000000000000000000'); // 1 ETH
  }

  public getSigner(_addressOrIndex?: string | number): any {
    return this._signer as any;
  }

  // Expose a mock sendTransaction on the provider to satisfy tests that assert on provider.sendTransaction
  public sendTransaction = jest.fn(async (transaction: any) => {
    return this._signer.sendTransaction(transaction);
  });

  public async send(_method: string, _params: any[]): Promise<any> {
    return '';
  }

  public setNetwork(chainId: number, name: string) {
    this._network = { chainId, name };
  }

  public setBlockNumber(blockNumber: number) {
    this._blockNumber = blockNumber;
  }
}

export class MockSigner extends Signer {
  private _address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  private _nonce = 0;
  public provider?: providers.Provider;
  
  constructor(provider?: providers.Provider) {
    super();
    this.provider = provider;
  }

  public async getAddress(): Promise<string> {
    return this._address;
  }

  public setAddress(address: string) {
    this._address = address;
  }

  public async signMessage(_message: string | Uint8Array): Promise<string> {
    return '0x' + '1'.repeat(130);
  }

  public async signTransaction(
    _transaction: providers.TransactionRequest
  ): Promise<string> {
    return '0x' + '1'.repeat(130);
  }

  public async sendTransaction(
    transaction: providers.TransactionRequest
  ): Promise<TransactionResponse> {
    this._nonce++;
    
    const tx: TransactionResponse = {
      hash: '0x' + '1'.repeat(64),
      nonce: this._nonce - 1,
      gasLimit: BigNumber.from(21000),
      gasPrice: BigNumber.from(1000000000),
      data: '0x',
      value: BigNumber.from(0),
      chainId: 11155111,
      confirmations: 0,
      from: this._address,
      wait: async (confirmations?: number): Promise<MockTransactionReceipt> => ({
        status: 1,
        transactionHash: '0x' + '1'.repeat(64),
        blockHash: '0x' + '2'.repeat(64),
        blockNumber: 12345678,
        confirmations: confirmations || 1,
        from: this._address,
        to: transaction.to?.toString() || '0x' + '3'.repeat(40),
        contractAddress: '0x0000000000000000000000000000000000000000',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        byzantium: true,
        transactionIndex: 0,
        type: 0,
        events: [],
        gasUsed: BigNumber.from(21000),
        cumulativeGasUsed: BigNumber.from(21000),
        effectiveGasPrice: BigNumber.from(1000000000)
      })
    };
    
    return tx;
  }

  public connectUnchecked(): Signer {
    return this;
  }

  public connect(provider?: providers.Provider): Signer {
    if (provider) {
      this.provider = provider;
    }
    return this;
  }

  public async getTransactionCount(
    _blockTag?: providers.BlockTag
  ): Promise<number> {
    return this._nonce;
  }

  public async getBalance(_blockTag?: providers.BlockTag): Promise<BigNumber> {
    return BigNumber.from('1000000000000000000'); // 1 ETH
  }

  public async getChainId(): Promise<number> {
    return 11155111;
  }

  public async getGasPrice(): Promise<BigNumber> {
    return BigNumber.from(1000000000);
  }

  public async estimateGas(_transaction: providers.TransactionRequest): Promise<BigNumber> {
    return BigNumber.from(21000);
  }

  public async call(
    _transaction: providers.TransactionRequest,
    _blockTag?: providers.BlockTag
  ): Promise<string> {
    return '0x';
  }
}

export class MockContract extends Contract {
  public functions: { [name: string]: (...args: any[]) => Promise<any> } = {};
  public interface: any = {};
  public provider: any;
  public signer: any;
  public address: string = '0x0000000000000000000000000000000000000000';

  constructor(address: string, abi: ContractInterface, signerOrProvider?: Signer | providers.Provider) {
    super(address, abi, signerOrProvider);
  }

  public static connect(
    address: string,
    contractInterface: ContractInterface,
    signerOrProvider?: Signer | providers.Provider
  ): MockContract {
    return new MockContract(address, contractInterface, signerOrProvider);
  }

  public async getOrderState(_orderId: string): Promise<{
    status: number;
    filledAmount: BigNumber;
    remainingAmount: BigNumber;
  }> {
    return {
      status: 1,
      filledAmount: BigNumber.from(0),
      remainingAmount: BigNumber.from('1000000000000000000'),
    };
  }

  public async executePartialFill(
    _orderId: string,
    _fillAmount: BigNumberish,
    taker: string,
    _signature: string,
    _maxFee: BigNumberish,
    _deadline: BigNumberish
  ): Promise<TransactionResponse> {
    return {
      hash: '0x' + '1'.repeat(64),
      nonce: 0,
      gasLimit: BigNumber.from(21000),
      gasPrice: BigNumber.from(1000000000),
      data: '0x',
      value: BigNumber.from(0),
      chainId: 1,
      confirmations: 0,
      from: taker,
      wait: async (confirmations?: number): Promise<MockTransactionReceipt> => ({
        status: 1,
        transactionHash: '0x' + '1'.repeat(64),
        blockHash: '0x' + '2'.repeat(64),
        blockNumber: 12345678,
        confirmations: confirmations || 1,
        from: taker,
        to: this.address,
        contractAddress: '0x0000000000000000000000000000000000000000',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        byzantium: true,
        transactionIndex: 0,
        type: 0,
        events: [],
        gasUsed: BigNumber.from(21000),
        cumulativeGasUsed: BigNumber.from(21000),
        effectiveGasPrice: BigNumber.from(1000000000)
      })
    };
  }

  public async createEscrow(
    taker: string,
    _amount: BigNumberish,
    _timelock: BigNumberish,
    _hashlock: string
  ): Promise<ethers.providers.TransactionResponse> {
    const txHash = '0x' + '1'.repeat(64);
    
    return {
      hash: txHash,
      nonce: 0,
      gasLimit: BigNumber.from(1000000),
      gasPrice: BigNumber.from(1000000000),
      data: '0x',
      value: BigNumber.from(0),
      chainId: 1,
      confirmations: 0,
      from: taker,
      wait: async (confirmations?: number): Promise<ethers.providers.TransactionReceipt> => ({
        to: this.address,
        from: taker,
        contractAddress: '0x' + '5'.repeat(40), // Default contract address
        transactionIndex: 0,
        root: '0x' + '4'.repeat(64),
        gasUsed: BigNumber.from(21000),
        logsBloom: '0x' + '00'.repeat(256),
        blockHash: '0x' + '2'.repeat(64),
        transactionHash: txHash,
        logs: [],
        blockNumber: 12345678,
        confirmations: confirmations || 1,
        cumulativeGasUsed: BigNumber.from(21000),
        effectiveGasPrice: BigNumber.from(1000000000),
        byzantium: true,
        type: 0
      } as ethers.providers.TransactionReceipt)
    };
  }
}
