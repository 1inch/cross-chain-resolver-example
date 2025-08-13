#!/usr/bin/env ts-node

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { createLogger, format, transports, Logger } from 'winston';

dotenv.config();

// Enhanced error classes for better error handling
class RelayerMonitorError extends Error {
  constructor(message: string, public code: string, public details?: any) {
    super(message);
    this.name = 'RelayerMonitorError';
  }
}

class NetworkError extends RelayerMonitorError {
  constructor(message: string, details?: any) {
    super(message, 'NETWORK_ERROR', details);
  }
}

class ValidationError extends RelayerMonitorError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

class ConfigurationError extends RelayerMonitorError {
  constructor(message: string, details?: any) {
    super(message, 'CONFIGURATION_ERROR', details);
  }
}

// Enhanced type definitions with validation
interface DepositInitiatedEvent {
  depositId: string;
  sender: string;
  nearRecipient: string;
  token: string;
  amount: bigint;
  fee: bigint;
  timestamp: bigint;
}

interface MessageSentEvent {
  messageId: string;
  depositId: string;
  sender: string;
  recipient: string;
  amount: bigint;
  timestamp: bigint;
}

interface WithdrawalCompletedEvent {
  depositId: string;
  recipient: string;
  amount: bigint;
  timestamp: bigint;
}

interface NearSwapOrderEvent {
  orderId: string;
  amount: string;
  recipient: string;
  hashlock: string;
  timelock: number;
  txHash: string;
  timestamp: number;
}

interface NearOrderStatus {
  orderId: string;
  status: 'created' | 'processing' | 'completed' | 'failed';
  amount: string;
  recipient: string;
  hashlock?: string;
  timelock?: number;
  created_at?: number;
}

interface TransferInfo {
  type: 'eth-to-near' | 'near-to-eth';
  startTime: number;
  ethTxHash?: string;
  nearTxHash?: string;
  orderId?: string;
  depositId?: string;
  status: 'initiated' | 'processing' | 'completed' | 'failed';
}

interface MonitorConfig {
  ethereumRpcUrl: string;
  nearRpcUrl: string;
  nearBridgeAddress: string;
  nearEscrowContract: string;
  pollInterval: number;
  maxReconnectAttempts: number;
  healthCheckInterval: number;
  logLevel: string;
}

// Enhanced configuration validation
class ConfigValidator {
  static validateMonitorConfig(config: Partial<MonitorConfig>): MonitorConfig {
    const errors: string[] = [];

    if (!config.ethereumRpcUrl || !this.isValidUrl(config.ethereumRpcUrl)) {
      errors.push('Invalid or missing ethereumRpcUrl');
    }

    if (!config.nearRpcUrl || !this.isValidUrl(config.nearRpcUrl)) {
      errors.push('Invalid or missing nearRpcUrl');
    }

    if (!config.nearBridgeAddress || !ethers.isAddress(config.nearBridgeAddress)) {
      errors.push('Invalid or missing nearBridgeAddress');
    }

    if (!config.nearEscrowContract || config.nearEscrowContract.length === 0) {
      errors.push('Invalid or missing nearEscrowContract');
    }

    if (errors.length > 0) {
      throw new ValidationError('Configuration validation failed', { errors });
    }

    return {
      ethereumRpcUrl: config.ethereumRpcUrl!,
      nearRpcUrl: config.nearRpcUrl!,
      nearBridgeAddress: config.nearBridgeAddress!,
      nearEscrowContract: config.nearEscrowContract!,
      pollInterval: config.pollInterval || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
      healthCheckInterval: config.healthCheckInterval || 30000,
      logLevel: config.logLevel || 'info'
    };
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

// Enhanced RelayerMonitor class with proper encapsulation
class RelayerMonitor {
  private config: MonitorConfig;
  private logger: Logger;
  private provider: ethers.JsonRpcProvider;
  private bridgeContract: ethers.Contract;
  private reconnectAttempts = 0;
  private lastProcessedBlock = 0;
  private lastProcessedNearBlock = 0;
  private nearMonitoringActive = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private activeTransfers = new Map<string, TransferInfo>();
  private isShuttingDown = false;

  private static readonly BRIDGE_ABI = [
    'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
    'event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed sender, string nearRecipient, uint256 amount, uint256 timestamp)',
    'event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp)'
  ] as const;

  constructor(config: Partial<MonitorConfig>) {
    this.config = ConfigValidator.validateMonitorConfig(config);
    this.logger = this.createLogger();
    this.provider = new ethers.JsonRpcProvider(this.config.ethereumRpcUrl);
    this.bridgeContract = new ethers.Contract(
      this.config.nearBridgeAddress,
      RelayerMonitor.BRIDGE_ABI,
      this.provider
    );

    this.setupEventListeners();
    this.setupProcessHandlers();
  }

  private createLogger(): Logger {
    return createLogger({
      level: this.config.logLevel,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
        })
      ),
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.simple()
          )
        }),
        new transports.File({ 
          filename: 'relayer-monitor.log',
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5
        })
      ]
    });
  }

  private setupEventListeners(): void {
    // Ethereum event listeners
    this.bridgeContract.on('DepositInitiated', this.handleDepositInitiated.bind(this));
    this.bridgeContract.on('MessageSent', this.handleMessageSent.bind(this));
    this.bridgeContract.on('WithdrawalCompleted', this.handleWithdrawalCompleted.bind(this));

    // Provider event listeners
    this.provider.on('block', this.handleNewBlock.bind(this));
    this.provider.on('error', this.handleProviderError.bind(this));
  }

  private setupProcessHandlers(): void {
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      this.gracefulShutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection', { reason });
      this.gracefulShutdown('unhandledRejection');
    });
  }

  async start(): Promise<void> {
    try {
      this.logger.info('Starting relayer monitor', {
        ethereumRpcUrl: this.config.ethereumRpcUrl,
        nearBridgeAddress: this.config.nearBridgeAddress,
        pollInterval: this.config.pollInterval
      });

      await this.performInitialHealthCheck();
      this.startHealthChecks();
      this.startNearMonitoring();

      this.logger.info('Relayer monitor started successfully');
    } catch (error) {
      this.logger.error('Failed to start relayer monitor', { error });
      throw error;
    }
  }

  private async performInitialHealthCheck(): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      
      this.logger.info('Initial health check passed', {
        chainId: network.chainId.toString(),
        blockNumber,
        bridgeAddress: this.config.nearBridgeAddress
      });

      this.lastProcessedBlock = blockNumber;
    } catch (error) {
      throw new NetworkError('Initial health check failed', { error });
    }
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Health check failed', { error });
      }
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      const timeSinceLastBlock = Date.now() - (this.lastProcessedBlock * 1000);
      
      if (timeSinceLastBlock > 60000) { // 1 minute
        this.logger.warn('No new blocks processed recently', {
          lastProcessedBlock: this.lastProcessedBlock,
          currentBlock: blockNumber,
          timeSinceLastBlock
        });
      }

      this.logger.debug('Health check passed', {
        blockNumber,
        activeTransfers: this.activeTransfers.size,
        nearMonitoringActive: this.nearMonitoringActive
      });
    } catch (error) {
      throw new NetworkError('Health check failed', { error });
    }
  }

  private startNearMonitoring(): void {
    this.nearMonitoringActive = true;
    this.pollNearBlocks().catch(error => {
      this.logger.error('NEAR monitoring failed', { error });
    });
  }

  private async pollNearBlocks(): Promise<void> {
    while (this.nearMonitoringActive && !this.isShuttingDown) {
      try {
        await this.processNearBlocks();
        await this.sleep(this.config.pollInterval);
      } catch (error) {
        this.logger.error('Error polling NEAR blocks', { error });
        await this.sleep(this.config.pollInterval * 2); // Backoff on error
      }
    }
  }

  private async processNearBlocks(): Promise<void> {
    try {
      const response = await fetch(this.config.nearRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dontcare',
          method: 'block',
          params: { finality: 'final' }
        })
      });

      const result = await response.json() as any;
      
      if (result.error) {
        throw new NetworkError('NEAR RPC error', { error: result.error });
      }

      const currentBlock = result.result.header.height;
      
      if (currentBlock > this.lastProcessedNearBlock) {
        this.logger.debug('Processing NEAR blocks', {
          fromBlock: this.lastProcessedNearBlock + 1,
          toBlock: currentBlock
        });
        
        this.lastProcessedNearBlock = currentBlock;
      }
    } catch (error) {
      if (error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError('Failed to process NEAR blocks', { error });
    }
  }

  private handleDepositInitiated(
    depositId: string,
    sender: string,
    nearRecipient: string,
    token: string,
    amount: bigint,
    fee: bigint,
    timestamp: bigint
  ): void {
    try {
      const event: DepositInitiatedEvent = {
        depositId,
        sender,
        nearRecipient,
        token,
        amount,
        fee,
        timestamp
      };

      this.logger.info('Ethereum→NEAR deposit initiated', {
        depositId: event.depositId,
        sender: event.sender,
        nearRecipient: event.nearRecipient,
        amount: ethers.formatEther(event.amount),
        fee: ethers.formatEther(event.fee)
      });

      this.activeTransfers.set(event.depositId, {
        type: 'eth-to-near',
        startTime: Date.now(),
        depositId: event.depositId,
        status: 'initiated'
      });
    } catch (error) {
      this.logger.error('Error handling DepositInitiated event', { error, depositId });
    }
  }

  private handleMessageSent(
    messageId: string,
    depositId: string,
    sender: string,
    nearRecipient: string,
    amount: bigint,
    timestamp: bigint
  ): void {
    try {
      const event: MessageSentEvent = {
        messageId,
        depositId,
        sender,
        recipient: nearRecipient,
        amount,
        timestamp
      };

      this.logger.info('Cross-chain message sent', {
        messageId: event.messageId,
        depositId: event.depositId,
        sender: event.sender,
        recipient: event.recipient,
        amount: ethers.formatEther(event.amount)
      });

      const transfer = this.activeTransfers.get(depositId);
      if (transfer) {
        transfer.status = 'processing';
        this.logger.debug('Updated transfer status', { depositId, status: 'processing' });
      }

      // Schedule NEAR order status check
      setTimeout(() => {
        this.checkNearOrderStatus(depositId).catch(error => {
          this.logger.error('Failed to check NEAR order status', { error, depositId });
        });
      }, 5000);
    } catch (error) {
      this.logger.error('Error handling MessageSent event', { error, messageId, depositId });
    }
  }

  private handleWithdrawalCompleted(
    depositId: string,
    recipient: string,
    amount: bigint,
    timestamp: bigint
  ): void {
    try {
      const event: WithdrawalCompletedEvent = {
        depositId,
        recipient,
        amount,
        timestamp
      };

      this.logger.info('Withdrawal completed', {
        depositId: event.depositId,
        recipient: event.recipient,
        amount: ethers.formatEther(event.amount),
        timestamp: new Date(Number(event.timestamp) * 1000).toISOString()
      });

      const transfer = this.activeTransfers.get(depositId);
      if (transfer) {
        transfer.status = 'completed';
        this.logger.info('Cross-chain transfer completed successfully', {
          depositId,
          duration: Date.now() - transfer.startTime,
          type: transfer.type
        });
      }
    } catch (error) {
      this.logger.error('Error handling WithdrawalCompleted event', { error, depositId });
    }
  }

  private handleNewBlock(blockNumber: number): void {
    this.lastProcessedBlock = blockNumber;
    this.logger.debug('New block processed', { blockNumber });
  }

  private async handleProviderError(error: Error): Promise<void> {
    this.logger.error('Provider error occurred', { error: error.message });
    
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.logger.info('Attempting to reconnect', { 
        attempt: this.reconnectAttempts,
        maxAttempts: this.config.maxReconnectAttempts
      });
      
      await this.sleep(1000 * this.reconnectAttempts); // Exponential backoff
      
      try {
        await this.performInitialHealthCheck();
        this.reconnectAttempts = 0;
        this.logger.info('Reconnection successful');
      } catch (reconnectError) {
        this.logger.error('Reconnection failed', { error: reconnectError });
      }
    } else {
      this.logger.error('Max reconnection attempts exceeded', {
        maxAttempts: this.config.maxReconnectAttempts
      });
      await this.gracefulShutdown('maxReconnectAttemptsExceeded');
    }
  }

  private async checkNearOrderStatus(depositId: string): Promise<void> {
    try {
      this.logger.debug('Checking NEAR order status', { depositId });
      
      const response = await fetch(this.config.nearRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dontcare',
          method: 'query',
          params: {
            request_type: 'call_function',
            finality: 'final',
            account_id: this.config.nearEscrowContract,
            method_name: 'get_escrow_details',
            args_base64: Buffer.from(JSON.stringify({ escrow_id: depositId })).toString('base64')
          }
        })
      });
      
      const result = await response.json() as any;
      
      if (result.error) {
        this.logger.warn('NEAR order not found or RPC error', { 
          depositId, 
          error: result.error.message 
        });
        return;
      }
      
      if (result.result && result.result.result) {
        try {
          const escrowData = JSON.parse(Buffer.from(result.result.result).toString());
          this.logger.info('NEAR escrow found', {
            depositId,
            status: escrowData.status,
            amount: escrowData.amount,
            recipient: escrowData.recipient
          });
        } catch (parseError) {
          this.logger.error('Failed to parse NEAR escrow data', { 
            depositId, 
            error: parseError 
          });
        }
      }
    } catch (error) {
      this.logger.error('Error checking NEAR order status', { error, depositId });
    }
  }

  private async gracefulShutdown(reason: string): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    this.logger.info('Initiating graceful shutdown', { reason });
    
    try {
      // Stop monitoring
      this.nearMonitoringActive = false;
      
      // Clear intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      
      // Remove event listeners
      this.provider.removeAllListeners();
      this.bridgeContract.removeAllListeners();
      
      // Log final statistics
      this.logger.info('Shutdown complete', {
        activeTransfers: this.activeTransfers.size,
        lastProcessedBlock: this.lastProcessedBlock,
        lastProcessedNearBlock: this.lastProcessedNearBlock
      });
      
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Enhanced configuration loading with validation
function loadConfiguration(): MonitorConfig {
  try {
    const config = {
      ethereumRpcUrl: process.env.ETHEREUM_RPC_URL,
      nearRpcUrl: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org',
      nearBridgeAddress: process.env.NEAR_BRIDGE,
      nearEscrowContract: process.env.NEAR_ESCROW_CONTRACT || 'escrow-v2.fusionswap.testnet',
      pollInterval: parseInt(process.env.POLL_INTERVAL || '5000'),
      maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '5'),
      healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
      logLevel: process.env.LOG_LEVEL || 'info'
    };

    return ConfigValidator.validateMonitorConfig(config);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Configuration validation failed:', error.details);
    } else {
      console.error('Failed to load configuration:', error);
    }
    process.exit(1);
  }
}

// Main execution with proper error handling
async function main(): Promise<void> {
  try {
    const config = loadConfiguration();
    const monitor = new RelayerMonitor(config);
    await monitor.start();
  } catch (error) {
    console.error('Failed to start relayer monitor:', error);
    process.exit(1);
  }
}

// Run the enhanced monitor
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { RelayerMonitor, ConfigValidator, MonitorConfig };
