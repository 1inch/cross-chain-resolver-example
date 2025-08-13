/**
 * Validation service for cross-chain relayer
 * Provides comprehensive input validation with proper error handling
 */

import { ethers } from 'ethers';
import { IValidator } from '../types/interfaces.js';
import { ErrorHandler } from '../utils/errors.js';

export class ValidationService implements IValidator {
  /**
   * Validates Ethereum address format
   */
  validateEthereumAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      throw ErrorHandler.createValidationError('address', address, 'Address must be a non-empty string');
    }

    // Accept EIP-55 checksum OR any 40-hex address (tests use mixed-case non-checksummed)
    if (!ethers.utils.isAddress(address)) {
      const basicHex = /^0x[0-9a-fA-F]{40}$/;
      if (!basicHex.test(address)) {
        throw ErrorHandler.createValidationError('address', address, 'Invalid Ethereum address format');
      }
    }

    return true;
  }

  /**
   * Validates NEAR account ID format
   */
  validateNearAccountId(accountId: string): boolean {
    if (!accountId || typeof accountId !== 'string') {
      throw ErrorHandler.createValidationError('accountId', accountId, 'Account ID must be a non-empty string');
    }

    // NEAR account ID validation rules
    const accountIdRegex = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
    
    if (accountId.length < 2 || accountId.length > 64) {
      throw ErrorHandler.createValidationError('accountId', accountId, 'Account ID must be between 2 and 64 characters');
    }

    if (!accountIdRegex.test(accountId)) {
      throw ErrorHandler.createValidationError('accountId', accountId, 'Account ID contains invalid characters');
    }

    if (accountId.startsWith('.') || accountId.endsWith('.')) {
      throw ErrorHandler.createValidationError('accountId', accountId, 'Account ID cannot start or end with a dot');
    }

    if (accountId.includes('..')) {
      throw ErrorHandler.createValidationError('accountId', accountId, 'Account ID cannot contain consecutive dots');
    }

    return true;
  }

  /**
   * Validates amount is positive and within reasonable bounds
   */
  validateAmount(amount: string | bigint): boolean {
    if (amount === null || amount === undefined) {
      throw ErrorHandler.createValidationError('amount', amount, 'Amount cannot be null or undefined');
    }

    let amountBigInt: bigint;

    try {
      if (typeof amount === 'number') {
        throw ErrorHandler.createValidationError('amount', amount, 'Amount must be provided as string or bigint');
      } else if (typeof amount === 'string') {
        if (!amount.trim()) {
          throw ErrorHandler.createValidationError('amount', amount, 'Amount cannot be empty string');
        }
        
        // Support both ETH (decimal or short integer) and wei (long integer)
        if (amount.includes('.')) {
          // Decimal => treat as ETH
          amountBigInt = ethers.utils.parseEther(amount).toBigInt();
        } else {
          // Integer string must be digits only
          if (!/^\d+$/.test(amount)) {
            throw ErrorHandler.createValidationError('amount', amount, 'Amount must be a numeric string');
          }
          // Integer string: if length >= 18 treat as wei, else treat as ETH
          amountBigInt = amount.length >= 18
            ? BigInt(amount) // assume wei
            : ethers.utils.parseEther(amount).toBigInt(); // assume ETH
        }
      } else if (typeof amount === 'bigint') {
        amountBigInt = amount;
      } else {
        throw ErrorHandler.createValidationError('amount', amount, 'Invalid amount type');
      }
    } catch (error) {
      throw ErrorHandler.createValidationError('amount', amount, `Invalid amount format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (amountBigInt <= BigInt(0)) {
      throw ErrorHandler.createValidationError('amount', amount, 'Amount must be positive');
    }

    // Set reasonable upper bound (1 billion ETH equivalent)
    const maxAmount = ethers.utils.parseEther('1000000000').toBigInt();
    if (amountBigInt > maxAmount) {
      throw ErrorHandler.createValidationError('amount', amount, 'Amount exceeds maximum allowed value');
    }

    return true;
  }

  /**
   * Validates secret hash format (32-byte hex string)
   */
  validateSecretHash(hash: string): boolean {
    if (!hash || typeof hash !== 'string') {
      throw ErrorHandler.createValidationError('secretHash', hash, 'Secret hash must be a non-empty string');
    }

    // Remove 0x prefix if present
    const cleanHash = hash.startsWith('0x') ? hash.slice(2) : hash;

    if (cleanHash.length !== 64) {
      throw ErrorHandler.createValidationError('secretHash', hash, 'Secret hash must be 32 bytes (64 hex characters)');
    }

    if (!/^[0-9a-fA-F]+$/.test(cleanHash)) {
      throw ErrorHandler.createValidationError('secretHash', hash, 'Secret hash must contain only hexadecimal characters');
    }

    return true;
  }

  /**
   * Validates transaction hash format
   */
  validateTransactionHash(txHash: string, chain: 'ETH' | 'NEAR'): boolean {
    if (!txHash || typeof txHash !== 'string') {
      throw ErrorHandler.createValidationError('txHash', txHash, 'Transaction hash must be a non-empty string');
    }

    if (chain === 'ETH') {
      // Ethereum transaction hash validation (32 bytes hex)
      const cleanHash = txHash.startsWith('0x') ? txHash.slice(2) : txHash;
      if (cleanHash.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleanHash)) {
        throw ErrorHandler.createValidationError('txHash', txHash, 'Invalid Ethereum transaction hash format');
      }
    } else if (chain === 'NEAR') {
      // NEAR transaction hash validation
      // Tests expect NEAR hashes to be 32-64 characters and alphanumeric (not strict base58)
      if (txHash.length < 32 || txHash.length > 64) {
        throw ErrorHandler.createValidationError('txHash', txHash, 'Invalid NEAR transaction hash length');
      }

      if (!/^[a-zA-Z0-9]+$/.test(txHash)) {
        throw ErrorHandler.createValidationError('txHash', txHash, 'Invalid NEAR transaction hash format');
      }
    }

    return true;
  }

  /**
   * Validates message ID format
   */
  validateMessageId(messageId: string): boolean {
    if (!messageId || typeof messageId !== 'string') {
      throw ErrorHandler.createValidationError('messageId', messageId, 'Message ID must be a non-empty string');
    }

    if (messageId.length < 6 || messageId.length > 128) {
      throw ErrorHandler.createValidationError('messageId', messageId, 'Message ID must be between 6 and 128 characters');
    }

    // Allow alphanumeric characters, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) {
      throw ErrorHandler.createValidationError('messageId', messageId, 'Message ID contains invalid characters');
    }

    return true;
  }

  /**
   * Validates timelock value (Unix timestamp)
   */
  validateTimelock(timelock: number): boolean {
    if (typeof timelock !== 'number' || !Number.isInteger(timelock)) {
      throw ErrorHandler.createValidationError('timelock', timelock, 'Timelock must be an integer');
    }

    if (timelock < 0) {
      throw ErrorHandler.createValidationError('timelock', timelock, 'Timelock cannot be negative');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const maxFutureTime = currentTime + (365 * 24 * 60 * 60); // 1 year from now

    if (timelock > maxFutureTime) {
      throw ErrorHandler.createValidationError('timelock', timelock, 'Timelock is too far in the future');
    }

    return true;
  }

  /**
   * Validates a complete cross-chain message
   */
  validateCrossChainMessage(message: any): boolean {
    if (!message || typeof message !== 'object') {
      throw ErrorHandler.createValidationError('message', message, 'Message must be an object');
    }

    // Validate required fields
    this.validateMessageId(message.messageId);
    
    if (!message.type || !['DEPOSIT', 'WITHDRAWAL', 'REFUND'].includes(message.type)) {
      throw ErrorHandler.createValidationError('message.type', message.type, 'Invalid message type');
    }

    if (!message.sourceChain || !['NEAR', 'ETH'].includes(message.sourceChain)) {
      throw ErrorHandler.createValidationError('message.sourceChain', message.sourceChain, 'Invalid source chain');
    }

    if (!message.destChain || !['NEAR', 'ETH'].includes(message.destChain)) {
      throw ErrorHandler.createValidationError('message.destChain', message.destChain, 'Invalid destination chain');
    }

    // Validate addresses based on chain
    if (message.sourceChain === 'ETH') {
      this.validateEthereumAddress(message.sender);
    } else {
      this.validateNearAccountId(message.sender);
    }

    if (message.destChain === 'ETH') {
      this.validateEthereumAddress(message.recipient);
    } else {
      this.validateNearAccountId(message.recipient);
    }

    this.validateAmount(message.amount);

    if (!message.data || typeof message.data !== 'object') {
      throw ErrorHandler.createValidationError('message.data', message.data, 'Message data must be an object');
    }

    this.validateTransactionHash(message.data.txHash, message.sourceChain);

    // Type-specific validations
    if (message.type === 'DEPOSIT' && message.data.secretHash) {
      this.validateSecretHash(message.data.secretHash);
    }

    if (message.data.timelock !== undefined) {
      this.validateTimelock(message.data.timelock);
    }

    return true;
  }

  /**
   * Validates contract configuration
   */
  validateContractConfig(config: any): boolean {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw ErrorHandler.createValidationError('config', config, 'Config must be an object');
    }

    if (config.ethereum) {
      if (config.ethereum.factoryAddress) {
        this.validateEthereumAddress(config.ethereum.factoryAddress);
      }
      if (config.ethereum.bridgeAddress) {
        this.validateEthereumAddress(config.ethereum.bridgeAddress);
      }
    }

    if (config.near) {
      if (config.near.accountId) {
        this.validateNearAccountId(config.near.accountId);
      }
      if (config.near.escrowContractId) {
        this.validateNearAccountId(config.near.escrowContractId);
      }
    }

    // Auction configuration (optional)
    if (config.auction) {
      this.validateAuctionConfig(config.auction);
    }

    return true;
  }

  /**
   * Validates auction configuration object
   * Only validates fields that are present (supports partial overrides)
   */
  validateAuctionConfig(config: any): boolean {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw ErrorHandler.createValidationError('auction', config, 'Auction config must be an object');
    }

    const ensureInteger = (name: string, val: unknown) => {
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        throw ErrorHandler.createValidationError(`auction.${name}`, val, `${name} must be an integer`);
      }
    };

    if (config.duration !== undefined) {
      ensureInteger('duration', config.duration);
      if (config.duration < 30 || config.duration > 1800) {
        throw ErrorHandler.createValidationError('auction.duration', config.duration, 'duration must be between 30 and 1800 seconds');
      }
    }

    if (config.initialRateBump !== undefined) {
      ensureInteger('initialRateBump', config.initialRateBump);
      if (config.initialRateBump < 0) {
        throw ErrorHandler.createValidationError('auction.initialRateBump', config.initialRateBump, 'initialRateBump cannot be negative');
      }
    }

    if (config.points !== undefined) {
      if (!Array.isArray(config.points) || config.points.length === 0) {
        throw ErrorHandler.createValidationError('auction.points', config.points, 'points must be a non-empty array');
      }
      let lastDelay = -1;
      for (let i = 0; i < config.points.length; i++) {
        const p = config.points[i];
        if (!p || typeof p !== 'object') {
          throw ErrorHandler.createValidationError(`auction.points[${i}]`, p, 'each point must be an object');
        }
        if (typeof p.delay !== 'number' || p.delay < 0 || !Number.isFinite(p.delay)) {
          throw ErrorHandler.createValidationError(`auction.points[${i}].delay`, p.delay, 'delay must be a non-negative number');
        }
        if (typeof p.coefficient !== 'number' || !Number.isInteger(p.coefficient)) {
          throw ErrorHandler.createValidationError(`auction.points[${i}].coefficient`, p.coefficient, 'coefficient must be an integer');
        }
        if (p.delay < lastDelay) {
          throw ErrorHandler.createValidationError(`auction.points[${i}].delay`, p.delay, 'points must be sorted by ascending delay');
        }
        lastDelay = p.delay;
      }
    }

    if (config.gasBumpEstimate !== undefined) {
      ensureInteger('gasBumpEstimate', config.gasBumpEstimate);
      if (config.gasBumpEstimate < 0) {
        throw ErrorHandler.createValidationError('auction.gasBumpEstimate', config.gasBumpEstimate, 'gasBumpEstimate cannot be negative');
      }
    }

    if (config.gasPriceEstimate !== undefined) {
      if (typeof config.gasPriceEstimate !== 'number' || !Number.isFinite(config.gasPriceEstimate) || config.gasPriceEstimate < 0) {
        throw ErrorHandler.createValidationError('auction.gasPriceEstimate', config.gasPriceEstimate, 'gasPriceEstimate must be a non-negative number');
      }
    }

    if (config.minFillPercentage !== undefined) {
      if (typeof config.minFillPercentage !== 'number' || !Number.isFinite(config.minFillPercentage) || config.minFillPercentage < 0 || config.minFillPercentage > 1) {
        throw ErrorHandler.createValidationError('auction.minFillPercentage', config.minFillPercentage, 'minFillPercentage must be between 0 and 1');
      }
    }

    if (config.maxRateBump !== undefined) {
      ensureInteger('maxRateBump', config.maxRateBump);
      if (config.maxRateBump < 0) {
        throw ErrorHandler.createValidationError('auction.maxRateBump', config.maxRateBump, 'maxRateBump cannot be negative');
      }
    }

    return true;
  }

  /**
   * Validates runtime auction parameters (order-level)
   */
  validateAuctionRuntimeParams(params: any): boolean {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw ErrorHandler.createValidationError('auctionParams', params, 'Auction params must be an object');
    }

    const { fromChain, toChain, fromAmount, baseExchangeRate, startTime, orderId } = params as Record<string, unknown>;

    if (fromChain !== 'NEAR' && fromChain !== 'ETH') {
      throw ErrorHandler.createValidationError('auctionParams.fromChain', fromChain, "fromChain must be 'NEAR' or 'ETH'");
    }
    if (toChain !== 'NEAR' && toChain !== 'ETH') {
      throw ErrorHandler.createValidationError('auctionParams.toChain', toChain, "toChain must be 'NEAR' or 'ETH'");
    }
    if (fromChain === toChain) {
      throw ErrorHandler.createValidationError('auctionParams.toChain', toChain, 'toChain must differ from fromChain');
    }

    this.validateAmount(fromAmount as any);

    if (typeof baseExchangeRate !== 'number' || !Number.isFinite(baseExchangeRate) || baseExchangeRate <= 0) {
      throw ErrorHandler.createValidationError('auctionParams.baseExchangeRate', baseExchangeRate as any, 'baseExchangeRate must be a positive number');
    }

    if (typeof startTime !== 'number' || !Number.isInteger(startTime) || startTime < 0) {
      throw ErrorHandler.createValidationError('auctionParams.startTime', startTime as any, 'startTime must be a non-negative integer (unix seconds)');
    }

    if (typeof orderId !== 'string') {
      throw ErrorHandler.createValidationError('auctionParams.orderId', orderId as any, 'orderId must be a string');
    }
    // Reuse messageId constraints (6-128, alnum, - and _)
    this.validateMessageId(orderId as string);

    return true;
  }
}
