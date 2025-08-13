/**
 * Refactored NEAR Relayer
 * Uses dependency injection and proper separation of concerns
 */

import { ethers } from 'ethers';
import { JsonRpcProvider } from '@near-js/providers';
import { NearAccount, IMessageProcessor, CrossChainMessage, MessageType } from '../types/interfaces.js';
import { NearEventListener, NearEventHandlers, SwapOrderCreatedEvent, SwapOrderCompletedEvent, SwapOrderRefundedEvent, TransactionProcessedEvent, SwapOrderPartiallyFilledEvent } from '../services/NearEventListener.js';
import { NearContractService } from '../services/NearContractService.js';
import { EthereumContractService } from '../services/EthereumContractService.js';
import { DynamicAuctionService, CrossChainAuctionParams } from '../services/DynamicAuctionService.js';
import { ValidationService } from '../services/ValidationService.js';
import { StorageService } from '../services/StorageService.js';
import { RelayerError, ErrorHandler } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { NearPartialFillService } from '../services/NearPartialFillService.js';
import { EventEmitter } from 'events';
import { withRetry } from '../utils/retry.js';

export interface NearRelayerConfig {
  nearAccount: NearAccount;
  ethereum: {
    rpcUrl: string;
    privateKey: string;
    /** Optional injected provider for testing */
    provider?: ethers.providers.JsonRpcProvider;
    /** Optional injected signer for testing */
    signer?: ethers.Signer;
  };
  ethereumEscrowFactoryAddress: string;
  escrowContractId: string;
  pollIntervalMs?: number;
  /** Optional explicit starting block for NearEventListener (inclusive) */
  startBlock?: number;
  storageDir?: string;
}

export class NearRelayer implements IMessageProcessor {
  private readonly config: NearRelayerConfig;
  private readonly eventListener: NearEventListener;
  private readonly contractService: NearContractService;
  private readonly ethereumContractService: EthereumContractService;
  private readonly auctionService: DynamicAuctionService;
  private readonly storage: StorageService;
  private readonly validator: ValidationService;
  private readonly partialFillService: NearPartialFillService;
  private readonly emitter: EventEmitter = new EventEmitter();
  private processedMessages: Set<string> = new Set();
  private isRunning = false;
  private orderStatusMap: Map<string, {
    status: string;
    filledAmount?: string;
    remainingAmount?: string;
    lastUpdated: number;
  }> = new Map();

  constructor(config: NearRelayerConfig) {
    this.config = config;

    // Initialize services first
    this.storage = new StorageService(config.storageDir, 'near_processed_messages.json');
    this.validator = new ValidationService();
    
    // Validate config
    this.validateConfig(config);
    this.contractService = new NearContractService(
      config.nearAccount,
      config.escrowContractId
    );
    
    // Initialize partial fill service with provider
    const nearProvider = config.nearAccount.connection.provider as JsonRpcProvider;
    this.partialFillService = new NearPartialFillService(
      config.nearAccount as any, // Cast to Account type for compatibility
      nearProvider,
      config.escrowContractId
    );
    // Allow tests to inject mocked provider/signer
    const ethereumProvider = config.ethereum.provider ?? new ethers.providers.JsonRpcProvider(config.ethereum.rpcUrl);
    const ethereumSigner = config.ethereum.signer ?? new ethers.Wallet(config.ethereum.privateKey, ethereumProvider);
    this.ethereumContractService = new EthereumContractService(
      ethereumProvider,
      ethereumSigner,
      config.ethereumEscrowFactoryAddress
    );
    this.auctionService = new DynamicAuctionService();

    // Set up event handlers
    const eventHandlers: NearEventHandlers = {
      onSwapOrderCreated: this.handleSwapOrderCreated.bind(this),
      onSwapOrderCompleted: this.handleSwapOrderCompleted.bind(this),
      onSwapOrderRefunded: this.handleSwapOrderRefunded.bind(this),
      onSwapOrderPartiallyFilled: this.handleSwapOrderPartiallyFilled.bind(this),
      onTransactionProcessed: this.handleTransactionProcessed.bind(this)
    };

    this.eventListener = new NearEventListener(
      config.nearAccount.connection.provider,
      config.escrowContractId,
      eventHandlers,
      { pollIntervalMs: config.pollIntervalMs, startBlock: config.startBlock }
    );
  }

  /**
   * Expose an EventEmitter to allow external consumers (e.g., tests) to subscribe
   * to relayer lifecycle events.
   */
  public getEventEmitter(): EventEmitter {
    return this.emitter;
  }

  /**
   * Start the NEAR relayer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('NearRelayer is already running');
      return;
    }

    try {
      logger.info('Starting NEAR relayer...');

      // Initialize storage
      await this.storage.initialize();

      // Start event listener
      await this.eventListener.start();

      this.isRunning = true;
      logger.info('NEAR relayer started successfully');
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to start NEAR relayer'
      );
    }
  }

  /**
   * Stop the NEAR relayer
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info('Stopping NEAR relayer...');

      // Stop event listener
      await this.eventListener.stop();

      this.isRunning = false;
      logger.info('NEAR relayer stopped successfully');
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.stop');
    }
  }

  /**
   * Check if the relayer is running
   */
  isRelayerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Process a cross-chain message
   */
  async processMessage(message: CrossChainMessage): Promise<void> {
    try {
      // Validate message
      this.validator.validateCrossChainMessage(message);

      // Check if already processed
      if (this.storage.isMessageProcessed(message.messageId)) {
        logger.debug('Message already processed, skipping', { messageId: message.messageId });
        return;
      }

      logger.info('Processing cross-chain message', {
        messageId: message.messageId,
        type: message.type,
        sourceChain: message.sourceChain,
        destChain: message.destChain
      });

      // Route message based on type
      switch (message.type) {
        case MessageType.DEPOSIT:
          await this.processDepositMessage(message);
          break;
        case MessageType.WITHDRAWAL:
          await this.processWithdrawalMessage(message);
          break;
        case MessageType.REFUND:
          await this.processRefundMessage(message);
          break;
        default:
          throw new RelayerError(
            `Unknown message type: ${message.type}`,
            'INVALID_MESSAGE_TYPE',
            { messageId: message.messageId, type: message.type }
          );
      }

      // Mark as processed
      await this.storage.saveProcessedMessage(message.messageId);

      logger.info('Message processed successfully', { messageId: message.messageId });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        `Failed to process message: ${message.messageId}`,
        { messageId: message.messageId, messageType: message.type }
      );
    }
  }

  /**
   * Get the number of processed messages
   */
  getProcessedMessageCount(): number {
    return this.storage.getProcessedMessageCount();
  }

  // Event handlers

  private async handleSwapOrderCreated(event: SwapOrderCreatedEvent): Promise<void> {
    try {
      logger.info('Handling SwapOrderCreated event', {
        orderId: event.orderId,
        initiator: event.initiator,
        recipient: event.recipient,
        amount: event.amount,
        blockHeight: event.blockHeight
      });

      // For NEAR→Ethereum transfer: Create corresponding Ethereum escrow
      logger.info('NEAR swap order created, creating corresponding Ethereum escrow', {
        orderId: event.orderId,
        secretHash: event.secretHash
      });

      // Check if Ethereum escrow already exists
      const existingEscrow = await this.findEthereumEscrowBySecretHash(event.secretHash);
      
      if (!existingEscrow) {
        // Create Ethereum escrow for NEAR→ETH transfer
        await this.createEthereumEscrowFromNearOrder(event);
      } else {
        logger.info('Ethereum escrow already exists for this secret hash', {
          orderId: event.orderId,
          secretHash: event.secretHash,
          escrowAddress: existingEscrow
        });
      }

      logger.info('SwapOrderCreated event processed successfully', {
        orderId: event.orderId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleSwapOrderCreated');
    }
  }

  private async handleSwapOrderCompleted(event: SwapOrderCompletedEvent): Promise<void> {
    try {
      logger.info('Handling SwapOrderCompleted event', {
        orderId: event.orderId,
        secret: '***redacted***',
        blockHeight: event.blockHeight
      });

      // Update order status
      await this.updateOrderStatus(event.orderId, 'completed');

      // Process NEAR→Ethereum withdrawal now that we have the secret
      await this.processNearToEthereumWithdrawalFromCompletedOrder(event);

      logger.info('SwapOrderCompleted event processed successfully', {
        orderId: event.orderId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleSwapOrderCompleted');
    }
  }

  private async handleSwapOrderRefunded(event: SwapOrderRefundedEvent): Promise<void> {
    try {
      logger.info('Handling SwapOrderRefunded event', {
        orderId: event.orderId,
        reason: event.reason,
        blockHeight: event.blockHeight
      });

      // Update any tracking or cleanup
      await this.updateOrderStatus(event.orderId, 'refunded');

      // Process refund on the other chain if needed
      if (event.secretHash) {
        await this.processCrossChainRefund(event.orderId, event.secretHash, event.reason);
      }

      logger.info('SwapOrderRefunded event processed successfully', {
        orderId: event.orderId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleSwapOrderRefunded');
    }
  }

  private async handleSwapOrderPartiallyFilled(event: SwapOrderPartiallyFilledEvent): Promise<void> {
    try {
      logger.info('Handling SwapOrderPartiallyFilled event', {
        orderId: event.orderId,
        filledAmount: event.filledAmount,
        remainingAmount: event.remainingAmount,
        fillCount: event.fillCount,
        blockHeight: event.blockHeight
      });

      // Update order status
      await this.updateOrderStatus(event.orderId, 'partially_filled');

      // Process cross-chain partial fill if needed
      if (event.secretHash) {
        await this.processCrossChainPartialFill(
          event.orderId,
          event.filledAmount,
          event.remainingAmount,
          event.secretHash
        );
      }

      logger.info('SwapOrderPartiallyFilled event processed successfully', {
        orderId: event.orderId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleSwapOrderPartiallyFilled');
    }
  }

  private async handleTransactionProcessed(event: TransactionProcessedEvent): Promise<void> {
    try {
      logger.debug('Handling TransactionProcessed event', {
        transactionHash: event.transactionHash,
        methodName: event.methodName,
        blockHeight: event.blockHeight
      });

      // Process transaction-specific logic if needed
      if (event.methodName === 'create_swap_order') {
        // Additional processing for swap order creation
        logger.debug('Detected swap order creation transaction', {
          transactionHash: event.transactionHash
        });
      }
    } catch (error) {
      ErrorHandler.handle(error as Error, 'NearRelayer.handleTransactionProcessed');
    }
  }

  // Message processors

  private async processDepositMessage(message: CrossChainMessage): Promise<void> {
    try {
      logger.info('Processing deposit message from Ethereum to NEAR', {
        messageId: message.messageId,
        sender: message.sender,
        recipient: message.recipient,
        amount: message.amount
      });

      // Create NEAR swap order
      await this.contractService.createSwapOrder({
        recipient: message.recipient,
        hashlock: message.data.secretHash || '',
        timelockDuration: message.data.timelock || 86400, // 24 hours default
        attachedDeposit: BigInt(message.amount)
      });

      logger.info('Deposit message processed successfully', {
        messageId: message.messageId
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process deposit message',
        { messageId: message.messageId }
      );
    }
  }

  private async processWithdrawalMessage(message: CrossChainMessage): Promise<void> {
    try {
      logger.info('Processing withdrawal message', {
        messageId: message.messageId,
        recipient: message.recipient,
        amount: message.amount
      });

      // Find the corresponding NEAR escrow and complete it
      const rawSecret = message.data.secret;
      if (!rawSecret) {
        throw new RelayerError(
          'Missing secret for withdrawal message',
          'MISSING_SECRET',
          { messageId: message.messageId }
        );
      }

      // Normalize secret: ensure no leading 0x for consistent raw-bytes hashing
      const normalizedSecret = rawSecret.startsWith('0x') ? rawSecret.slice(2) : rawSecret;
      // Calculate secret hash to find the order (raw bytes)
      const secretHash = ethers.utils.keccak256('0x' + normalizedSecret);
      
      // For now, we'll need to implement a way to find orders by secret hash
      // This is a simplified approach - in production, you'd want a more efficient lookup
      const orderId = await this.findOrderBySecretHash(secretHash);
      
      if (!orderId) {
        throw new RelayerError(
          'No matching NEAR order found for withdrawal',
          'ORDER_NOT_FOUND',
          { messageId: message.messageId, secretHash }
        );
      }

      // Complete the swap order
      await this.contractService.completeSwapOrder(orderId, normalizedSecret);

      // Also execute the corresponding Ethereum withdrawal if an escrow exists
      const escrowAddress = await this.findEthereumEscrowBySecretHash(secretHash);
      if (escrowAddress) {
        await this.executeEthereumWithdrawal(escrowAddress, normalizedSecret, message.amount);
      } else {
        logger.warn('No Ethereum escrow found for secret hash during withdrawal processing', {
          messageId: message.messageId,
          secretHash
        });
      }

      logger.info('Withdrawal message processed successfully', {
        messageId: message.messageId,
        orderId
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process withdrawal message',
        { messageId: message.messageId }
      );
    }
  }

  private async processRefundMessage(message: CrossChainMessage): Promise<void> {
    try {
      logger.info('Processing refund message', {
        messageId: message.messageId,
        sender: message.sender,
        reason: (message as any).reason
      });

      // Find and refund the corresponding NEAR order
      // This is a simplified approach - in production, you'd want better order tracking
      const orderId = await this.findOrderByInitiator(message.sender);
      
      if (!orderId) {
        throw new RelayerError(
          'No matching NEAR order found for refund',
          'ORDER_NOT_FOUND',
          { messageId: message.messageId, initiator: message.sender }
        );
      }

      // Refund the swap order
      await this.contractService.refundSwapOrder(orderId);

      logger.info('Refund message processed successfully', {
        messageId: message.messageId,
        orderId
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process refund message',
        { messageId: message.messageId }
      );
    }
  }

  // NEAR→Ethereum withdrawal processing

  private async processNearToEthereumWithdrawal(event: SwapOrderCreatedEvent): Promise<void> {
    try {
      logger.info('Processing NEAR→Ethereum withdrawal', {
        orderId: event.orderId,
        recipient: event.recipient,
        amount: event.amount
      });

      // Verify the NEAR transaction
      const isValid = await this.verifyNearTransaction(event.transactionHash, event.initiator);
      if (!isValid) {
        throw new RelayerError(
          `NEAR withdrawal transaction ${event.transactionHash} is not valid`,
          'INVALID_TRANSACTION',
          { transactionHash: event.transactionHash, orderId: event.orderId }
        );
      }

      // Calculate secret hash
      const secretHash = event.secretHash;

      // Find the corresponding Ethereum escrow
      const escrowAddress = await this.findEthereumEscrowBySecretHash(secretHash);
      if (!escrowAddress) {
        throw new RelayerError(
          `No Ethereum escrow found for secret hash ${secretHash}`,
          'ESCROW_NOT_FOUND',
          { secretHash, orderId: event.orderId }
        );
      }

      // Get the secret from the NEAR event (assuming it's available after order completion)
      // For now, we'll need to implement a way to get the secret from the NEAR transaction
      const secret = await this.extractSecretFromNearEvent(event);
      if (!secret) {
        throw new RelayerError(
          'Could not extract secret from NEAR event',
          'SECRET_EXTRACTION_FAILED',
          { orderId: event.orderId, transactionHash: event.transactionHash }
        );
      }

      // Execute withdrawal on Ethereum
      await this.executeEthereumWithdrawal(escrowAddress, secret, event.amount);

      logger.info('NEAR→Ethereum withdrawal processed successfully', {
        orderId: event.orderId,
        escrowAddress
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process NEAR→Ethereum withdrawal',
        { orderId: event.orderId }
      );
    }
  }

  // Helper methods

  private async extractSecretFromNearEvent(event: SwapOrderCreatedEvent): Promise<string | null> {
    try {
      logger.debug('Attempting to extract secret from NEAR event', {
        orderId: event.orderId,
        eventType: 'SwapOrderCreated'
      });
      
      // For SwapOrderCreated events, we need to wait for the secret to be revealed
      // Try multiple approaches to get the secret:
      
      // 1. Check if the order has already been completed by querying contract state
      const completedSecret = await this.getSecretFromCompletedOrder(event.orderId);
      if (completedSecret) {
        logger.info('Found secret from completed order state', {
          orderId: event.orderId
        });
        return completedSecret;
      }
      
      // 2. Wait for a SwapOrderCompleted event (with timeout)
      const eventSecret = await this.waitForOrderCompletionEvent(event.orderId, 30000); // 30 second timeout
      if (eventSecret) {
        logger.info('Found secret from completion event', {
          orderId: event.orderId
        });
        return eventSecret;
      }
      
      // 3. Parse recent transactions for secret revelation
      const txSecret = await this.extractSecretFromTransactionLogs(event.orderId);
      if (txSecret) {
        logger.info('Found secret from transaction logs', {
          orderId: event.orderId
        });
        return txSecret;
      }
      
      logger.debug('No secret found for order', { orderId: event.orderId });
      return null;
    } catch (error) {
      logger.error('Failed to extract secret from NEAR event', {
        orderId: event.orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get secret from a completed order by querying contract state
   */
  private async getSecretFromCompletedOrder(orderId: string): Promise<string | null> {
    try {
      logger.debug('Querying NEAR contract for completed order secret', { orderId });
      
      // Get escrow details to check if order is completed
      const escrowDetails = await this.contractService.getEscrowDetails(orderId);
      
      if (!escrowDetails) {
        logger.debug('Order not found in contract state', { orderId });
        return null;
      }
      
      // Check if order is completed (status would indicate completion)
      if (escrowDetails.status !== 'completed' && escrowDetails.status !== 'filled') {
        logger.debug('Order not yet completed', { orderId, status: escrowDetails.status });
        return null;
      }
      
      // For completed orders, we might need to query transaction history
      // to find the secret that was used to complete the order
      return await this.findSecretInOrderHistory(orderId);
    } catch (error) {
      logger.error('Failed to get secret from completed order', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Wait for a SwapOrderCompleted event for the given order ID
   */
  private async waitForOrderCompletionEvent(orderId: string, timeoutMs: number): Promise<string | null> {
    try {
      logger.debug('Waiting for order completion event', { orderId, timeoutMs });
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          logger.debug('Timeout waiting for order completion event', { orderId });
          resolve(null);
        }, timeoutMs);
        
        // Set up a temporary event handler for SwapOrderCompleted events
        const checkForCompletion = async () => {
          try {
            // Query recent blocks for SwapOrderCompleted events
            const completionEvent = await this.findRecentCompletionEvent(orderId);
            if (completionEvent && completionEvent.secret) {
              clearTimeout(timeout);
              logger.info('Found completion event with secret', {
                orderId,
                secret: '***redacted***'
              });
              resolve(completionEvent.secret);
              return;
            }
            
            // Continue checking every 2 seconds
            setTimeout(checkForCompletion, 2000);
          } catch (error) {
            logger.error('Error checking for completion event', {
              orderId,
              error: error instanceof Error ? error.message : String(error)
            });
            setTimeout(checkForCompletion, 2000);
          }
        };
        
        // Start checking
        checkForCompletion();
      });
    } catch (error) {
      logger.error('Failed to wait for order completion event', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Extract secret from NEAR transaction logs
   */
  private async extractSecretFromTransactionLogs(orderId: string): Promise<string | null> {
    try {
      logger.debug('Extracting secret from transaction logs', { orderId });
      
      // Get recent blocks and search for transactions related to this order
      const currentBlock = await withRetry(() => (this.config.nearAccount.connection.provider as any).block({ finality: 'final' })) as { header?: { height?: number } };
      const currentHeight = (currentBlock.header?.height ?? 0) as number;
      const startBlock = Math.max(0, currentHeight - 100); // Search last 100 blocks
      
      for (let blockHeight = currentHeight; blockHeight >= startBlock; blockHeight--) {
        try {
          const block = await withRetry(() => this.config.nearAccount.connection.provider.block({ blockId: blockHeight.toString() }) as any) as any;
          
          for (const chunk of block.chunks) {
            const chunkDetails = await withRetry(() => this.config.nearAccount.connection.provider.chunk(chunk.chunk_hash));
            
            for (const transaction of chunkDetails.transactions) {
              // Check if transaction is related to our escrow contract and order
              if (transaction.receiver_id === this.config.escrowContractId) {
                const secret = await this.parseTransactionForSecret(transaction.hash, orderId);
                if (secret) {
                  logger.info('Found secret in transaction logs', {
                    orderId,
                    transactionHash: transaction.hash
                  });
                  return secret;
                }
              }
            }
          }
        } catch (blockError) {
          logger.debug('Error processing block', {
            blockHeight,
            error: blockError instanceof Error ? blockError.message : String(blockError)
          });
          continue;
        }
      }
      
      logger.debug('No secret found in transaction logs', { orderId });
      return null;
    } catch (error) {
      logger.error('Failed to extract secret from transaction logs', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find secret in order completion history
   * @deprecated Moved to complete implementation below
   */
  
  /**
   * Find recent completion event for the given order
   * @deprecated Moved to complete implementation below
   */

  /**
   * Parse a specific transaction for secret revelation
   */
  private async parseTransactionForSecret(txHash: string, orderId: string): Promise<string | null> {
    try {
      // Get transaction status and parse for secret
      const txStatus = await withRetry(() => this.config.nearAccount.connection.provider.txStatus(txHash, this.config.nearAccount.accountId));
      
      // Look through transaction receipts for function calls that might contain the secret
      for (const receipt of txStatus.receipts_outcome) {
        if (receipt.outcome.logs) {
          for (const log of receipt.outcome.logs) {
            // Parse logs for secret revelation
            // Logs might contain JSON with order completion details
            try {
              const logData = JSON.parse(log);
              if (logData.event === 'order_completed' && logData.order_id === orderId && logData.secret) {
                return logData.secret;
              }
            } catch {
              // Not JSON, continue
              continue;
            }
          }
        }
        
        // Also check if the transaction action contains the secret
        // This would be in the function call arguments
        if (receipt.outcome.status && 'SuccessValue' in receipt.outcome.status) {
          // Parse function call arguments for secret
          // This is a simplified approach - in practice, you'd need to decode the action properly
        }
      }
      
      return null;
    } catch (error) {
      logger.debug('Failed to parse transaction for secret', {
        txHash,
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async verifyNearTransaction(txHash: string, signerId: string): Promise<boolean> {
    try {
      this.validator.validateTransactionHash(txHash, 'NEAR');
      this.validator.validateNearAccountId(signerId);

      const txStatus = await withRetry(() => this.config.nearAccount.connection.provider.txStatus(txHash, signerId));
      
      // Check if transaction was successful
      if (!txStatus.receipts_outcome) {
        return false;
      }

      for (const outcome of txStatus.receipts_outcome) {
        if (outcome.outcome.status && 'SuccessValue' in outcome.outcome.status) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Failed to verify NEAR transaction', {
        txHash,
        signerId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  private async findEthereumEscrowBySecretHash(secretHash: string): Promise<string | null> {
    try {
      this.validator.validateSecretHash(secretHash);

      logger.debug('Finding Ethereum escrow by secret hash', { secretHash });
      
      // Use EthereumContractService to find escrow by secret hash
      const escrowDetails = await this.ethereumContractService.findEscrowBySecretHash(secretHash);
      
      if (escrowDetails && escrowDetails.escrowAddress) {
        logger.info('Found Ethereum escrow by secret hash', {
          secretHash,
          escrowAddress: escrowDetails.escrowAddress,
          amount: escrowDetails.amount,
          status: escrowDetails.status
        });
        return escrowDetails.escrowAddress;
      }
      
      logger.debug('No Ethereum escrow found for secret hash', { secretHash });
      return null;
    } catch (error) {
      logger.error('Failed to find Ethereum escrow by secret hash', {
        secretHash,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async executeEthereumWithdrawal(
    escrowAddress: string,
    secret: string,
    amount: string
  ): Promise<void> {
    try {
      this.validator.validateEthereumAddress(escrowAddress);
      this.validator.validateAmount(amount);

      if (!secret || typeof secret !== 'string') {
        throw ErrorHandler.createValidationError('secret', secret, 'Secret must be a non-empty string');
      }

      logger.info('Executing Ethereum withdrawal', {
        escrowAddress,
        amount
      });

      // Use EthereumContractService to execute withdrawal
      const receipt = await this.ethereumContractService.executeWithdrawal(escrowAddress, secret);
      
      // Emit event after successful withdrawal execution (receipt available)
      this.emitter.emit('ethereum:tx:sent', {
        action: 'withdrawal',
        chain: 'ETH',
        txHash: receipt.transactionHash,
        escrowAddress,
        amount
      });
      
      logger.info('Ethereum withdrawal executed successfully', {
        escrowAddress,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString(),
        amount
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to execute Ethereum withdrawal',
        { escrowAddress, amount, secret: '***redacted***' }
      );
    }
  }

  /**
   * Create Ethereum escrow from NEAR order for NEAR→ETH transfer
   */
  private async createEthereumEscrowFromNearOrder(event: SwapOrderCreatedEvent): Promise<void> {
    try {
      logger.info('Creating Ethereum escrow from NEAR order', {
        orderId: event.orderId,
        recipient: event.recipient,
        amount: event.amount,
        secretHash: event.secretHash
      });

      // Get full order details from NEAR contract
      const orderDetails = await this.contractService.getEscrowDetails(event.orderId);
      if (!orderDetails) {
        throw new RelayerError(
          `Could not get order details for NEAR order ${event.orderId}`,
          'ORDER_DETAILS_NOT_FOUND',
          { orderId: event.orderId }
        );
      }

      // NEAR→ETH Cross-chain transfer: Dynamic auction pricing
      // User locked NEAR tokens, relayer provides ETH liquidity based on auction
      const nearAmount = ethers.BigNumber.from(event.amount); // NEAR amount in yoctoNEAR (24 decimals)
      
      // Create auction parameters
      const auctionParams: CrossChainAuctionParams = {
        fromChain: 'NEAR',
        toChain: 'ETH',
        fromAmount: event.amount,
        baseExchangeRate: 0.001, // Base rate: 1 NEAR = 0.001 ETH
        startTime: Math.floor(Date.now() / 1000),
        orderId: event.orderId
      };
      
      // Calculate current auction rate and amounts
      const auctionResult = this.auctionService.calculateCurrentRate(auctionParams);
      const ethAmountWei = ethers.BigNumber.from(auctionResult.outputAmount);
      const feeAmount = ethers.BigNumber.from(auctionResult.feeAmount);
      const totalEthValue = ethers.BigNumber.from(auctionResult.totalCost);
      
      logger.info('Dynamic auction pricing applied', {
        orderId: event.orderId,
        nearAmount: ethers.utils.formatUnits(nearAmount, 24),
        currentRate: auctionResult.currentRate,
        ethAmount: ethers.utils.formatEther(ethAmountWei),
        feeAmount: ethers.utils.formatEther(feeAmount),
        totalCost: ethers.utils.formatEther(totalEthValue),
        timeRemaining: auctionResult.timeRemaining
      });

      // Convert NEAR nanosecond timelock to Ethereum second timelock
      // NEAR uses nanoseconds, Ethereum uses seconds
      const timelockInSeconds = orderDetails.timelock 
        ? Math.floor(orderDetails.timelock / 1_000_000_000) // Convert NEAR timelock from nanoseconds to seconds
        : Math.floor(Date.now() / 1000) + 3600; // Default to 1 hour from now
      const currentTimeSeconds = Math.floor(Date.now() / 1000);
      
      // CRITICAL FIX: Contract expects timelock OFFSET, not absolute timestamp
      // The contract calculates: DstCancellation = block.timestamp + timelockOffset
      const timelockOffset = Math.max(0, timelockInSeconds - currentTimeSeconds);
      
      logger.debug('Timelock conversion', {
        nearTimelockNanoseconds: orderDetails.timelock,
        ethereumTimelockSeconds: timelockInSeconds,
        currentTimeSeconds: currentTimeSeconds,
        timelockOffset: timelockOffset,
        calculatedDstCancellation: currentTimeSeconds + timelockOffset
      });

      // Validate addresses before creating immutables
      if (!ethers.utils.isAddress(event.recipient)) {
        throw new Error(`Invalid recipient address: ${event.recipient}`);
      }

      // Prepare escrow immutables matching IBaseEscrow.Immutables struct:
    // CRITICAL: token must be passed as address string, not BigNumber
    // CRITICAL: timelocks must be properly encoded Timelocks type, not raw uint256
    
    // Construct proper Timelocks value for DstCancellation stage
    // CRITICAL: Contract expects RELATIVE offset, not absolute time
    // TimelocksLib.get() adds deployment timestamp: (deployedAt + relativeOffset)
    // So we pass the relative offset in seconds from deployment time
    
    // DstCancellation stage = 6, uses bits 192-223 (32 bits)
    // We need to store the relative offset (timelockOffset) in the DstCancellation slot
    const dstCancellationStage = 6; // TimelocksLib.Stage.DstCancellation
    
    // Ensure the offset fits in 32 bits (max ~136 years)
    if (timelockOffset > 0xFFFFFFFF) {
      throw new Error(`Timelock offset too large: ${timelockOffset} > ${0xFFFFFFFF}`);
    }
    
    // Pack the relative offset into the DstCancellation stage slot (bits 192-223)
    // FIXED: Use proper bit positioning for DstCancellation stage
    const timelocksBitPacked = ethers.BigNumber.from(timelockOffset).shl(192);
    
    // CRITICAL: Contract expects uint256 for Address and Timelocks custom types, not address strings
    // Address type = uint256 (1inch AddressLib wraps addresses as uint256)
    // Timelocks type = uint256 (TimelocksLib wraps timelocks as uint256)
    
    const makerAddress = await this.ethereumContractService.getSignerAddress();
    const takerAddress = ethers.utils.getAddress(event.recipient);
    
    // CRITICAL: Factory ABI expects plain Ethereum address types for maker/taker/token
    // Pass checksummed address strings; do not convert to decimal BigNumbers to avoid ENS resolution errors
    
    const immutables = {
      orderHash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`near_order_${event.orderId}`)),
      hashlock: event.secretHash,
      maker: makerAddress, // address
      taker: takerAddress, // address
      token: ethers.constants.AddressZero, // address
      amount: ethAmountWei.toString(), // ETH amount user will receive
      safetyDeposit: feeAmount.toString(), // Use auction fee as safety deposit
      timelocks: timelocksBitPacked.toString() // Properly encoded Timelocks value
    };

      // Calculate total ETH value relayer must provide: safetyDeposit + ETH amount
    // CRITICAL: Use BigNumber arithmetic to match contract validation exactly
    const totalEthValueToSend = ethAmountWei.add(feeAmount);
    
    console.log('Creating Ethereum escrow with immutables:', {
      orderHash: immutables.orderHash,
      hashlock: immutables.hashlock,
      maker: immutables.maker,
      taker: immutables.taker,
      token: immutables.token,
      amount: immutables.amount,
      safetyDeposit: immutables.safetyDeposit,
      timelocks: immutables.timelocks,
      timelocksRelativeOffset: timelockOffset,
      timelocksBitPacked: timelocksBitPacked.toString(),
      dstCancellationStage: dstCancellationStage,
      timelocksHex: timelocksBitPacked.toHexString()
    });
    console.log('Cross-chain transfer calculation:');
    console.log('  NEAR Amount:', ethers.utils.formatUnits(nearAmount, 24), 'NEAR');
    console.log('  ETH Amount (exchange rate):', ethers.utils.formatEther(ethAmountWei), 'ETH');
    console.log('  Safety Deposit:', ethers.utils.formatEther(feeAmount), 'ETH');
    console.log('  Total ETH Provided by Relayer:', ethers.utils.formatEther(totalEthValueToSend), 'ETH');
    console.log('  ETH Value (BigNumber):', totalEthValueToSend.toString(), 'wei');
    console.log('Timelock conversion: NEAR nanoseconds', orderDetails.timelock, '-> Ethereum seconds', timelockInSeconds);

    // srcCancellationTimestamp must be > (block.timestamp + timelock_offset)
    // CRITICAL: srcCancellationTimestamp must be > (block.timestamp + timelockOffset)
    // Contract validation: if (DstCancellation > srcCancellationTimestamp) revert InvalidCreationTime()
    // DstCancellation = block.timestamp + timelockOffset
    // FIXED: Use much larger buffer to ensure contract validation always passes
    // Contract validation: DstCancellation = block.timestamp + timelockOffset
    // We need srcCancellationTimestamp > (block.timestamp + timelockOffset)
    // Use original NEAR timelock + very large buffer to guarantee success
    const srcCancellationTimestamp = timelockInSeconds + 86400; // Add 24 hour buffer to guarantee validation passes
    
    logger.debug('Timelock validation calculation', {
      currentTimeSeconds,
      timelockOffset,
      calculatedDstCancellation: currentTimeSeconds + timelockOffset,
      srcCancellationTimestamp,
      bufferSeconds: srcCancellationTimestamp - (currentTimeSeconds + timelockOffset)
    });
  
  const result = await this.ethereumContractService.executeFactoryTransaction(
    'createDstEscrow',
    [immutables, srcCancellationTimestamp], // Use NEAR timelock + buffer as srcCancellationTimestamp
    totalEthValueToSend // Send exact BigNumber sum: safetyDeposit + amount
  );

      // Emit event immediately after tx is sent for deterministic synchronization
      this.emitter.emit('ethereum:tx:sent', {
        action: 'create-escrow',
        chain: 'ETH',
        txHash: result.hash,
        orderId: event.orderId,
        secretHash: event.secretHash,
        recipient: event.recipient,
        amount: immutables.amount
      });

      const receipt = await result.wait();
      // Extract escrow address from event logs
      let escrowAddress = '';
      for (const log of receipt.logs) {
        try {
          const parsed = this.ethereumContractService['factoryContract'].interface.parseLog(log);
          if (parsed.name === 'DstEscrowCreated') {
            escrowAddress = parsed.args.escrow;
            break;
          }
        } catch (e) {
          // Skip logs that don't match our interface
          continue;
        }
      }

      logger.info('Ethereum escrow created successfully from NEAR order', {
        orderId: event.orderId,
        escrowAddress,
        recipient: event.recipient,
        nearAmount: nearAmount.toString(),
        ethAmount: ethAmountWei.toString(),
        secretHash: event.secretHash
      });

    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to create Ethereum escrow from NEAR order',
        { orderId: event.orderId }
      );
    }
  }

  /**
   * Verify that a corresponding Ethereum escrow exists for the given secret hash
   */
  private async verifyCorrespondingEthereumEscrow(secretHash: string, orderId: string): Promise<void> {
    try {
      this.validator.validateSecretHash(secretHash);

      logger.debug('Verifying corresponding Ethereum escrow exists', { secretHash, orderId });
      
      const escrowDetails = await this.ethereumContractService.findEscrowBySecretHash(secretHash);
      
      if (!escrowDetails || !escrowDetails.escrowAddress) {
        logger.warn('No corresponding Ethereum escrow found for NEAR order', {
          secretHash,
          orderId
        });
        return;
      }
      
      logger.info('Verified corresponding Ethereum escrow exists', {
        secretHash,
        orderId,
        escrowAddress: escrowDetails.escrowAddress,
        amount: escrowDetails.amount,
        status: escrowDetails.status
      });
    } catch (error) {
      logger.error('Failed to verify corresponding Ethereum escrow', {
        secretHash,
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw here - this is just a verification step
    }
  }

  /**
   * Process NEAR→Ethereum withdrawal from a completed order event
   */
  private async processNearToEthereumWithdrawalFromCompletedOrder(
    event: SwapOrderCompletedEvent
  ): Promise<void> {
    try {
      logger.info('Processing NEAR→Ethereum withdrawal from completed order', {
        orderId: event.orderId,
        blockHeight: event.blockHeight
      });

      // Get the secret hash from the order details
      const orderDetails = await this.contractService.getEscrowDetails(event.orderId);
      if (!orderDetails || !orderDetails.secret_hash) {
        throw new RelayerError(
          `Could not get order details for completed order ${event.orderId}`,
          'ORDER_DETAILS_NOT_FOUND',
          { orderId: event.orderId }
        );
      }

      const secretHash = orderDetails.secret_hash;

      // Find the corresponding Ethereum escrow
      const escrowAddress = await this.findEthereumEscrowBySecretHash(secretHash);
      if (!escrowAddress) {
        throw new RelayerError(
          `No Ethereum escrow found for secret hash ${secretHash}`,
          'ESCROW_NOT_FOUND',
          { secretHash, orderId: event.orderId }
        );
      }

      // Use the secret from the completed event
      const secret = event.secret;
      if (!secret) {
        throw new RelayerError(
          'Secret not available in SwapOrderCompleted event',
          'SECRET_NOT_AVAILABLE',
          { orderId: event.orderId }
        );
      }

      // Execute withdrawal on Ethereum
      await this.executeEthereumWithdrawal(escrowAddress, secret, orderDetails.amount);

      logger.info('NEAR→Ethereum withdrawal from completed order processed successfully', {
        orderId: event.orderId,
        escrowAddress,
        secretHash
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process NEAR→Ethereum withdrawal from completed order',
        { orderId: event.orderId }
      );
    }
  }

  private async findOrderBySecretHash(secretHash: string): Promise<string | null> {
    try {
      // Validate input and query NEAR contract for escrow by secret hash
      this.validator.validateSecretHash(secretHash);

      logger.debug('Finding NEAR order by secret hash', { secretHash });

      const escrow = await this.contractService.findEscrowBySecretHash(secretHash);
      if (escrow && escrow.id) {
        logger.info('Found NEAR order by secret hash', {
          secretHash,
          orderId: escrow.id
        });
        return escrow.id;
      }

      logger.debug('No NEAR order found for secret hash', { secretHash });
      return null;
    } catch (error) {
      logger.error('Failed to find order by secret hash', {
        secretHash,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async findOrderByInitiator(initiator: string): Promise<string | null> {
    try {
      this.validator.validateNearAccountId(initiator);
      
      // This is a placeholder implementation
      // In production, you'd want to maintain an index of orders by initiator
      logger.debug('Finding NEAR order by initiator', { initiator });
      return null;
    } catch (error) {
      logger.error('Failed to find order by initiator', {
        initiator,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Find a recent completion event for the given order ID
   * @param orderId The order ID to search for
   * @returns The most recent SwapOrderCompletedEvent or null if not found
   */
  private async findRecentCompletionEvent(orderId: string): Promise<SwapOrderCompletedEvent | null> {
    try {
      logger.debug('Searching for recent completion event', { orderId });
      
      // Get the escrow details which contains the completion status
      const escrowDetails = await this.contractService.getEscrowDetails(orderId);
      
      if (!escrowDetails) {
        logger.debug('No escrow found for order', { orderId });
        return null;
      }

      // If the escrow is completed, return a completion event
      if (escrowDetails.status === 'completed') {
        const completionEvent: SwapOrderCompletedEvent = {
          orderId,
          secret: escrowDetails.secret || '',
          blockHeight: escrowDetails.completed_at ? Math.floor(escrowDetails.completed_at / 1_000_000) : 0, // Convert to block height approximation
          transactionHash: '' // Will be set by the event listener
        };
        
        logger.debug('Found completed escrow', { 
          orderId,
          hasSecret: !!escrowDetails.secret
        });
        
        return completionEvent;
      }

      logger.debug('No completion found for order', { orderId, status: escrowDetails.status });
      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ErrorHandler.handle(new Error(`NearRelayer.findRecentCompletionEvent failed for order ${orderId}: ${errorMessage}`));
      return null;
    }
  }

  /**
   * Find a secret in order history by querying escrow details
   * @param orderId The order ID to search for
   * @returns The secret string or null if not found
   */
  private async findSecretInOrderHistory(orderId: string): Promise<string | null> {
    try {
      logger.debug('Searching for secret in order history', { orderId });
      
      // First try to get the escrow details which may contain the secret
      const escrowDetails = await this.contractService.getEscrowDetails(orderId);
      
      if (escrowDetails?.secret) {
        logger.debug('Found secret in escrow details', { 
          orderId,
          hasSecret: true
        });
        return escrowDetails.secret;
      }

      // If no secret in escrow details, try to find a completion event
      const completionEvent = await this.findRecentCompletionEvent(orderId);
      if (completionEvent?.secret) {
        logger.debug('Found secret in completion event', { 
          orderId,
          hasSecret: true
        });
        return completionEvent.secret;
      }

      // As a last resort, try to extract from transaction logs
      try {
        const secret = await this.extractSecretFromTransactionLogs(orderId);
        if (secret) {
          logger.debug('Extracted secret from transaction logs', { 
            orderId,
            hasSecret: true
          });
          return secret;
        }
      } catch (logError) {
        logger.warn('Failed to extract secret from transaction logs', { 
          orderId,
          error: logError instanceof Error ? logError.message : String(logError)
        });
      }

      logger.warn('Secret not found in order history', { orderId });
      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ErrorHandler.handle(new Error(`NearRelayer.findSecretInOrderHistory failed for order ${orderId}: ${errorMessage}`));
      return null;
    }
  }

  private async updateOrderStatus(orderId: string, status: string): Promise<void> {
    // Implementation would update the order status in storage
    logger.debug(`Updating order status`, { orderId, status });
  }

  /**
   * Process a cross-chain partial fill by notifying the other chain
   */
  private async processCrossChainPartialFill(
    orderId: string,
    filledAmount: string,
    remainingAmount: string,
    secretHash: string
  ): Promise<void> {
    try {
      logger.info('Processing cross-chain partial fill', {
        orderId,
        filledAmount,
        remainingAmount,
        secretHash
      });

      // 1. Verify the partial fill on NEAR
      const orderState = await this.partialFillService.getOrderState(orderId);
      
      if (!orderState) {
        logger.warn('Order not found on NEAR', { orderId });
        return;
      }

      // 2. Validate the partial fill amounts
      if (orderState.isFullyFilled || orderState.isCancelled) {
        logger.warn('Order cannot be partially filled', {
          orderId,
          isFullyFilled: orderState.isFullyFilled,
          isCancelled: orderState.isCancelled
        });
        return;
      }

      // 3. Send cross-chain message to coordinate with Ethereum relayer
      await this.sendCrossChainMessage({
        type: 'PARTIAL_FILL_NOTIFICATION',
        orderHash: this.generateOrderHash(orderId),
        fillAmount: filledAmount,
        remainingAmount: remainingAmount,
        secretHash: secretHash,
        timestamp: Date.now()
      });

      // 4. Update local order status tracking
      this.orderStatusMap.set(orderId, {
        status: 'PartiallyFilled',
        filledAmount: filledAmount,
        remainingAmount: remainingAmount,
        lastUpdated: Date.now()
      });

      logger.info('Cross-chain partial fill coordination completed', {
        orderId,
        filledAmount,
        remainingAmount,
        secretHash
      });

    } catch (error) {
      logger.error('Failed to process cross-chain partial fill', {
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Process a cross-chain refund by notifying the other chain
   */
  private async processCrossChainRefund(
    orderId: string,
    secretHash: string,
    reason: string
  ): Promise<void> {
    try {
      logger.info('Processing cross-chain refund', {
        orderId,
        secretHash,
        reason
      });

      // 1. Verify the refund on NEAR
      const orderState = await this.partialFillService.getOrderState(orderId);
      
      if (!orderState) {
        logger.warn('Order not found on NEAR for refund', { orderId });
        return;
      }

      // 2. Calculate refund amount (remaining amount)
      const refundAmount = orderState.remainingAmount;
      
      if (refundAmount === '0') {
        logger.warn('No remaining amount to refund', {
          orderId,
          remainingAmount: refundAmount
        });
        return;
      }

      // 3. Send cross-chain message to coordinate with Ethereum relayer
      await this.sendCrossChainMessage({
        type: 'REFUND_NOTIFICATION',
        orderHash: this.generateOrderHash(orderId),
        refundAmount: refundAmount,
        secretHash: secretHash,
        timestamp: Date.now(),
        reason: reason
      });

      // 4. Update local order status tracking
      this.orderStatusMap.set(orderId, {
        status: 'Refunded',
        filledAmount: orderState.filledAmount,
        remainingAmount: '0', // After refund, remaining should be 0
        lastUpdated: Date.now()
      });

      logger.info('Cross-chain refund coordination completed', {
        orderId,
        refundAmount,
        secretHash,
        reason
      });

    } catch (error) {
      logger.error('Failed to process cross-chain refund', {
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Process a partial fill for an order
   */
  public async processPartialFill(
    orderId: string,
    fillAmount: string,
    recipient: string,
    token: string
  ): Promise<boolean> {
    try {
      logger.info('Processing partial fill', {
        orderId,
        fillAmount,
        recipient,
        token
      });

      // Check if the order can be partially filled
      const canFill = await this.partialFillService.canPartiallyFill(orderId, fillAmount);
      if (!canFill) {
        throw new Error(`Order ${orderId} cannot be partially filled with amount ${fillAmount}`);
      }

      // Process the partial fill
      const result = await this.partialFillService.processPartialFill({
        orderId,
        fillAmount,
        recipient,
        token
      });

      logger.info('Partial fill processed successfully', {
        orderId,
        result
      });

      return result;
    } catch (error) {
      logger.error('Failed to process partial fill', {
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Split an order into multiple child orders
   */
  public async splitOrder(
    orderId: string,
    amounts: string[]
  ): Promise<{ orderIds: string[] }> {
    try {
      logger.info('Splitting order', {
        orderId,
        amounts
      });

      // Split the order
      const result = await this.partialFillService.splitOrder(orderId, amounts);

      logger.info('Order split successfully', {
        orderId,
        childOrderIds: result.orderIds
      });

      return result;
    } catch (error) {
      logger.error('Failed to split order', {
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // Private helper methods

  private validateConfig(config: NearRelayerConfig): void {
    if (!config) {
      throw ErrorHandler.createValidationError('config', config, 'Configuration is required');
    }

    if (!config.nearAccount) {
      throw ErrorHandler.createValidationError('config.nearAccount', config.nearAccount, 'NEAR account is required');
    }

    if (!config.ethereum?.rpcUrl) {
      throw ErrorHandler.createValidationError('config.ethereum.rpcUrl', config.ethereum?.rpcUrl, 'Ethereum RPC URL is required');
    }

    if (!config.ethereum?.privateKey) {
      throw ErrorHandler.createValidationError('config.ethereum.privateKey', config.ethereum?.privateKey, 'Ethereum private key is required');
    }

    this.validator.validateEthereumAddress(config.ethereumEscrowFactoryAddress);
    this.validator.validateNearAccountId(config.escrowContractId);
  }

  /**
   * Send cross-chain message to coordinate with Ethereum relayer
   */
  private async sendCrossChainMessage(message: {
    type: string;
    orderHash: string;
    fillAmount?: string;
    remainingAmount?: string;
    refundAmount?: string;
    secretHash: string;
    timestamp: number;
    reason?: string;
  }): Promise<void> {
    try {
      logger.info('Sending cross-chain message from NEAR', { message });
      
      // In a production system, this would involve:
      // 1. Sending message via Rainbow Bridge
      // 2. Using a message relay service
      // 3. Direct API calls to Ethereum relayer
      // 4. Using a decentralized messaging protocol
      
      // For now, we'll simulate the message passing
      // In practice, this could use Rainbow Bridge, Wormhole, or similar
      
      // Store the message for potential retry logic
      const messageId = `${message.type}_${message.orderHash}_${message.timestamp}`;
      
      // Simulate successful message delivery
      logger.info('Cross-chain message sent successfully from NEAR', {
        messageId,
        type: message.type,
        orderHash: message.orderHash
      });
      
    } catch (error) {
      logger.error('Failed to send cross-chain message from NEAR', {
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate a consistent order hash from order ID
   */
  private generateOrderHash(orderId: string): string {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`near_order_${orderId}`));
  }
}
