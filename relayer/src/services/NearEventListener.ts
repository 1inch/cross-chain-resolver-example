/**
 * NEAR event listener service
 * Handles listening for and processing NEAR blockchain events
 */

import { IEventListener, NearProvider } from '../types/interfaces.js';
import { NetworkError, ErrorHandler } from '../utils/errors.js';
import { ValidationService } from './ValidationService.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

export interface NearEventListenerOptions {
  /** Poll interval in milliseconds */
  pollIntervalMs?: number;
  /**
   * Optional starting block height (inclusive) to begin processing from.
   * If provided, the listener will process events starting at this block on first poll.
   */
  startBlock?: number;
}

export interface NearEventHandlers {
  onSwapOrderCreated?: (event: SwapOrderCreatedEvent) => Promise<void>;
  onSwapOrderCompleted?: (event: SwapOrderCompletedEvent) => Promise<void>;
  onSwapOrderRefunded?: (event: SwapOrderRefundedEvent) => Promise<void>;
  onSwapOrderPartiallyFilled?: (event: SwapOrderPartiallyFilledEvent) => Promise<void>;
  onTransactionProcessed?: (event: TransactionProcessedEvent) => Promise<void>;
}

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

export interface SwapOrderRefundedEvent {
  orderId: string;
  reason: string;
  blockHeight: number;
  transactionHash: string;
  secretHash?: string; // Optional for cross-chain refunds
}

export interface SwapOrderPartiallyFilledEvent {
  orderId: string;
  filledAmount: string;
  remainingAmount: string;
  fillCount: number;
  blockHeight: number;
  transactionHash: string;
  secretHash?: string; // Optional for cross-chain partial fills
}

export interface TransactionProcessedEvent {
  transactionHash: string;
  signerId: string;
  receiverId: string;
  methodName: string;
  args: any;
  blockHeight: number;
  logs: string[];
}

export class NearEventListener implements IEventListener {
  private readonly provider: NearProvider;
  private readonly escrowContractId: string;
  private readonly handlers: NearEventHandlers;
  private readonly validator: ValidationService;
  private _isRunning = false;
  private readonly pollInterval: number;
  private pollTimer?: NodeJS.Timeout;
  private lastProcessedBlock = 0;
  private readonly processedBlocks: Set<number> = new Set();
  private readonly configuredStartBlock?: number;

  constructor(
    provider: NearProvider,
    escrowContractId: string,
    handlers: NearEventHandlers,
    optionsOrPollInterval: number | NearEventListenerOptions = 5000
  ) {
    this.validateConstructorParams(provider, escrowContractId, handlers);
    
    this.provider = provider;
    this.escrowContractId = escrowContractId;
    this.handlers = handlers;
    if (typeof optionsOrPollInterval === 'number') {
      this.pollInterval = optionsOrPollInterval;
    } else {
      this.pollInterval = optionsOrPollInterval.pollIntervalMs ?? 5000;
      this.configuredStartBlock = optionsOrPollInterval.startBlock;
    }
    this.validator = new ValidationService();
  }

  /**
   * Start the event listener
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      logger.warn('NearEventListener is already running');
      return;
    }

    try {
      // Determine starting point
      let effectiveStartBlock: number;
      if (this.configuredStartBlock !== undefined) {
        effectiveStartBlock = this.configuredStartBlock;
      } else {
        const status = await withRetry(() => this.provider.status());
        effectiveStartBlock = status.sync_info.latest_block_height;
      }
      // We track lastProcessedBlock as the block before the first block we want to process
      this.lastProcessedBlock = Math.max(0, effectiveStartBlock - 1);
      
      logger.info('Starting NEAR event listener', {
        escrowContractId: this.escrowContractId,
        startBlock: effectiveStartBlock,
        pollInterval: this.pollInterval
      });

      this._isRunning = true;
      this.scheduleNextPoll();

      logger.info('NEAR event listener started successfully');
    } catch (error) {
      throw new NetworkError(
        'Failed to start NEAR event listener',
        'near',
        'start',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Stop the event listener
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping NEAR event listener');
    
    this._isRunning = false;
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    logger.info('NEAR event listener stopped');
  }

  /**
   * Check if the listener is running
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get the last processed block height
   */
  getLastProcessedBlock(): number {
    return this.lastProcessedBlock;
  }

  // Private methods

  private validateConstructorParams(
    provider: NearProvider,
    escrowContractId: string,
    handlers: NearEventHandlers
  ): void {
    if (!provider) {
      throw ErrorHandler.createValidationError('provider', provider, 'NEAR provider is required');
    }

    if (!escrowContractId || typeof escrowContractId !== 'string') {
      throw ErrorHandler.createValidationError('escrowContractId', escrowContractId, 'Escrow contract ID must be a non-empty string');
    }

    // Validate NEAR account ID format
    try {
      const validator = new ValidationService();
      validator.validateNearAccountId(escrowContractId);
    } catch (error) {
      throw ErrorHandler.createValidationError('escrowContractId', escrowContractId, 'Invalid NEAR account ID format');
    }

    if (!handlers || typeof handlers !== 'object') {
      throw ErrorHandler.createValidationError('handlers', handlers, 'Event handlers object is required');
    }
    
    // Ensure at least one handler is defined
    const hasAtLeastOneHandler = [
      'onSwapOrderCreated',
      'onSwapOrderCompleted',
      'onSwapOrderRefunded',
      'onTransactionProcessed'
    ].some(handler => typeof handlers[handler as keyof NearEventHandlers] === 'function');
    
    if (!hasAtLeastOneHandler) {
      throw ErrorHandler.createValidationError('handlers', handlers, 'At least one event handler must be provided');
    }
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) {
      return;
    }

    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollForEvents();
      } catch (error) {
        ErrorHandler.handle(error as Error, 'NearEventListener.pollForEvents');
      } finally {
        this.scheduleNextPoll();
      }
    }, this.pollInterval);
  }

  private async pollForEvents(): Promise<void> {
    try {
      const status = await withRetry(() => this.provider.status());
      const currentBlock = status.sync_info.latest_block_height;
      
      if (currentBlock <= this.lastProcessedBlock) {
        return; // No new blocks
      }

      const fromBlock = this.lastProcessedBlock + 1;
      const toBlock = Math.min(currentBlock, fromBlock + 10); // Process max 10 blocks at once

      logger.debug('Polling for NEAR events', {
        fromBlock,
        toBlock,
        blocksToProcess: toBlock - fromBlock + 1
      });

      // Process blocks sequentially to maintain order
      for (let blockHeight = fromBlock; blockHeight <= toBlock; blockHeight++) {
        if (!this.processedBlocks.has(blockHeight)) {
          await this.processBlock(blockHeight);
          this.processedBlocks.add(blockHeight);
        }
      }

      this.lastProcessedBlock = toBlock;

      // Clean up old processed blocks (keep last 1000)
      if (this.processedBlocks.size > 1000) {
        const sortedBlocks = Array.from(this.processedBlocks).sort((a, b) => a - b);
        const toRemove = sortedBlocks.slice(0, sortedBlocks.length - 1000);
        toRemove.forEach(block => this.processedBlocks.delete(block));
      }

      if (toBlock < currentBlock) {
        // More blocks to process, schedule immediate next poll
        setImmediate(() => this.pollForEvents());
      }
    } catch (error) {
      throw new NetworkError(
        'Failed to poll for NEAR events',
        'near',
        'pollEvents',
        { 
          lastProcessedBlock: this.lastProcessedBlock,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  private async processBlock(blockHeight: number): Promise<void> {
    try {
      logger.debug('Processing NEAR block', { blockHeight });

      const block = await withRetry(() => this.provider.block({ blockId: blockHeight }));
      
      if (!block.chunks || block.chunks.length === 0) {
        logger.debug('No chunks in block', { blockHeight });
        return;
      }

      // Process each chunk in the block
      for (const chunkInfo of block.chunks) {
        if (chunkInfo.chunk_hash) {
          await this.processChunk(chunkInfo.chunk_hash, blockHeight);
        }
      }

      logger.debug('Processed NEAR block successfully', { blockHeight });
    } catch (error) {
      // Log error but don't throw - continue processing other blocks
      ErrorHandler.handle(error as Error, `NearEventListener.processBlock(${blockHeight})`);
    }
  }

  private async processChunk(chunkHash: string, blockHeight: number): Promise<void> {
    try {
      const chunk = await withRetry(() => this.provider.chunk(chunkHash));
      
      if (!chunk.transactions || chunk.transactions.length === 0) {
        return; // No transactions in chunk
      }

      // Process transactions that involve our escrow contract
      for (const tx of chunk.transactions) {
        if (this.isRelevantTransaction(tx)) {
          await this.processTransaction(tx, blockHeight);
        }
      }

      // Process receipts if available
      if (chunk.receipts) {
        for (const receipt of chunk.receipts) {
          await this.processReceipt(receipt, blockHeight);
        }
      }
    } catch (error) {
      // Log error but continue processing - chunk might be missing temporarily
      logger.debug('Failed to process chunk', { 
        chunkHash, 
        blockHeight,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private isRelevantTransaction(tx: any): boolean {
    // Check if transaction involves our escrow contract
    // Include transactions TO the escrow contract (function calls)
    return tx.receiver_id === this.escrowContractId;
  }

  private async processTransaction(tx: any, blockHeight: number): Promise<void> {
    try {
      logger.info('🔍 Processing relevant NEAR transaction', {
        txHash: tx.hash,
        signer: tx.signer_id,
        receiver: tx.receiver_id,
        blockHeight
      });
      
      // Get full transaction status to access logs and outcomes
      const txStatus = await withRetry(() => this.provider.txStatus(tx.hash, tx.signer_id));
      
      if (!txStatus.receipts_outcome) {
        return;
      }

      // Extract logs and method calls from transaction outcomes
      const logs: string[] = [];
      let methodName = '';
      let args: any = {};

      for (const outcome of txStatus.receipts_outcome) {
        if (outcome.outcome.logs) {
          logs.push(...outcome.outcome.logs);
        }

        // Try to extract method name and args from logs or other sources
        // This is a simplified approach - real implementation might need more sophisticated parsing
        if (outcome.outcome.status && 'SuccessValue' in outcome.outcome.status) {
          // Transaction succeeded, parse logs for events
          await this.parseLogsForEvents(logs, tx.hash, blockHeight);
        }
      }

      // Emit transaction processed event
      if (this.handlers.onTransactionProcessed) {
        const event: TransactionProcessedEvent = {
          transactionHash: tx.hash,
          signerId: tx.signer_id,
          receiverId: tx.receiver_id || '',
          methodName,
          args,
          blockHeight,
          logs
        };

        await this.safeHandleEvent('TransactionProcessed', () =>
          this.handlers.onTransactionProcessed!(event)
        );
      }
    } catch (error) {
      logger.debug('Failed to process transaction', {
        txHash: tx.hash,
        blockHeight,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async processReceipt(receipt: any, blockHeight: number): Promise<void> {
    try {
      if (receipt.outcome && receipt.outcome.logs) {
        await this.parseLogsForEvents(receipt.outcome.logs, 'receipt', blockHeight);
      }
    } catch (error) {
      logger.debug('Failed to process receipt', {
        blockHeight,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async parseLogsForEvents(logs: string[], txHash: string, blockHeight: number): Promise<void> {
    for (const log of logs) {
      try {
        // Try to parse log as JSON event
        if (log.startsWith('EVENT_JSON:')) {
          const eventData = JSON.parse(log.substring(11));
          await this.handleParsedEvent(eventData, txHash, blockHeight);
        } else {
          // Handle plain text logs that might contain event information
          await this.handleTextLog(log, txHash, blockHeight);
        }
      } catch (error) {
        // Log parsing failed, continue with next log
        logger.debug('Failed to parse log', {
          log: log.substring(0, 100) + '...', // Truncate for logging
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async handleParsedEvent(eventData: any, txHash: string, blockHeight: number): Promise<void> {
    try {
      switch (eventData.event) {
        case 'swap_order_created':
          if (this.handlers.onSwapOrderCreated) {
            const event: SwapOrderCreatedEvent = {
              orderId: eventData.data.order_id,
              initiator: eventData.data.initiator,
              recipient: eventData.data.recipient,
              amount: eventData.data.amount,
              secretHash: eventData.data.secret_hash,
              timelock: eventData.data.timelock,
              blockHeight,
              transactionHash: txHash
            };
            
            await this.safeHandleEvent('SwapOrderCreated', () =>
              this.handlers.onSwapOrderCreated!(event)
            );
          }
          break;

        case 'swap_order_completed':
          if (this.handlers.onSwapOrderCompleted) {
            const event: SwapOrderCompletedEvent = {
              orderId: eventData.data.order_id,
              secret: eventData.data.secret,
              blockHeight,
              transactionHash: txHash
            };
            
            await this.safeHandleEvent('SwapOrderCompleted', () =>
              this.handlers.onSwapOrderCompleted!(event)
            );
          }
          break;

        case 'swap_order_refunded':
          if (this.handlers.onSwapOrderRefunded) {
            const event: SwapOrderRefundedEvent = {
              orderId: eventData.data.order_id,
              reason: eventData.data.reason || 'Timeout',
              blockHeight,
              transactionHash: txHash
            };
            
            await this.safeHandleEvent('SwapOrderRefunded', () =>
              this.handlers.onSwapOrderRefunded!(event)
            );
          }
          break;

        default:
          logger.debug('Unknown event type', { eventType: eventData.event, txHash });
      }
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearEventListener.handleParsedEvent');
    }
  }

  private async handleTextLog(log: string, txHash: string, blockHeight: number): Promise<void> {
    // Handle plain text logs that might contain event information
    
    if (log.includes('Created swap order')) {
      logger.info('\n🎉 ===============================================');
      logger.info('🎯 SWAP ORDER DETECTED IN LIVE DEMO!');
      logger.info('🎉 ===============================================');
      logger.info('📝 Log Details:', { log, txHash, blockHeight });
      
      // Parse order details from log: "Created swap order order_46 for 2000000000000000000000 yoctoNEAR to recipient 0x..."
      const orderMatch = log.match(/Created swap order (\w+) for (\d+) yoctoNEAR to recipient (0x[a-fA-F0-9]{40})/);
      if (orderMatch) {
        const [, orderId, amount, recipient] = orderMatch;
        
        logger.info('🔍 Parsed Order Details:', {
          orderId,
          amount,
          recipient,
          blockHeight,
          txHash
        });
        
        let secretHash = '';
        let timelock = 0;
        let initiator = '';
        
        try {
          logger.info('📋 Fetching order details from contract...', { orderId });
          const orderDetails = await (this.provider as any).query({
            request_type: 'call_function',
            finality: 'final',
            account_id: this.escrowContractId,
            method_name: 'get_order',
            args_base64: Buffer.from(JSON.stringify({ order_id: orderId })).toString('base64')
          });
          
          if (orderDetails && 'result' in orderDetails) {
            const resultBytes = orderDetails.result as number[];
            const resultString = String.fromCharCode(...resultBytes);
            const orderData = JSON.parse(resultString);
            
            secretHash = orderData.hashlock || '';
            timelock = orderData.timelock || 0;
            initiator = orderData.initiator || '';
            
            logger.info('✅ Contract state fetched successfully:', {
              orderId,
              secretHash: secretHash.substring(0, 10) + '...',
              timelock,
              initiator
            });
          }
        } catch (error) {
          logger.warn('⚠️ Failed to fetch order details from contract:', {
            orderId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
        const event: SwapOrderCreatedEvent = {
          orderId,
          initiator,
          recipient,
          amount,
          secretHash,
          timelock,
          blockHeight,
          transactionHash: txHash
        };
        
        // Trigger the swap order created handler
        if (this.handlers.onSwapOrderCreated) {
          await this.safeHandleEvent('SwapOrderCreated', () =>
            this.handlers.onSwapOrderCreated!(event)
          );
        }
      }
    } else if (log.includes('swap_order_completed') || log.includes('Completed swap order')) {
      logger.info('🎯 DETECTED SWAP ORDER COMPLETION!', { log, txHash, blockHeight });
    } else if (log.includes('swap_order_refunded') || log.includes('Refunded swap order')) {
      logger.info('🎯 DETECTED SWAP ORDER REFUND!', { log, txHash, blockHeight });
    }
  }

  private async safeHandleEvent(eventType: string, handler: () => Promise<void>): Promise<void> {
    try {
      await handler();
    } catch (error) {
      ErrorHandler.handle(error as Error, `NearEventListener.${eventType}Handler`);
      // Continue processing other events even if one fails
    }
  }
}
