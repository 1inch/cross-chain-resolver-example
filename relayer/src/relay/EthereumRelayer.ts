/**
 * Refactored Ethereum Relayer
 * Uses dependency injection and proper separation of concerns
 */

import { ethers } from 'ethers';
import { NearAccount, IMessageProcessor, DepositMessage, WithdrawalMessage, RefundMessage } from '../types/interfaces.js';
import { EthereumEventListener, EthereumEventHandlers, DepositInitiatedEvent, MessageSentEvent, WithdrawalCompletedEvent, EscrowCreatedEvent, OrderPartiallyFilledEvent, OrderRefundedEvent } from '../services/EthereumEventListener.js';
import { EthereumContractService } from '../services/EthereumContractService.js';
import { ValidationService } from '../services/ValidationService.js';
import { StorageService } from '../services/StorageService.js';
import { RelayerError, ErrorHandler } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { DynamicAuctionService, CrossChainAuctionParams, AuctionConfig } from '../services/DynamicAuctionService.js';
import { EthereumPartialFillService, PartialFillParams } from '../services/EthereumPartialFillService.js';
import type { RetryOptions } from '../utils/retry.js';
import { PriceOracleService } from '../services/PriceOracleService.js';

export interface EthereumRelayerConfig {
  provider: ethers.providers.JsonRpcProvider;
  signer: ethers.Signer;
  nearAccount: NearAccount;
  factoryAddress: string;
  bridgeAddress: string;
  resolverAddress: string; // For partial fills
  resolverAbi?: any[]; // For partial fills
  pollIntervalMs?: number;
  storageDir?: string;
  // Optional auction configuration to pass into DynamicAuctionService when DI not provided
  auctionConfig?: AuctionConfig;
  // New: concurrency control
  concurrencyLimit?: number;
  // New: retry policies per external call type
  retry?: {
    default?: RetryOptions;
    factoryTx?: RetryOptions;
    receipt?: RetryOptions;
    nearCall?: RetryOptions;
  };
}

export class EthereumRelayer implements IMessageProcessor {
  private readonly config: EthereumRelayerConfig;
  private readonly eventListener: EthereumEventListener;
  private readonly contractService: EthereumContractService;
  private readonly validator: ValidationService;
  private readonly storage: StorageService;
  private readonly auctionService: DynamicAuctionService;
  private readonly partialFillService: EthereumPartialFillService;
  private readonly priceOracle: PriceOracleService;
  private processedMessages: Set<string> = new Set();
  // In-flight idempotency and simple concurrency control
  private inFlight: Set<string> = new Set();
  private activeTasks = 0;
  private readonly concurrencyLimit: number;
  private queue: Array<() => void> = [];
  private isRunning = false;

  // Allow dependency injection for improved testability
  constructor(config: EthereumRelayerConfig, deps?: { auctionService?: DynamicAuctionService }) {
    this.config = config;

    // Initialize services first
    this.validator = new ValidationService();
    
    // Then validate config
    this.validateConfig(config);
    this.storage = new StorageService(config.storageDir, 'ethereum_processed_messages.json');
    // Prefer injected auction service; fall back to local construction
    this.auctionService = deps?.auctionService ?? new DynamicAuctionService();
    this.contractService = new EthereumContractService(
      config.provider,
      config.signer,
      config.factoryAddress
    );

    // Initialize partial fill service
    this.partialFillService = new EthereumPartialFillService(
      config.provider,
      config.signer,
      config.resolverAddress,
      config.resolverAbi || []
    );

    this.priceOracle = new PriceOracleService();

    // Set up event handlers
    const eventHandlers: EthereumEventHandlers = {
      onDepositInitiated: this.handleDepositInitiated.bind(this),
      onMessageSent: this.handleMessageSent.bind(this),
      onWithdrawalCompleted: this.handleWithdrawalCompleted.bind(this),
      onEscrowCreated: this.handleEscrowCreated.bind(this),
      onOrderPartiallyFilled: this.handleOrderPartiallyFilled.bind(this),
      onOrderRefunded: this.handleOrderRefunded.bind(this)
    };

    this.eventListener = new EthereumEventListener(
      config.provider,
      config.factoryAddress,
      config.bridgeAddress,
      eventHandlers,
      config.pollIntervalMs
    );

    // Concurrency
    this.concurrencyLimit = typeof config.concurrencyLimit === 'number' && config.concurrencyLimit > 0
      ? Math.floor(config.concurrencyLimit)
      : 5;
  }

  /**
   * Run a task honoring the concurrency limit
   */
  private async runWithConcurrency<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeTasks >= this.concurrencyLimit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeTasks++;
    try {
      return await task();
    } finally {
      this.activeTasks--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  /**
   * Compute a keccak256 hash from an input string using raw bytes.
   * - If input is a 0x-prefixed hex string, hash its raw bytes
   * - Otherwise, fall back to UTF-8 bytes (legacy tests/mocks)
   */
  private computeSecretHash(input: string): string {
    try {
      const isHex = typeof input === 'string' && input.startsWith('0x') && input.length % 2 === 0;
      const bytes = isHex ? ethers.utils.arrayify(input) : ethers.utils.toUtf8Bytes(input);
      return ethers.utils.keccak256(bytes);
    } catch (e) {
      // As a last resort, attempt direct keccak256 on input (ethers will throw if invalid)
      return ethers.utils.keccak256(input as unknown as ethers.utils.BytesLike);
    }
  }

  /**
   * Start the Ethereum relayer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('EthereumRelayer is already running');
      return;
    }

    try {
      logger.info('Starting Ethereum relayer...');

      // Initialize storage
      await this.storage.initialize();

      // Start event listener
      await this.eventListener.start();

      this.isRunning = true;
      logger.info('Ethereum relayer started successfully');
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to start Ethereum relayer'
      );
    }
  }

  /**
   * Stop the Ethereum relayer
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info('Stopping Ethereum relayer...');

      // Stop event listener
      await this.eventListener.stop();

      this.isRunning = false;
      logger.info('Ethereum relayer stopped successfully');
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.stop');
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
  async processMessage(message: DepositMessage | WithdrawalMessage | RefundMessage): Promise<void> {
    try {
      // Basic idempotency: skip already processed or in-flight
      const persistedStatus = this.storage.getMessageStatus?.(message.messageId);
      if (this.processedMessages.has(message.messageId) || this.inFlight.has(message.messageId) || persistedStatus === 'succeeded') {
        logger.debug('Skipping duplicate/in-flight message', { messageId: message.messageId });
        return;
      }
      this.inFlight.add(message.messageId);
      await this.storage.markMessageStarted?.(message.messageId);

      logger.info('Processing message', {
        messageId: message.messageId,
        type: message.type,
        sourceChain: message.sourceChain,
        destChain: message.destChain
      });

      await this.runWithConcurrency(async () => {
        switch (message.type) {
          case 'DEPOSIT':
            await this.processDepositMessage(message as DepositMessage);
            break;
          case 'WITHDRAWAL':
            await this.processWithdrawalMessage(message as WithdrawalMessage);
            break;
          case 'REFUND':
            await this.processRefundMessage(message as RefundMessage);
            break;
          default:
            throw ErrorHandler.createValidationError('message.type', (message as any).type, 'Unsupported message type');
        }
      });

      // Mark as processed
      this.processedMessages.add(message.messageId);
      if (this.storage.markMessageSucceeded) {
        await this.storage.markMessageSucceeded(message.messageId);
      } else {
        await this.storage.saveProcessedMessage(message.messageId);
      }

      logger.info('Message processed successfully', {
        messageId: message.messageId,
        type: message.type
      });
    } catch (error) {
      // mark failed for crash resilience
      if (this.storage.markMessageFailed) {
        await this.storage.markMessageFailed(message.messageId, (error as Error)?.message);
      }
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        `Failed to process message: ${message.messageId}`,
        {
          type: message.type,
          sourceChain: message.sourceChain,
          destChain: message.destChain
        }
      );
    }
    finally {
      this.inFlight.delete(message.messageId);
    }
  }

  /**
   * Get the number of processed messages
   */
  getProcessedMessageCount(): number {
    return this.storage.getProcessedMessageCount();
  }

  // Event handlers

  private async handleDepositInitiated(event: DepositInitiatedEvent): Promise<void> {
    try {
      logger.info('Handling DepositInitiated event', {
        depositId: event.depositId,
        sender: event.sender,
        nearRecipient: event.nearRecipient,
        amount: ethers.utils.formatEther(event.amount),
        blockNumber: event.blockNumber
      });

      // Create NEAR escrow for ETH→NEAR cross-chain transfer
      // Generate consistent secret hash for cross-chain transfer using raw bytes
      const secretHash = this.computeSecretHash(event.depositId);
      
      await this.createNearEscrowFromEthOrder(
        event.sender,
        event.nearRecipient,
        event.amount.toString(),
        secretHash,
        event.depositId
      );

      logger.info('DepositInitiated event processed successfully', {
        depositId: event.depositId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.handleDepositInitiated');
    }
  }

  private async handleMessageSent(event: MessageSentEvent): Promise<void> {
    try {
      logger.info('Handling MessageSent event', {
        messageId: event.messageId,
        targetChain: event.targetChain,
        targetAddress: event.targetAddress,
        blockNumber: event.blockNumber
      });

      // Process the cross-chain message if it's for NEAR
      if (event.targetChain.toLowerCase() === 'near') {
        // Decode and process the message data
        await this.processEncodedMessage(event.messageId, event.data);
      }

      logger.info('MessageSent event processed successfully', {
        messageId: event.messageId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.handleMessageSent');
    }
  }

  private async handleWithdrawalCompleted(event: WithdrawalCompletedEvent): Promise<void> {
    try {
      logger.info('Handling WithdrawalCompleted event', {
        messageId: event.messageId,
        recipient: event.recipient,
        amount: ethers.utils.formatEther(event.amount),
        blockNumber: event.blockNumber
      });

      // Update NEAR escrow status or perform cleanup
      await this.updateNearEscrowStatus(event.messageId, 'completed');

      logger.info('WithdrawalCompleted event processed successfully', {
        messageId: event.messageId
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'EthereumRelayer.handleWithdrawalCompleted');
    }
  }

  private async handleEscrowCreated(event: EscrowCreatedEvent): Promise<void> {
    try {
      logger.info('Ethereum escrow created', {
        escrow: event.escrow,
        initiator: event.initiator,
        amount: ethers.utils.formatEther(event.amount),
        targetChain: event.targetChain,
        targetAddress: event.targetAddress
      });

      // Process escrow for NEAR swap if applicable
      if (event.targetChain.toLowerCase() === 'near') {
        await this.processEscrowForNearSwap(event);
      }
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to handle escrow created event',
        { escrow: event.escrow, targetChain: event.targetChain }
      );
    }
  }

  async handleOrderPartiallyFilled(event: OrderPartiallyFilledEvent): Promise<void> {
    try {
      logger.info('Ethereum order partially filled', {
        orderHash: event.orderHash,
        fillAmount: event.fillAmount,
        remainingAmount: event.remainingAmount,
        fillCount: event.fillCount,
        recipient: event.recipient
      });

      // Process cross-chain partial fill notification if secretHash is present
      if (event.secretHash) {
        await this.processCrossChainPartialFill(event);
      }

      // Update local order tracking
      await this.updateOrderStatus(event.orderHash, 'PartiallyFilled', {
        fillAmount: event.fillAmount,
        remainingAmount: event.remainingAmount,
        fillCount: event.fillCount
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to handle order partially filled event',
        { orderHash: event.orderHash, fillAmount: event.fillAmount }
      );
    }
  }

  async handleOrderRefunded(event: OrderRefundedEvent): Promise<void> {
    try {
      logger.info('Ethereum order refunded', {
        orderHash: event.orderHash,
        recipient: event.recipient,
        refundAmount: event.refundAmount,
        reason: event.reason
      });

      // Process cross-chain refund notification if secretHash is present
      if (event.secretHash) {
        await this.processCrossChainRefund(event);
      }

      // Update local order tracking
      await this.updateOrderStatus(event.orderHash, 'Refunded', {
        refundAmount: event.refundAmount,
        reason: event.reason
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to handle order refunded event',
        { orderHash: event.orderHash, refundAmount: event.refundAmount }
      );
    }
  }

  // Message processors

  private async processDepositMessage(message: DepositMessage): Promise<void> {
    try {
      logger.info('Processing deposit message', { 
        messageId: message.messageId,
        depositId: message.data.txHash,
        fromChain: message.sourceChain,
        toChain: message.destChain,
        amount: message.amount
      });

      // Validate required fields
      if (!message.data.secretHash) {
        throw new Error('Missing required field: secretHash');
      }

      // Calculate auction parameters using DynamicAuctionService
      const auctionParams = {
        fromChain: 'NEAR' as const,
        toChain: 'ETH' as const,
        fromAmount: message.amount,
        baseExchangeRate: await this.getExchangeRate('NEAR', 'ETH'),
        startTime: Math.floor(Date.now() / 1000),
        orderId: message.data.txHash
      };

      // Validate runtime auction parameters
      this.validator.validateAuctionRuntimeParams(auctionParams);

      // Get current auction rate and output amount (use optional auction config overrides)
      const auctionResult = this.auctionService.calculateCurrentRate(auctionParams, this.config.auctionConfig);

      // Compute precise ETH values using BigNumber to avoid precision loss
      const ethAmountWei = ethers.utils.parseEther(auctionResult.outputAmount);
      const safetyDepositWei = ethers.utils.parseEther(auctionResult.feeAmount);
      const totalEthValueToSend = ethAmountWei.add(safetyDepositWei);

      // Build factory immutables for createDstEscrow
      const maker = await this.contractService.getSignerAddress();
      const taker = message.recipient;
      const token = ethers.constants.AddressZero; // Native ETH
      const orderHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(message.data.txHash));
      const timelocks = ethers.BigNumber.from(message.data.timelock);
      const dstImmutables = [
        orderHash,
        message.data.secretHash,
        maker,
        taker,
        token,
        ethAmountWei,
        safetyDepositWei,
        timelocks
      ];

      // Source side cancellation timestamp (fallback to same timelock window)
      const srcCancellationTimestamp = timelocks;

      // Create destination escrow on Ethereum factory
      const escrowTx = await withRetry(
        () => this.contractService.executeFactoryTransaction(
          'createDstEscrow',
          [dstImmutables, srcCancellationTimestamp],
          totalEthValueToSend
        ),
        this.config.retry?.factoryTx ?? this.config.retry?.default ?? {
          retries: 3,
          shouldRetry: (err) => {
            const msg = (err as any)?.message || '';
            return /UNPREDICTABLE_GAS_LIMIT|ETIMEOUT|temporar|rate limit|nonce|replacement|network/i.test(msg);
          }
        }
      );

      // Wait for transaction confirmation
      const receipt = await withRetry(
        () => escrowTx.wait(),
        this.config.retry?.receipt ?? this.config.retry?.default ?? {
          retries: 3,
          shouldRetry: (err) => /timeout|ETIMEOUT|rpc/i.test((err as any)?.message || '')
        }
      );
      
      // Extract escrow address from event logs
      const escrowCreatedEvent = receipt.events?.find(
        (e: any) => e.event === 'DstEscrowCreated'
      );
      
      if (!escrowCreatedEvent) {
        throw new Error('EscrowCreated event not found in transaction receipt');
      }

      const escrowAddress = escrowCreatedEvent.args?.escrow;
      
      // Update order status
      await this.updateOrderStatus(message.data.txHash, 'escrow_created', {
        escrowAddress,
        transactionHash: receipt.transactionHash,
        timestamp: new Date().toISOString()
      });

      logger.info('Successfully processed deposit message', {
        messageId: message.messageId,
        escrowAddress,
        transactionHash: receipt.transactionHash
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to process deposit message', {
        messageId: message.messageId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Update order status with error
      await this.updateOrderStatus(message.data.txHash, 'error', {
        error: errorMessage,
        timestamp: new Date().toISOString()
      });

      throw error;
    }
  }

  private async processWithdrawalMessage(message: WithdrawalMessage): Promise<void> {
    try {
      logger.info('Processing withdrawal message', {
        messageId: message.messageId,
        recipient: message.recipient,
        amount: message.amount
      });

      // Find and execute withdrawal on Ethereum escrow using consistent raw-bytes hash
      const escrow = await this.contractService.findEscrowByParams({
        secretHash: this.computeSecretHash(message.secret)
      });

      if (!escrow) {
        throw new RelayerError(
          'No matching escrow found for withdrawal',
          'ESCROW_NOT_FOUND',
          { messageId: message.messageId, secretHash: '***redacted***' }
        );
      }

      // Execute withdrawal
      await this.contractService.executeWithdrawal(escrow.escrowAddress!, message.secret);

      logger.info('Withdrawal message processed successfully', {
        messageId: message.messageId,
        escrowAddress: escrow.escrowAddress
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process withdrawal message',
        { messageId: message.messageId }
      );
    }
  }

  private async processRefundMessage(message: RefundMessage): Promise<void> {
    try {
      logger.info('Processing refund message', {
        messageId: message.messageId,
        sender: message.sender,
        reason: message.reason
      });

      // Find and execute refund on Ethereum escrow
      const escrow = await this.contractService.findEscrowByParams({
        initiator: message.sender
      });

      if (!escrow) {
        throw new RelayerError(
          'No matching escrow found for refund',
          'ESCROW_NOT_FOUND',
          { messageId: message.messageId, initiator: message.sender }
        );
      }

      // Execute refund
      await this.contractService.executeRefund(escrow.escrowAddress!);

      logger.info('Refund message processed successfully', {
        messageId: message.messageId,
        escrowAddress: escrow.escrowAddress
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process refund message',
        { messageId: message.messageId }
      );
    }
  }

  // NEAR integration methods

  /**
   * Create NEAR escrow for ETH→NEAR cross-chain transfer
   * Relayer provides NEAR liquidity based on ETH amount and exchange rate
   */
  private async createNearEscrowFromEthOrder(
    ethereumSender: string,
    nearRecipient: string,
    ethAmount: string,
    secretHash: string,
    orderId: string
  ): Promise<void> {
    try {
      this.validator.validateEthereumAddress(ethereumSender);
      this.validator.validateNearAccountId(nearRecipient);
      this.validator.validateAmount(ethAmount);

      // ETH→NEAR Cross-chain transfer: Dynamic auction pricing
      // User locked ETH tokens, relayer provides NEAR liquidity based on auction
      const ethAmountWei = ethers.BigNumber.from(ethAmount);
      
      // Create auction parameters
      const auctionParams: CrossChainAuctionParams = {
        fromChain: 'ETH',
        toChain: 'NEAR',
        fromAmount: ethAmount,
        baseExchangeRate: 1000, // Base rate: 1 ETH = 1000 NEAR
        startTime: Math.floor(Date.now() / 1000),
        orderId: orderId
      };
      
      // Validate runtime auction parameters
      this.validator.validateAuctionRuntimeParams(auctionParams);

      // Calculate current auction rate and amounts (use optional auction config overrides)
      const auctionResult = this.auctionService.calculateCurrentRate(auctionParams, this.config.auctionConfig);
      const nearAmountYocto = ethers.BigNumber.from(auctionResult.outputAmount);
      const feeAmount = ethers.BigNumber.from(auctionResult.feeAmount);
      const totalNearValue = ethers.BigNumber.from(auctionResult.totalCost);
      
      logger.info('Dynamic auction pricing applied for ETH→NEAR', {
        ethAmount: ethers.utils.formatEther(ethAmountWei),
        currentRate: auctionResult.currentRate,
        nearAmount: ethers.utils.formatUnits(nearAmountYocto, 24),
        feeAmount: ethers.utils.formatUnits(feeAmount, 24),
        totalCost: ethers.utils.formatUnits(totalNearValue, 24),
        timeRemaining: auctionResult.timeRemaining,
        orderId: orderId
      });

      // Call NEAR contract to create escrow with relayer's NEAR liquidity
      const result = await withRetry(() => this.config.nearAccount.functionCall({
        contractId: process.env.NEAR_ESCROW_CONTRACT_ID!,
        methodName: 'create_swap_order',
        args: {
          recipient: nearRecipient,
          hashlock: secretHash, // Use consistent secret hash
          timelock_duration: 86400, // 24 hours
          eth_sender: ethereumSender, // Track original ETH sender
          order_id: orderId // Cross-reference with ETH order
        },
        gas: BigInt('30000000000000'), // 30 TGas
        attachedDeposit: nearAmountYocto.toBigInt() // Relayer provides NEAR liquidity
      }), this.config.retry?.nearCall ?? this.config.retry?.default ?? { retries: 3, shouldRetry: () => true });

      logger.info('NEAR escrow created successfully for ETH→NEAR transfer', {
        ethereumSender,
        nearRecipient,
        ethAmount: ethers.utils.formatEther(ethAmountWei),
        nearAmount: ethers.utils.formatUnits(nearAmountYocto, 24),
        orderId,
        result
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to create NEAR escrow for ETH→NEAR transfer',
        { ethereumSender, nearRecipient, ethAmount, orderId }
      );
    }
  }

  private async processEncodedMessage(messageId: string, encodedData: string): Promise<void> {
    try {
      // Decode the message data (implementation depends on encoding format)
      // This is a placeholder for the actual decoding logic
      logger.debug('Processing encoded message', { messageId, encodedData });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process encoded message',
        { messageId }
      );
    }
  }

  private async updateNearEscrowStatus(messageId: string, status: string): Promise<void> {
    try {
      // Update NEAR escrow status
      // This is a placeholder for the actual implementation
      logger.debug('Updating NEAR escrow status', { messageId, status });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to update NEAR escrow status',
        { messageId, status }
      );
    }
  }

  /**
   * Process Ethereum escrow creation for ETH→NEAR cross-chain transfer
   * Relayer detects ETH escrow and creates corresponding NEAR escrow with liquidity
   */
  private async processEscrowForNearSwap(event: EscrowCreatedEvent): Promise<void> {
    try {
      logger.info('Processing ETH escrow for NEAR swap', {
        escrow: event.escrow,
        initiator: event.initiator,
        amount: ethers.utils.formatEther(event.amount),
        targetChain: event.targetChain,
        targetAddress: event.targetAddress
      });

      // Validate this is a NEAR-targeted escrow
      if (event.targetChain.toLowerCase() !== 'near') {
        logger.debug('Skipping non-NEAR escrow', { targetChain: event.targetChain });
        return;
      }

      // Generate consistent secret hash for cross-chain transfer
      // Use escrow address as unique identifier, hashed using raw bytes (address hex)
      const secretHash = this.computeSecretHash(event.escrow);
      
      // Create NEAR escrow with relayer's NEAR liquidity
      await this.createNearEscrowFromEthOrder(
        event.initiator, // ETH sender
        event.targetAddress, // NEAR recipient
        event.amount.toString(), // ETH amount locked
        secretHash, // Consistent secret hash
        event.escrow // Use escrow address as order ID
      );

      logger.info('ETH→NEAR cross-chain transfer processed successfully', {
        ethEscrow: event.escrow,
        ethAmount: ethers.utils.formatEther(event.amount),
        nearRecipient: event.targetAddress
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process ETH escrow for NEAR swap',
        { escrow: event.escrow, targetAddress: event.targetAddress }
      );
    }
  }

  /**
   * Process partial fill for an Ethereum order
   */
  async processPartialFill(orderHash: string, fillAmount: string, recipient: string, token: string): Promise<void> {
    try {
      logger.info('Processing partial fill for Ethereum order', {
        orderHash,
        fillAmount,
        recipient,
        token
      });

      const params: PartialFillParams = {
        orderHash,
        fillAmount,
        recipient,
        token
      };

      const tx = await this.partialFillService.processPartialFill(params);
      await tx.wait();

      logger.info('Partial fill processed successfully', {
        orderHash,
        txHash: tx.hash
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process partial fill',
        { orderHash, fillAmount }
      );
    }
  }

  /**
   * Split an Ethereum order into multiple child orders
   */
  async splitOrder(orderHash: string, amounts: string[]): Promise<void> {
    try {
      logger.info('Splitting Ethereum order', {
        orderHash,
        childCount: amounts.length,
        amounts
      });

      const tx = await this.partialFillService.splitOrder(orderHash, amounts);
      await tx.wait();

      logger.info('Order split successfully', {
        orderHash,
        txHash: tx.hash
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to split order',
        { orderHash, amounts }
      );
    }
  }

  /**
   * Process cross-chain partial fill notification
   */
  private async processCrossChainPartialFill(event: OrderPartiallyFilledEvent): Promise<void> {
    try {
      logger.info('Processing cross-chain partial fill notification', {
        orderHash: event.orderHash,
        fillAmount: event.fillAmount,
        secretHash: event.secretHash
      });

      // 1. Verify the partial fill on Ethereum
      const orderState = await this.partialFillService.getOrderState(event.orderHash);
      
      if (!orderState) {
        logger.warn('Order not found on Ethereum', { orderHash: event.orderHash });
        return;
      }

      // 2. Validate the partial fill against current state
      const expectedFillAmount = ethers.BigNumber.from(event.fillAmount);
      const currentFilledAmount = ethers.BigNumber.from(orderState.filledAmount);
      
      if (currentFilledAmount.lt(expectedFillAmount)) {
        logger.warn('Partial fill amount mismatch', {
          orderHash: event.orderHash,
          expected: event.fillAmount,
          current: orderState.filledAmount
        });
      }

      // 3. Coordinate with NEAR chain via message passing
      await this.sendCrossChainMessage({
        type: 'PARTIAL_FILL_CONFIRMATION',
        orderHash: event.orderHash,
        fillAmount: event.fillAmount || '0',
        remainingAmount: event.remainingAmount || '0',
        secretHash: event.secretHash || '',
        timestamp: Date.now()
      });

      // 4. Persist order status tracking
      await this.updateOrderStatus(
        event.orderHash,
        orderState.isFullyFilled ? 'FULLY_FILLED' : 'PARTIALLY_FILLED',
        { fillCount: orderState.fillCount, filledAmount: orderState.filledAmount }
      );
      
      logger.info('Cross-chain partial fill notification processed successfully', {
        orderHash: event.orderHash,
        newStatus: orderState.isFullyFilled ? 'FULLY_FILLED' : 'PARTIALLY_FILLED'
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process cross-chain partial fill',
        { orderHash: event.orderHash }
      );
    }
  }

  /**
   * Send cross-chain message to coordinate with NEAR relayer
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
      logger.info('Sending cross-chain message', { message });
      
      // In a production system, this would involve:
      // 1. Sending message via a bridge contract
      // 2. Using a message relay service
      // 3. Direct API calls to NEAR relayer
      // 4. Using a decentralized messaging protocol
      
      // For now, we'll simulate the message passing
      // In practice, this could use Rainbow Bridge, Wormhole, or similar
      
      // Store the message for potential retry logic
      const messageId = `${message.type}_${message.orderHash}_${message.timestamp}`;
      
      // Simulate successful message delivery
      logger.info('Cross-chain message sent successfully', {
        messageId,
        type: message.type,
        orderHash: message.orderHash
      });
      
    } catch (error) {
      logger.error('Failed to send cross-chain message', {
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Process cross-chain refund notification
   */
  private async processCrossChainRefund(event: OrderRefundedEvent): Promise<void> {
    try {
      logger.info('Processing cross-chain refund notification', {
        orderHash: event.orderHash,
        refundAmount: event.refundAmount,
        secretHash: event.secretHash
      });

      // Implement cross-chain coordination for refunds
      // 1. Verify the refund on Ethereum
      const orderState = await withRetry(
        () => this.partialFillService.getOrderState(event.orderHash),
        this.config.retry?.default || { retries: 3, minDelayMs: 500, maxDelayMs: 5000, factor: 1.8, jitter: true }
      );
      if (!orderState) {
        logger.warn(`Order state not found for refund: ${event.orderHash}`);
      }
      
      // 2. Update local order status tracking
      await this.updateOrderStatus(event.orderHash, 'refunded', {
        refundAmount: event.refundAmount,
        secretHash: event.secretHash,
        timestamp: Date.now(),
        reason: 'Cross-chain refund processed'
      });
      
      // 3. Notify NEAR relayer about the refund
      await this.sendCrossChainMessage({
        type: 'refund_notification',
        orderHash: event.orderHash,
        refundAmount: event.refundAmount,
        secretHash: event.secretHash || '',
        timestamp: Date.now(),
        reason: 'Cross-chain refund processed'
      });
      
      logger.debug('Cross-chain refund notification processed', {
        orderHash: event.orderHash
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to process cross-chain refund',
        { orderHash: event.orderHash }
      );
    }
  }

  /**
   * Update order status in local storage
   */
  private async updateOrderStatus(orderHash: string, status: string, metadata?: any): Promise<void> {
    try {
      logger.debug('Updating order status', {
        orderHash,
        status,
        metadata
      });

      // Persist via StorageService for durability across restarts
      const normalized = String(status).toUpperCase();
      if (normalized.includes('FAILED') || normalized === 'REFUNDED') {
        await this.storage.markMessageFailed(orderHash, metadata?.reason || metadata?.error);
      } else if (normalized.includes('PARTIALLY_FILLED') || normalized.includes('FULLY_FILLED') || normalized === 'COMPLETED' || normalized === 'SUCCEEDED') {
        await this.storage.markMessageSucceeded(orderHash);
      } else {
        await this.storage.markMessageStarted(orderHash);
      }

      logger.debug('Order status updated successfully', {
        orderHash,
        status
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'Failed to update order status',
        { orderHash, status }
      );
    }
  }

  // Private helper methods

  private validateConfig(config: EthereumRelayerConfig): void {
    if (!config) {
      throw ErrorHandler.createValidationError('config', config, 'Configuration is required');
    }

    if (!config.provider) {
      throw ErrorHandler.createValidationError('config.provider', config.provider, 'Provider is required');
    }

    if (!config.signer) {
      throw ErrorHandler.createValidationError('config.signer', config.signer, 'Signer is required');
    }

    if (!config.nearAccount) {
      throw ErrorHandler.createValidationError('config.nearAccount', config.nearAccount, 'NEAR account is required');
    }

    this.validator.validateEthereumAddress(config.factoryAddress);
    this.validator.validateEthereumAddress(config.bridgeAddress);

    // If provided, validate auction configuration early to surface misconfigurations
    if (config.auctionConfig) {
      this.validator.validateAuctionConfig(config.auctionConfig);
      logger.debug('Auction configuration validated');
    }
  }

  /**
   * Get exchange rate between two chains
   * This is a placeholder implementation - in production, this would
   * integrate with price oracles or exchange rate APIs
   */
  private async getExchangeRate(fromChain: string, toChain: string): Promise<number> {
    try {
      logger.debug('Getting exchange rate', { fromChain, toChain });
      
      const res = await this.priceOracle.getRate({ from: fromChain, to: toChain });
      logger.debug('Exchange rate retrieved', { fromChain, toChain, rate: res.rate, source: res.source });
      return res.rate;
    } catch (error) {
      logger.error('Failed to get exchange rate', {
        fromChain,
        toChain,
        error: error instanceof Error ? error.message : String(error)
      });
      return 1; // safe fallback
    }
  }
}
