/**
 * NEAR contract service
 * Handles all NEAR smart contract interactions with proper error handling
 */

import { NearAccount, NearEscrowDetails, IContractService } from '../types/interfaces.js';
import { ContractError, ValidationError, ErrorHandler } from '../utils/errors.js';
import { ValidationService } from './ValidationService.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

export interface NearSwapOrderParams {
  recipient: string;
  hashlock: string;
  timelockDuration: number;
  attachedDeposit: bigint;
}

export interface NearEscrowUpdateParams {
  status?: string;
  secret?: string;
  completedAt?: number;
}

export class NearContractService implements IContractService {
  private readonly nearAccount: NearAccount;
  private readonly escrowContractId: string;
  private readonly validator: ValidationService;

  constructor(nearAccount: NearAccount, escrowContractId: string) {
    // Initialize validator first
    this.validator = new ValidationService();
    
    // Then validate parameters
    this.validateConstructorParams(nearAccount, escrowContractId);
    
    this.nearAccount = nearAccount;
    this.escrowContractId = escrowContractId;
  }

  /**
   * Get details of any contract (generic implementation)
   */
  async getContractDetails(contractId: string): Promise<any> {
    try {
      this.validator.validateNearAccountId(contractId);
      
      // For escrow contracts, return escrow details
      if (contractId === this.escrowContractId) {
        return await this.getEscrowContractState();
      }
      
      // For other contracts, return basic contract info
      return await this.getGenericContractInfo(contractId);
    } catch (error) {
      throw new ContractError(
        'Failed to get contract details',
        contractId,
        'getDetails',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Execute a transaction on a contract
   */
  async executeTransaction(
    contractId: string,
    method: string,
    params: any[]
  ): Promise<any> {
    try {
      this.validator.validateNearAccountId(contractId);
      
      if (!method || typeof method !== 'string') {
        throw ErrorHandler.createValidationError('method', method, 'Method name must be a non-empty string');
      }

      if (!Array.isArray(params)) {
        throw ErrorHandler.createValidationError('params', params, 'Parameters must be an array');
      }

      // Convert params array to args object (NEAR expects named parameters)
      const args = params.length > 0 ? params[0] : {};
      const safeArgs = this.makeJsonSafe(args);

      const result = await withRetry(() => this.nearAccount.functionCall({
        contractId,
        methodName: method,
        args: safeArgs,
        gas: BigInt('30000000000000'), // 30 TGas
        attachedDeposit: BigInt('0')
      }));

      logger.info('NEAR transaction executed successfully', {
        contractId,
        method,
        args: this.sanitizeArgsForLogging(safeArgs)
      });

      return result;
    } catch (error) {
      throw new ContractError(
        `Failed to execute transaction: ${method}`,
        contractId,
        method,
        { 
          params: this.sanitizeArgsForLogging(params),
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Create a swap order on the NEAR escrow contract
   */
  async createSwapOrder(params: NearSwapOrderParams): Promise<any> {
    try {
      this.validateSwapOrderParams(params);

      logger.info('Creating NEAR swap order', {
        recipient: params.recipient,
        timelockDuration: params.timelockDuration,
        attachedDeposit: params.attachedDeposit.toString()
      });

      const args = {
        recipient: params.recipient,
        hashlock: params.hashlock,
        timelock_duration: params.timelockDuration
      };
      const safeArgs = this.makeJsonSafe(args);
      const result = await withRetry(() => this.nearAccount.functionCall({
        contractId: this.escrowContractId,
        methodName: 'create_swap_order',
        args: safeArgs,
        gas: BigInt('30000000000000'), // 30 TGas
        attachedDeposit: params.attachedDeposit
      }));

      if (result.status && typeof result.status === 'object' && 'SuccessValue' in result.status) {
        logger.info('NEAR swap order created successfully', {
          escrowContractId: this.escrowContractId,
          params: this.sanitizeSwapOrderParamsForLogging(params)
        });
        return result;
      } else {
        throw new ContractError(
          'NEAR swap order creation failed',
          this.escrowContractId,
          'create_swap_order',
          { status: result.status, params: this.sanitizeSwapOrderParamsForLogging(params) }
        );
      }
    } catch (error) {
      if (error instanceof ContractError || error instanceof ValidationError) {
        throw error;
      }
      
      throw new ContractError(
        'Failed to create NEAR swap order',
        this.escrowContractId,
        'create_swap_order',
        { 
          params: this.sanitizeSwapOrderParamsForLogging(params),
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Complete a swap order by revealing the secret
   */
  async completeSwapOrder(orderId: string, secret: string): Promise<any> {
    try {
      if (!orderId || typeof orderId !== 'string') {
        throw ErrorHandler.createValidationError('orderId', orderId, 'Order ID must be a non-empty string');
      }

      if (!secret || typeof secret !== 'string') {
        throw ErrorHandler.createValidationError('secret', secret, 'Secret must be a non-empty string');
      }

      logger.info('Completing NEAR swap order', { orderId });

      const args = {
        order_id: orderId,
        secret: secret
      };
      const safeArgs = this.makeJsonSafe(args);

      const result = await withRetry(() => this.nearAccount.functionCall({
        contractId: this.escrowContractId,
        methodName: 'complete_swap_order',
        args: safeArgs,
        gas: BigInt('30000000000000'), // 30 TGas
        attachedDeposit: BigInt('0')
      }));

      if (result.status && typeof result.status === 'object' && 'SuccessValue' in result.status) {
        logger.info('NEAR swap order completed successfully', { orderId });
        return result;
      } else {
        throw new ContractError(
          'NEAR swap order completion failed',
          this.escrowContractId,
          'complete_swap_order',
          { status: result.status, orderId }
        );
      }
    } catch (error) {
      if (error instanceof ContractError || error instanceof ValidationError) {
        throw error;
      }
      
      throw new ContractError(
        'Failed to complete NEAR swap order',
        this.escrowContractId,
        'complete_swap_order',
        { 
          orderId,
          secret: '***redacted***',
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Refund a swap order after timelock expiry
   */
  async refundSwapOrder(orderId: string): Promise<any> {
    try {
      if (!orderId || typeof orderId !== 'string') {
        throw ErrorHandler.createValidationError('orderId', orderId, 'Order ID must be a non-empty string');
      }

      logger.info('Refunding NEAR swap order', { orderId });

      const args = { order_id: orderId };
      const safeArgs = this.makeJsonSafe(args);

      const result = await withRetry(() => this.nearAccount.functionCall({
        contractId: this.escrowContractId,
        methodName: 'refund_swap_order',
        args: safeArgs,
        gas: BigInt('30000000000000'), // 30 TGas
        attachedDeposit: BigInt('0')
      }));

      if (result.status && typeof result.status === 'object' && 'SuccessValue' in result.status) {
        logger.info('NEAR swap order refunded successfully', { orderId });
        return result;
      } else {
        throw new ContractError(
          'NEAR swap order refund failed',
          this.escrowContractId,
          'refund_swap_order',
          { status: result.status, orderId }
        );
      }
    } catch (error) {
      if (error instanceof ContractError || error instanceof ValidationError) {
        throw error;
      }
      
      throw new ContractError(
        'Failed to refund NEAR swap order',
        this.escrowContractId,
        'refund_swap_order',
        { 
          orderId,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Get escrow details by order ID
   */
  async getEscrowDetails(orderId: string): Promise<NearEscrowDetails | null> {
    try {
      if (!orderId || typeof orderId !== 'string') {
        throw ErrorHandler.createValidationError('orderId', orderId, 'Order ID must be a non-empty string');
      }

      logger.debug('Getting NEAR escrow details', { orderId });

      const result = await (this.nearAccount.connection.provider as any).query({
        request_type: 'call_function',
        finality: 'final',
        account_id: this.escrowContractId,
        method_name: 'get_order',
        args_base64: Buffer.from(JSON.stringify({ order_id: orderId })).toString('base64')
      });

      if (!result || !result.result) {
        logger.warn(`No escrow found with ID ${orderId}`);
        return null;
      }

      // Decode the result
      const decodedResult = Buffer.from(result.result).toString();
      const escrowDetails = JSON.parse(decodedResult);

      logger.debug('Retrieved NEAR escrow details', {
        orderId,
        status: escrowDetails.status,
        amount: escrowDetails.amount
      });

      return escrowDetails as NearEscrowDetails;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      
      // If escrow not found, return null instead of throwing
      if (error instanceof Error && error.message.includes('not found')) {
        logger.debug(`Escrow ${orderId} not found`);
        return null;
      }
      
      throw new ContractError(
        'Failed to get NEAR escrow details',
        this.escrowContractId,
        'get_escrow_details',
        { 
          orderId,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Update escrow status or other properties
   */
  async updateEscrow(orderId: string, updates: NearEscrowUpdateParams): Promise<any> {
    try {
      if (!orderId || typeof orderId !== 'string') {
        throw ErrorHandler.createValidationError('orderId', orderId, 'Order ID must be a non-empty string');
      }

      if (!updates || typeof updates !== 'object') {
        throw ErrorHandler.createValidationError('updates', updates, 'Updates must be an object');
      }

      logger.info('Updating NEAR escrow', { orderId, updates });

      const args = {
        order_id: orderId,
        updates: updates
      };
      const safeArgs = this.makeJsonSafe(args);

      const result = await withRetry(() => this.nearAccount.functionCall({
        contractId: this.escrowContractId,
        methodName: 'update_escrow',
        args: safeArgs,
        gas: BigInt('30000000000000'), // 30 TGas
        attachedDeposit: BigInt('0')
      }));

      if (result.status && typeof result.status === 'object' && 'SuccessValue' in result.status) {
        logger.info('NEAR escrow updated successfully', { orderId });
        return result;
      } else {
        throw new ContractError(
          'NEAR escrow update failed',
          this.escrowContractId,
          'update_escrow',
          { status: result.status, orderId, updates }
        );
      }
    } catch (error) {
      if (error instanceof ContractError || error instanceof ValidationError) {
        throw error;
      }
      
      throw new ContractError(
        'Failed to update NEAR escrow',
        this.escrowContractId,
        'update_escrow',
        { 
          orderId,
          updates,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Find NEAR escrow by secret hash - crucial for Ethereum→NEAR withdrawals
   */
  async findEscrowBySecretHash(secretHash: string): Promise<NearEscrowDetails | null> {
    try {
      this.validator.validateSecretHash(secretHash);

      logger.debug('Searching for NEAR escrow by secret hash', { secretHash });

      // Query the contract for escrows with matching secret hash
      const result = await (this.nearAccount.connection.provider as any).query({
        request_type: 'call_function',
        finality: 'final',
        account_id: this.escrowContractId,
        method_name: 'find_escrow_by_secret_hash',
        args_base64: Buffer.from(JSON.stringify({ secret_hash: secretHash })).toString('base64')
      });

      if (result && result.result) {
        const decodedResult = Buffer.from(result.result).toString();
        const escrowDetails = JSON.parse(decodedResult);
        
        if (escrowDetails) {
          logger.info('Found NEAR escrow with matching secret hash', {
            secretHash,
            orderId: escrowDetails.id
          });
          return escrowDetails as NearEscrowDetails;
        }
      }

      logger.debug('No NEAR escrow found with secret hash', { secretHash });
      return null;
    } catch (error) {
      throw new ContractError(
        'Failed to find NEAR escrow by secret hash',
        this.escrowContractId,
        'find_escrow_by_secret_hash',
        { 
          secretHash,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Find NEAR escrow by initiator and amount
   */
  async findEscrowByInitiator(
    initiator: string,
    amount?: string,
    maxResults: number = 10
  ): Promise<NearEscrowDetails[]> {
    try {
      this.validator.validateNearAccountId(initiator);
      
      if (amount) {
        this.validator.validateAmount(amount);
      }

      logger.debug('Searching for NEAR escrows by initiator', {
        initiator,
        amount,
        maxResults
      });

      const result = await (this.nearAccount.connection.provider as any).query({
        request_type: 'call_function',
        finality: 'final',
        account_id: this.escrowContractId,
        method_name: 'get_orders_by_maker',
        args_base64: Buffer.from(JSON.stringify({
          maker: initiator,
          from_index: 0,
          limit: maxResults
        })).toString('base64')
      }) as any;

      if (result && result.result) {
        const decodedResult = Buffer.from(result.result).toString();
        const escrows = JSON.parse(decodedResult);
        
        let filteredEscrows = escrows;
        
        // Filter by amount if specified
        if (amount) {
          const targetAmount = BigInt(amount);
          filteredEscrows = escrows.filter((escrow: any) => {
            const escrowAmount = BigInt(escrow.amount_in || escrow.amount || '0');
            const tolerance = BigInt('1000000000000000'); // Small tolerance for amount matching
            return escrowAmount >= targetAmount - tolerance && escrowAmount <= targetAmount + tolerance;
          });
        }
        
        logger.info('Found NEAR escrows by initiator', {
          initiator,
          count: filteredEscrows.length
        });
        
        return filteredEscrows as NearEscrowDetails[];
      }

      logger.debug('No NEAR escrows found for initiator', { initiator });
      return [];
    } catch (error) {
      throw new ContractError(
        'Failed to find NEAR escrows by initiator',
        this.escrowContractId,
        'get_orders_by_maker',
        { 
          initiator,
          amount,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Find NEAR escrow by recipient
   */
  async findEscrowByRecipient(
    recipient: string,
    maxResults: number = 10
  ): Promise<NearEscrowDetails[]> {
    try {
      this.validator.validateNearAccountId(recipient);

      logger.debug('Searching for NEAR escrows by recipient', {
        recipient,
        maxResults
      });

      const result = await (this.nearAccount.connection.provider as any).query({
        request_type: 'call_function',
        finality: 'final',
        account_id: this.escrowContractId,
        method_name: 'get_orders_by_taker',
        args_base64: Buffer.from(JSON.stringify({
          taker: recipient,
          from_index: 0,
          limit: maxResults
        })).toString('base64')
      }) as any;

      if (result && result.result) {
        const decodedResult = Buffer.from(result.result).toString();
        const escrows = JSON.parse(decodedResult);
        
        logger.info('Found NEAR escrows by recipient', {
          recipient,
          count: escrows.length
        });
        
        return escrows as NearEscrowDetails[];
      }

      logger.debug('No NEAR escrows found for recipient', { recipient });
      return [];
    } catch (error) {
      throw new ContractError(
        'Failed to find NEAR escrows by recipient',
        this.escrowContractId,
        'get_orders_by_taker',
        { 
          recipient,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Find NEAR escrows by status
   */
  async findEscrowsByStatus(
    status: string,
    maxResults: number = 20
  ): Promise<NearEscrowDetails[]> {
    try {
      if (!status || typeof status !== 'string') {
        throw ErrorHandler.createValidationError('status', status, 'Status must be a non-empty string');
      }

      logger.debug('Searching for NEAR escrows by status', {
        status,
        maxResults
      });

      // Get all recent orders and filter by status
      const result = await (this.nearAccount.connection.provider as any).query({
        request_type: 'call_function',
        finality: 'final',
        account_id: this.escrowContractId,
        method_name: 'get_order_ids',
        args_base64: Buffer.from(JSON.stringify({
          from_index: 0,
          limit: maxResults * 2 // Get more to account for filtering
        })).toString('base64')
      }) as any;

      if (result && result.result) {
        const decodedResult = Buffer.from(result.result).toString();
        const orderIds = JSON.parse(decodedResult);
        
        const matchingEscrows: NearEscrowDetails[] = [];
        
        // Check each order's status
        for (const orderId of orderIds) {
          try {
            const escrowDetails = await this.getEscrowDetails(orderId);
            if (escrowDetails && escrowDetails.status === status) {
              matchingEscrows.push(escrowDetails);
              if (matchingEscrows.length >= maxResults) {
                break;
              }
            }
          } catch (error) {
            logger.debug('Failed to get details for order', {
              orderId,
              error: error instanceof Error ? error.message : String(error)
            });
            continue;
          }
        }
        
        logger.info('Found NEAR escrows by status', {
          status,
          count: matchingEscrows.length
        });
        
        return matchingEscrows;
      }

      logger.debug('No NEAR escrows found with status', { status });
      return [];
    } catch (error) {
      throw new ContractError(
        'Failed to find NEAR escrows by status',
        this.escrowContractId,
        'find_escrows_by_status',
        { 
          status,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Get the overall state of the escrow contract
   */
  async getEscrowContractState(): Promise<any> {
    try {
      const result = await (this.nearAccount.connection.provider as any).query({
        request_type: 'call_function',
        finality: 'final',
        account_id: this.escrowContractId,
        method_name: 'get_contract_state',
        args_base64: Buffer.from(JSON.stringify({})).toString('base64')
      }) as any;

      if (result && result.result) {
        const decodedResult = Buffer.from(result.result).toString();
        return JSON.parse(decodedResult);
      }

      return null;
    } catch (error) {
      throw new ContractError(
        'Failed to get NEAR escrow contract state',
        this.escrowContractId,
        'get_contract_state',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  // Private helper methods

  private validateConstructorParams(nearAccount: NearAccount, escrowContractId: string): void {
    if (!nearAccount) {
      throw ErrorHandler.createValidationError('nearAccount', nearAccount, 'NEAR account is required');
    }

    if (!nearAccount.accountId) {
      throw ErrorHandler.createValidationError('nearAccount.accountId', nearAccount.accountId, 'NEAR account ID is required');
    }

    if (!nearAccount.connection || !nearAccount.connection.provider) {
      throw ErrorHandler.createValidationError('nearAccount.connection', nearAccount.connection, 'NEAR account connection is required');
    }

    this.validator.validateNearAccountId(escrowContractId);
  }

  private validateSwapOrderParams(params: NearSwapOrderParams): void {
    if (!params || typeof params !== 'object') {
      throw ErrorHandler.createValidationError('params', params, 'Swap order parameters must be an object');
    }

    this.validator.validateNearAccountId(params.recipient);
    this.validator.validateSecretHash(params.hashlock);

    if (typeof params.timelockDuration !== 'number' || params.timelockDuration <= 0) {
      throw ErrorHandler.createValidationError('timelockDuration', params.timelockDuration, 'Timelock duration must be a positive number');
    }

    if (typeof params.attachedDeposit !== 'bigint' || params.attachedDeposit <= BigInt(0)) {
      throw ErrorHandler.createValidationError('attachedDeposit', params.attachedDeposit, 'Attached deposit must be a positive bigint');
    }
  }

  private async getGenericContractInfo(contractId: string): Promise<any> {
    try {
      // Get basic contract information
      const account = await (this.nearAccount.connection.provider as any).query({
        request_type: 'view_account',
        finality: 'final',
        account_id: contractId
      });

      return {
        accountId: contractId,
        ...account
      };
    } catch (error) {
      throw new ContractError(
        'Failed to get contract info',
        contractId,
        'view_account',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private sanitizeArgsForLogging(args: any): any {
    if (!args || typeof args !== 'object') {
      return args;
    }

    // First make JSON-safe (convert BigInt to strings recursively)
    const sanitized = this.makeJsonSafe({ ...args });
    
    // Remove or redact sensitive fields
    if ((sanitized as any).secret) {
      (sanitized as any).secret = '***redacted***';
    }
    
    if ((sanitized as any).private_key) {
      (sanitized as any).private_key = '***redacted***';
    }

    return sanitized;
  }

  // Recursively convert any BigInt values to strings so args are JSON-serializable
  private makeJsonSafe(value: any): any {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.makeJsonSafe(v));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = this.makeJsonSafe(v);
      }
      return out;
    }
    return value;
  }

  private sanitizeSwapOrderParamsForLogging(params: NearSwapOrderParams): any {
    return {
      recipient: params.recipient,
      hashlock: params.hashlock,
      timelockDuration: params.timelockDuration,
      attachedDeposit: params.attachedDeposit.toString()
    };
  }
}
