import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { InMemoryKeyStore } from '@near-js/keystores';
import { KeyPair } from '@near-js/crypto';
import { logger } from '../utils/logger.js';
import { PartialFillParams, OrderState } from '../types/interfaces.js';
import { withRetry } from '../utils/retry.js';
import { ethers } from 'ethers';

export class NearPartialFillService {
  private nearAccount: Account;
  private provider: JsonRpcProvider;
  private contractId: string;

  constructor(nearAccount: Account, provider: JsonRpcProvider, contractId: string) {
    this.nearAccount = nearAccount;
    this.provider = provider;
    this.contractId = contractId;
  }

  /**
   * Process a partial fill for a NEAR order
   */
  async processPartialFill(params: PartialFillParams): Promise<boolean> {
    try {
      logger.info(`Processing partial fill for order ${params.orderId}`, { params });
      
      // Call the NEAR contract to process the partial fill
      const result = await withRetry(() => this.nearAccount.functionCall({
        contractId: this.contractId,
        methodName: 'process_partial_fill',
        args: {
          order_id: params.orderId,
          fill_amount: params.fillAmount,
          recipient: params.recipient,
          token: params.token,
          min_fill_percent: params.minFillPercent || 10, // Default 10%
          max_fills: params.maxFills || 10, // Default 10 fills max
        },
        gas: BigInt('300000000000000'), // 300 TGas
        attachedDeposit: BigInt(0),
      }));
      
      logger.info(`Partial fill processed for order ${params.orderId}`, { result });
      return true;
    } catch (error) {
      logger.error(`Failed to process partial fill for order ${params.orderId}`, { error });
      throw error;
    }
  }

  /**
   * Split a NEAR order into multiple child orders
   */
  async splitOrder(orderId: string, amounts: string[]): Promise<{ orderIds: string[] }> {
    try {
      logger.info(`Splitting order ${orderId} into ${amounts.length} parts`);
      
      const result = await withRetry(() => this.nearAccount.functionCall({
        contractId: this.contractId,
        methodName: 'split_order',
        args: {
          order_id: orderId,
          amounts,
        },
        gas: BigInt('300000000000000'), // 300 TGas
        attachedDeposit: BigInt(0),
      }));
      
      logger.info(`Order ${orderId} split successfully`, { result });
      // Type cast the result to the expected structure
      const splitResult = result as any;
      return { orderIds: splitResult.orderIds || [] };
    } catch (error) {
      logger.error(`Failed to split order ${orderId}`, { error });
      throw error;
    }
  }

  /**
   * Process refund for an unfilled portion of an order
   */
  async processRefund(orderId: string, recipient: string): Promise<boolean> {
    try {
      logger.info(`Processing refund for order ${orderId} to ${recipient}`);
      
      const result = await withRetry(() => this.nearAccount.functionCall({
        contractId: this.contractId,
        methodName: 'process_refund',
        args: {
          order_id: orderId,
          recipient,
        },
        gas: BigInt('200000000000000'), // 200 TGas
        attachedDeposit: BigInt(0),
      }));
      
      logger.info(`Refund processed for order ${orderId}`, { result });
      return true;
    } catch (error) {
      logger.error(`Failed to process refund for order ${orderId}`, { error });
      throw error;
    }
  }

  /**
   * Get the current state of an order
   */
  async getOrderState(orderId: string): Promise<OrderState> {
    try {
      const result = await withRetry(() => this.provider.callFunction(
        this.contractId,
        'get_order_state',
        { order_id: orderId }
      ));
      
      if (!result) {
        throw new Error(`Failed to get order state for ${orderId}`);
      }
      
      // Type cast the result to the expected structure
      const orderData = result as any;
      
      return {
        filledAmount: orderData.filled_amount,
        remainingAmount: orderData.remaining_amount,
        fillCount: orderData.fill_count,
        isFullyFilled: orderData.is_fully_filled,
        isCancelled: orderData.is_cancelled,
        lastFillTimestamp: orderData.last_fill_timestamp,
        childOrders: orderData.child_orders || [],
      };
    } catch (error) {
      logger.error(`Failed to get state for order ${orderId}`, { error });
      throw error;
    }
  }

  /**
   * Check if an order can be partially filled
   */
  async canPartiallyFill(orderId: string, amount: string): Promise<boolean> {
    try {
      const state = await this.getOrderState(orderId);
      
      // Check if order is already fully filled or cancelled
      if (state.isFullyFilled || state.isCancelled) {
        return false;
      }
      
      // Convert amounts to BigNumber for comparison
      const remaining = ethers.BigNumber.from(state.remainingAmount);
      const fillAmount = ethers.BigNumber.from(amount);
      
      // Check if requested amount is available
      if (fillAmount.gt(remaining)) {
        return false;
      }
      
      // Check minimum fill percentage (default 10%)
      const minFillAmount = remaining.div(10); // 10%
      if (fillAmount.lt(minFillAmount)) {
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error(`Error checking partial fill eligibility for order ${orderId}`, { error });
      return false;
    }
  }
}
