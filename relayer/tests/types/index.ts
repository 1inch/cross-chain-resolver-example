// Re-export types from the actual source code
export enum MessageType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  REFUND = 'REFUND'
}

// Base cross-chain message interface
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

// Specific message types extending the base
export interface DepositMessage extends CrossChainMessage {
  type: MessageType.DEPOSIT;
  secretHash: string;
  timelock: number;
}

export interface WithdrawalMessage extends CrossChainMessage {
  type: MessageType.WITHDRAWAL;
  secret: string;
}

export interface RefundMessage extends CrossChainMessage {
  type: MessageType.REFUND;
  reason: string;
}

// Event interfaces from EthereumEventListener
export interface DepositInitiatedEvent {
  depositId: string;
  sender: string;
  nearRecipient: string;
  token: string;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
  blockNumber: number;
  transactionHash: string;
}

export interface MessageSentEvent {
  messageId: string;
  targetChain: string;
  targetAddress: string;
  data: string;
  blockNumber: number;
}

export interface WithdrawalCompletedEvent {
  messageId: string;
  recipient: string;
  amount: bigint;
  secretHash: string;
  blockNumber: number;
  transactionHash: string;
}

export interface EscrowCreatedEvent {
  escrow: string;
  initiator: string;
  amount: string;
  targetChain: string;
  blockNumber: number;
}

// NEAR event interfaces
export interface SwapOrderCreatedEvent {
  orderId: string;
  initiator: string;
  recipient: string;
  amount: string;
  token: string;
  blockHeight: number;
  transactionHash: string;
}

export interface SwapOrderCompletedEvent {
  orderId: string;
  secret: string;
  blockHeight: number;
  transactionHash: string;
}

export interface SwapOrderRefundedEvent {
  orderId: string;
  reason: string;
  blockHeight: number;
  transactionHash: string;
}

// Configuration interfaces
export interface EthereumRelayerConfig {
  provider: any;
  signer: any;
  nearAccount: any;
  factoryAddress: string;
  bridgeAddress: string;
  storageDir: string;
  pollIntervalMs?: number;
}
