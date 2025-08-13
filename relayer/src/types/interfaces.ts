/**
 * Core interfaces for the relayer system
 * Provides type safety and clear contracts between components
 */

import { ethers } from 'ethers';

// Base event listener interface
export interface IEventListener {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

// Message processing interface
export interface IMessageProcessor {
  processMessage(message: CrossChainMessage): Promise<void>;
  getProcessedMessageCount(): number;
}

// Validation interface
export interface IValidator {
  validateEthereumAddress(address: string): boolean;
  validateNearAccountId(accountId: string): boolean;
  validateAmount(amount: string | bigint): boolean;
  validateSecretHash(hash: string): boolean;
}

// Storage interface
export interface IStorageService {
  saveProcessedMessage(messageId: string): Promise<void>;
  loadProcessedMessages(): Promise<Set<string>>;
  isMessageProcessed(messageId: string): boolean;
}

// Contract service interface
export interface IContractService {
  getContractDetails(address: string): Promise<any>;
  executeTransaction(contractAddress: string, method: string, params: any[]): Promise<ethers.ContractTransaction>;
}

// Cross-chain message types
export enum MessageType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  REFUND = 'REFUND'
}

export interface CrossChainMessage {
  messageId: string;
  type: MessageType;
  sourceChain: 'NEAR' | 'ETH';
  destChain: 'NEAR' | 'ETH';
  sender: string;
  recipient: string;
  amount: string;
  token: string;
  data: {
    secretHash?: string;
    secret?: string;
    timelock?: number;
    txHash: string;
  };
  timestamp: number;
  signature?: string;
}

// Ethereum-specific types
export interface EthereumEscrowDetails {
  status: number;
  token: string;
  amount: string;
  timelock: number;
  secretHash: string;
  initiator: string;
  recipient: string;
  chainId: number;
  escrowAddress?: string;
}

export interface DepositMessage extends CrossChainMessage {
  secretHash: string;
  timelock: number;
}

export interface WithdrawalMessage extends CrossChainMessage {
  secret: string;
}

export interface RefundMessage extends CrossChainMessage {
  reason: string;
}

// NEAR-specific types
export interface NearEscrowDetails {
  id: string;
  initiator: string;
  recipient: string;
  token?: string;
  amount: string;
  target_chain?: string;
  target_address?: string;
  target_escrow?: string;
  status: string;
  created_at: number;
  expires_at?: number;
  completed_at?: number | null;
  timelock?: number;
  secret_hash: string;
  secret?: string | null;
}

// Event interfaces for NEAR
export interface SwapOrderCreatedEvent {
  orderId: string;
  initiator: string;
  recipient: string;
  amount: string;
  secretHash: string;
  timelock: number;
  blockHeight: number;
  transactionHash: string;
}

export interface SwapOrderCompletedEvent {
  orderId: string;
  secret: string;
  blockHeight: number;
  transactionHash: string;
}

// Event interfaces for Ethereum
export interface EthereumEscrowCreatedEvent {
  escrowAddress: string;
  initiator: string;
  recipient: string;
  amount: string;
  secretHash: string;
  timelock: number;
  blockNumber: number;
  transactionHash: string;
}

export interface EthereumEscrowCompletedEvent {
  escrowAddress: string;
  secret: string;
  blockNumber: number;
  transactionHash: string;
}

// Properly typed NEAR provider interface
export interface NearProvider {
  status(): Promise<{
    sync_info: {
      latest_block_height: number;
    };
  }>;
  
  block(params: { blockId: number | string }): Promise<{
    header: {
      hash: string;
      timestamp: number;
    };
    chunks: Array<{
      chunk_hash: string;
      hash?: string;
    }>;
  }>;
  
  chunk(chunkHash: string): Promise<{
    transactions: Array<{
      hash: string;
      signer_id: string;
      receiver_id: string;
    }>;
    receipts: Array<{
      outcome: {
        logs: string[];
        status: {
          SuccessValue?: string;
          Failure?: any;
        };
      };
    }>;
  }>;
  
  txStatus(txHash: string, signerId: string): Promise<{
    receipts_outcome: Array<{
      outcome: {
        logs: string[];
        status: {
          SuccessValue?: string;
          Failure?: any;
        };
      };
    }>;
  }>;
}

// Properly typed NEAR account interface
export interface NearAccount {
  accountId: string;
  connection: {
    provider: NearProvider;
    signer: any;
  };
  functionCall(params: {
    contractId: string;
    methodName: string;
    args: any;
    gas: bigint;
    attachedDeposit: bigint;
  }): Promise<any>;
}

// Escrow search parameters
export interface EscrowSearchParams {
  initiator?: string;
  amount?: string;
  secretHash?: string;
  maxBlocksToSearch?: number;
  maxEscrowsToCheck?: number;
}

// Partial fill interfaces
export interface PartialFillParams {
  orderId: string;
  fillAmount: string;
  recipient: string;
  token: string;
  minFillPercent?: number;
  maxFills?: number;
}

export interface OrderState {
  filledAmount: string;
  remainingAmount: string;
  fillCount: number;
  isFullyFilled: boolean;
  isCancelled: boolean;
  lastFillTimestamp: number;
  childOrders: string[];
}

// Configuration interfaces
export interface RelayerConfig {
  ethereum: {
    rpcUrl: string;
    chainId: number;
    privateKey: string;
    factoryAddress: string;
    bridgeAddress: string;
  };
  near: {
    networkId: string;
    nodeUrl: string;
    accountId: string;
    privateKey: string;
    escrowContractId: string;
  };
  polling: {
    intervalMs: number;
    maxRetries: number;
    retryDelayMs: number;
  };
}
