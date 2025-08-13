/**
 * Comprehensive Input Validation Utility
 * Provides robust validation for all cross-chain relayer operations
 */

import { ethers } from 'ethers';
import { logger } from './logger.js';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class InputValidator {
  /**
   * Validate Ethereum address format
   */
  static validateEthereumAddress(address: string, fieldName = 'address'): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!address) {
      errors.push(`${fieldName} is required`);
    } else if (typeof address !== 'string') {
      errors.push(`${fieldName} must be a string`);
    } else {
      // Accept any 0x-prefixed 40-hex address as valid; use checksum only for warnings
      const isBasicHex = /^0x[0-9a-fA-F]{40}$/.test(address);
      if (!isBasicHex) {
        errors.push(`${fieldName} is not a valid Ethereum address`);
      } else {
        // If checksum validation fails, warn but do not invalidate
        try {
          if (!ethers.utils.isAddress(address)) {
            warnings.push(`${fieldName} checksum is invalid`);
          }
        } catch {
          // Ignore checksum validation errors
        }

        if (address === ethers.constants.AddressZero) {
          warnings.push(`${fieldName} is the zero address`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate NEAR account ID format
   */
  static validateNearAccountId(accountId: string, fieldName = 'accountId'): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!accountId) {
      errors.push(`${fieldName} is required`);
    } else if (typeof accountId !== 'string') {
      errors.push(`${fieldName} must be a string`);
    } else {
      // NEAR account ID validation rules
      const nearAccountRegex = /^[a-z0-9._-]+$/;
      if (!nearAccountRegex.test(accountId)) {
        errors.push(`${fieldName} contains invalid characters (only lowercase letters, numbers, dots, underscores, and hyphens allowed)`);
      }
      
      if (accountId.length < 2 || accountId.length > 64) {
        errors.push(`${fieldName} must be between 2 and 64 characters`);
      }
      
      if (accountId.startsWith('.') || accountId.endsWith('.')) {
        errors.push(`${fieldName} cannot start or end with a dot`);
      }
      
      if (accountId.includes('..')) {
        errors.push(`${fieldName} cannot contain consecutive dots`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate amount (string representation of number)
   */
  static validateAmount(amount: string, fieldName = 'amount', options: {
    allowZero?: boolean;
    minValue?: string;
    maxValue?: string;
  } = {}): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { allowZero = false, minValue, maxValue } = options;

    if (!amount) {
      errors.push(`${fieldName} is required`);
    } else if (typeof amount !== 'string') {
      errors.push(`${fieldName} must be a string`);
    } else {
      try {
        const amountBN = ethers.BigNumber.from(amount);
        
        if (!allowZero && amountBN.isZero()) {
          errors.push(`${fieldName} cannot be zero`);
        }
        
        if (amountBN.isNegative()) {
          errors.push(`${fieldName} cannot be negative`);
        }
        
        if (minValue) {
          const minBN = ethers.BigNumber.from(minValue);
          if (amountBN.lt(minBN)) {
            errors.push(`${fieldName} must be at least ${minValue}`);
          }
        }
        
        if (maxValue) {
          const maxBN = ethers.BigNumber.from(maxValue);
          if (amountBN.gt(maxBN)) {
            errors.push(`${fieldName} cannot exceed ${maxValue}`);
          }
        }
        
        // Warning for very large amounts
        const maxSafeAmount = ethers.BigNumber.from('1000000000000000000000000'); // 1M tokens with 18 decimals
        if (amountBN.gt(maxSafeAmount)) {
          warnings.push(`${fieldName} is unusually large, please verify`);
        }
      } catch (error) {
        errors.push(`${fieldName} is not a valid number: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate secret hash (32-byte hex string)
   */
  static validateSecretHash(secretHash: string, fieldName = 'secretHash'): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!secretHash) {
      errors.push(`${fieldName} is required`);
    } else if (typeof secretHash !== 'string') {
      errors.push(`${fieldName} must be a string`);
    } else {
      if (!secretHash.startsWith('0x')) {
        errors.push(`${fieldName} must start with '0x'`);
      } else if (secretHash.length !== 66) { // 0x + 64 hex chars
        errors.push(`${fieldName} must be exactly 66 characters (0x + 64 hex chars)`);
      } else if (!/^0x[a-fA-F0-9]{64}$/.test(secretHash)) {
        errors.push(`${fieldName} must contain only hexadecimal characters`);
      } else if (secretHash === ethers.constants.HashZero) {
        warnings.push(`${fieldName} is the zero hash`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate secret (preimage)
   */
  static validateSecret(secret: string, fieldName = 'secret'): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!secret) {
      errors.push(`${fieldName} is required`);
    } else if (typeof secret !== 'string') {
      errors.push(`${fieldName} must be a string`);
    } else {
      if (secret.length < 32) {
        warnings.push(`${fieldName} is shorter than recommended minimum (32 characters)`);
      }
      
      if (secret.length > 256) {
        warnings.push(`${fieldName} is longer than recommended maximum (256 characters)`);
      }
      
      // Check for common weak secrets
      const weakSecrets = ['password', '123456', 'secret', 'test'];
      if (weakSecrets.includes(secret.toLowerCase())) {
        warnings.push(`${fieldName} appears to be a weak secret`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate timelock (Unix timestamp in seconds)
   */
  static validateTimelock(timelock: number, fieldName = 'timelock', options: {
    minDuration?: number; // minimum duration from now in seconds
    maxDuration?: number; // maximum duration from now in seconds
  } = {}): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { minDuration = 300, maxDuration = 86400 * 30 } = options; // 5 min to 30 days

    if (timelock === undefined || timelock === null) {
      errors.push(`${fieldName} is required`);
    } else if (typeof timelock !== 'number') {
      errors.push(`${fieldName} must be a number`);
    } else if (!Number.isInteger(timelock)) {
      errors.push(`${fieldName} must be an integer`);
    } else if (timelock <= 0) {
      errors.push(`${fieldName} must be positive`);
    } else {
      const now = Math.floor(Date.now() / 1000);
      const duration = timelock - now;
      
      if (timelock <= now) {
        errors.push(`${fieldName} must be in the future`);
      } else if (duration < minDuration) {
        warnings.push(`${fieldName} is very soon (less than ${minDuration} seconds from now)`);
      } else if (duration > maxDuration) {
        warnings.push(`${fieldName} is very far in the future (more than ${maxDuration} seconds from now)`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate chain ID
   */
  static validateChainId(chainId: number, fieldName = 'chainId'): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (chainId === undefined || chainId === null) {
      errors.push(`${fieldName} is required`);
    } else if (typeof chainId !== 'number') {
      errors.push(`${fieldName} must be a number`);
    } else if (!Number.isInteger(chainId)) {
      errors.push(`${fieldName} must be an integer`);
    } else if (chainId <= 0) {
      errors.push(`${fieldName} must be positive`);
    } else {
      // Known chain IDs
      const knownChains = {
        1: 'Ethereum Mainnet',
        11155111: 'Sepolia Testnet',
        137: 'Polygon Mainnet',
        80001: 'Mumbai Testnet'
      };
      
      if (!(chainId in knownChains)) {
        warnings.push(`${fieldName} ${chainId} is not a known chain ID`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate message ID
   */
  static validateMessageId(messageId: string, fieldName = 'messageId'): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!messageId) {
      errors.push(`${fieldName} is required`);
    } else if (typeof messageId !== 'string') {
      errors.push(`${fieldName} must be a string`);
    } else if (messageId.length < 8) {
      warnings.push(`${fieldName} is shorter than recommended (8+ characters)`);
    } else if (messageId.length > 128) {
      warnings.push(`${fieldName} is longer than recommended (128 characters max)`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate cross-chain message structure
   */
  static validateCrossChainMessage(message: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!message) {
      errors.push('Message is required');
      return { isValid: false, errors, warnings };
    }

    // Validate required fields
    const messageIdResult = this.validateMessageId(message.messageId);
    errors.push(...messageIdResult.errors);
    warnings.push(...messageIdResult.warnings);

    if (!message.type) {
      errors.push('Message type is required');
    } else if (!['deposit', 'withdrawal', 'refund', 'partial_fill'].includes(message.type)) {
      errors.push(`Invalid message type: ${message.type}`);
    }

    if (!message.sourceChain) {
      errors.push('Source chain is required');
    }

    if (!message.destChain) {
      errors.push('Destination chain is required');
    }

    if (!message.timestamp) {
      errors.push('Timestamp is required');
    } else if (typeof message.timestamp !== 'number') {
      errors.push('Timestamp must be a number');
    }

    // Validate amounts if present
    if (message.amount) {
      const amountResult = this.validateAmount(message.amount);
      errors.push(...amountResult.errors);
      warnings.push(...amountResult.warnings);
    }

    // Validate addresses if present
    if (message.sender) {
      if (message.sourceChain === 'ETH') {
        const senderResult = this.validateEthereumAddress(message.sender, 'sender');
        errors.push(...senderResult.errors);
        warnings.push(...senderResult.warnings);
      } else if (message.sourceChain === 'NEAR') {
        const senderResult = this.validateNearAccountId(message.sender, 'sender');
        errors.push(...senderResult.errors);
        warnings.push(...senderResult.warnings);
      }
    }

    if (message.recipient) {
      if (message.destChain === 'ETH') {
        const recipientResult = this.validateEthereumAddress(message.recipient, 'recipient');
        errors.push(...recipientResult.errors);
        warnings.push(...recipientResult.warnings);
      } else if (message.destChain === 'NEAR') {
        const recipientResult = this.validateNearAccountId(message.recipient, 'recipient');
        errors.push(...recipientResult.errors);
        warnings.push(...recipientResult.warnings);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Log validation results
   */
  static logValidationResults(results: ValidationResult, context: string): void {
    if (!results.isValid) {
      logger.error(`Validation failed for ${context}`, {
        errors: results.errors,
        warnings: results.warnings
      });
    } else if (results.warnings.length > 0) {
      logger.warn(`Validation warnings for ${context}`, {
        warnings: results.warnings
      });
    } else {
      logger.debug(`Validation passed for ${context}`);
    }
  }

  /**
   * Throw error if validation fails
   */
  static assertValid(results: ValidationResult, context: string): void {
    this.logValidationResults(results, context);
    
    if (!results.isValid) {
      throw new Error(`Validation failed for ${context}: ${results.errors.join(', ')}`);
    }
  }
}

export default InputValidator;
