/**
 * Centralized error handling for the cross-chain relayer
 * Provides standardized error classes and error handling utilities
 */

import { logger } from './logger.js';

// Normalize error detail objects to be JSON-serializable
function normalizeDetails(value: any, seen = new WeakSet()): any {
  const t = typeof value;
  if (value == null || t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return value.toString();
  if (t === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  // ethers BigNumber detection without import
  if (value && typeof value === 'object' && (value as any)._isBigNumber) {
    try { return (value as any).toString(); } catch { return `${value}`; }
  }
  if (Array.isArray(value)) return value.map((v) => normalizeDetails(v, seen));
  if (t === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeDetails(v, seen);
    }
    return out;
  }
  return value;
}

// Base error class for all relayer errors
export class RelayerError extends Error {
  public readonly code: string;
  public readonly details?: any;
  public readonly timestamp: Date;

  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = 'RelayerError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, RelayerError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: normalizeDetails(this.details),
      timestamp: this.timestamp.toISOString(),
      stack: this.stack
    };
  }
}

// Validation-specific errors
export class ValidationError extends RelayerError {
  public readonly field: string;
  public readonly value?: any;

  constructor(message: string, field: string, value?: any) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

// Security-specific errors
export class SecurityError extends RelayerError {
  public readonly securityIssue: string;

  constructor(message: string, securityIssue: string) {
    super(message, 'SECURITY_ERROR', { securityIssue });
    this.name = 'SecurityError';
    this.securityIssue = securityIssue;
    
    Object.setPrototypeOf(this, SecurityError.prototype);
  }
}

// Network/RPC-specific errors
export class NetworkError extends RelayerError {
  public readonly network: string;
  public readonly operation: string;

  constructor(message: string, network: string, operation: string, details?: any) {
    super(message, 'NETWORK_ERROR', { network, operation, ...details });
    this.name = 'NetworkError';
    this.network = network;
    this.operation = operation;
    
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

// Contract interaction errors
export class ContractError extends RelayerError {
  public readonly contractAddress: string;
  public readonly method: string;

  constructor(message: string, contractAddress: string, method: string, details?: any) {
    super(message, 'CONTRACT_ERROR', { contractAddress, method, ...details });
    this.name = 'ContractError';
    this.contractAddress = contractAddress;
    this.method = method;
    
    Object.setPrototypeOf(this, ContractError.prototype);
  }
}

// Configuration errors
export class ConfigurationError extends RelayerError {
  public readonly configKey: string;

  constructor(message: string, configKey: string, details?: any) {
    super(message, 'CONFIGURATION_ERROR', { configKey, ...details });
    this.name = 'ConfigurationError';
    this.configKey = configKey;
    
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

// Storage/persistence errors
export class StorageError extends RelayerError {
  public readonly operation: string;
  public readonly path?: string;

  constructor(message: string, operation: string, path?: string, details?: any) {
    super(message, 'STORAGE_ERROR', { operation, path, ...details });
    this.name = 'StorageError';
    this.operation = operation;
    this.path = path;
    
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

// Error handling utilities
export class ErrorHandler {
  /**
   * Handle and log errors with appropriate severity
   */
  static handle(error: Error, context?: string): void {
    const contextMsg = context ? `[${context}] ` : '';
    
    if (error instanceof RelayerError) {
      // Log structured relayer errors with normalized details
      logger.error(`${contextMsg}${error.message}`, {
        code: error.code,
        details: normalizeDetails(error.details),
        timestamp: error.timestamp,
        stack: error.stack
      });
    } else {
      // Log generic errors
      logger.error(`${contextMsg}${error.message}`, normalizeDetails({
        name: error.name,
        stack: error.stack
      }));
    }
  }

  /**
   * Handle and log errors, then rethrow with additional context
   */
  static handleAndRethrow(error: Error, context: string, additionalDetails?: any): never {
    this.handle(error, context);
    
    if (error instanceof RelayerError) {
      // Add context to existing relayer error
      const enhancedDetails = normalizeDetails({ ...error.details, context, ...additionalDetails });
      throw new RelayerError(
        `${context}: ${error.message}`,
        error.code,
        enhancedDetails
      );
    } else {
      // Wrap generic error in RelayerError
      throw new RelayerError(
        `${context}: ${error.message}`,
        'WRAPPED_ERROR',
        normalizeDetails({ originalError: error.name, context, ...additionalDetails })
      );
    }
  }

  /**
   * Safely execute an async operation with error handling
   */
  static async safeExecute<T>(
    operation: () => Promise<T>,
    context: string,
    fallbackValue?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.handle(error as Error, context);
      return fallbackValue;
    }
  }

  /**
   * Create a validation error with standardized format
   */
  static createValidationError(field: string, value: any, reason: string): ValidationError {
    return new ValidationError(
      `Validation failed for field '${field}': ${reason}`,
      field,
      value
    );
  }

  /**
   * Create a security error with standardized format
   */
  static createSecurityError(issue: string, details?: any): SecurityError {
    return new SecurityError(
      `Security violation detected: ${issue}`,
      issue
    );
  }
}

// All error types are already exported above, no need for duplicate exports
