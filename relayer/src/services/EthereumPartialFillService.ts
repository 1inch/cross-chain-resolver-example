import { BigNumber, ethers } from 'ethers';
import { logger } from '../utils/logger.js';

export interface PartialFillParams {
  orderHash: string;
  fillAmount: string;
  recipient: string;
  token: string;
  minFillPercent?: number;
  maxFills?: number;
}

export interface OrderState {
  filledAmount: string;
  remainingAmount: string;
  fillCount: number;
  isFullyFilled: boolean;
  isCancelled: boolean;
  lastFillTimestamp: number;
  childOrders: string[];
}

export class EthereumPartialFillService {
  private readonly provider: ethers.providers.Provider;
  private readonly signer: ethers.Signer;
  private readonly resolverAddress: string;
  private readonly resolverAbi: any[];
  private readonly ethersLike: any;
  
  constructor(
    provider: ethers.providers.Provider,
    signer: ethers.Signer,
    resolverAddress: string,
    resolverAbi: any[],
    deps?: { ethersLike?: any }
  ) {
    this.provider = provider;
    this.signer = signer;
    this.resolverAddress = resolverAddress;
    this.resolverAbi = resolverAbi;
    this.ethersLike = deps?.ethersLike ?? ethers;
  }

  /**
   * Process a partial fill for an Ethereum order
   */
  async processPartialFill(params: PartialFillParams): Promise<ethers.ContractTransaction> {
    try {
      logger.info(`Processing partial fill for order ${params.orderHash}`, { params });
      
      const resolver = new this.ethersLike.Contract(
        this.resolverAddress,
        this.resolverAbi,
        this.signer
      );
      
      const tx = await resolver.processPartialFill(
        params.orderHash,
        params.fillAmount,
        params.recipient,
        params.token,
        params.minFillPercent || 10, // Default 10%
        params.maxFills || 10, // Default 10 fills max
        { gasLimit: 500000 } // Sufficient gas for partial fill
      );
      
      logger.info(`Partial fill transaction sent for order ${params.orderHash}`, { txHash: tx.hash });
      return tx;
    } catch (error) {
      logger.error(`Failed to process partial fill for order ${params.orderHash}`, { error });
      throw error;
    }
  }

  /**
   * Split an Ethereum order into multiple child orders
   */
  async splitOrder(orderHash: string, amounts: string[]): Promise<ethers.ContractTransaction> {
    try {
      logger.info(`Splitting order ${orderHash} into ${amounts.length} parts`);
      
      const resolver = new this.ethersLike.Contract(
        this.resolverAddress,
        this.resolverAbi,
        this.signer
      );
      
      const tx = await resolver.splitOrder(orderHash, amounts, { gasLimit: 300000 });
      
      logger.info(`Order split transaction sent for ${orderHash}`, { txHash: tx.hash });
      return tx;
    } catch (error) {
      logger.error(`Failed to split order ${orderHash}`, { error });
      throw error;
    }
  }

  /**
   * Process refund for an unfilled portion of an order
   */
  async processRefund(orderHash: string, recipient: string): Promise<ethers.ContractTransaction> {
    try {
      logger.info(`Processing refund for order ${orderHash} to ${recipient}`);
      
      const resolver = new this.ethersLike.Contract(
        this.resolverAddress,
        this.resolverAbi,
        this.signer
      );
      
      const tx = await resolver.processRefund(orderHash, recipient, { gasLimit: 200000 });
      
      logger.info(`Refund transaction sent for order ${orderHash}`, { txHash: tx.hash });
      return tx;
    } catch (error) {
      logger.error(`Failed to process refund for order ${orderHash}`, { error });
      throw error;
    }
  }

  /**
   * Get the current state of an order
   */
  async getOrderState(orderHash: string): Promise<OrderState> {
    try {
      const resolver = new this.ethersLike.Contract(
        this.resolverAddress,
        this.resolverAbi,
        this.provider
      );
      
      const state = await resolver.getOrderState(orderHash);
      
      // Support both tuple (array) and object return shapes
      if (Array.isArray(state)) {
        const [
          filledAmount,
          remainingAmount,
          fillCount,
          isFullyFilled,
          isCancelled,
          lastFillTimestamp,
          childOrders,
        ] = state;
        return {
          filledAmount: BigNumber.from(filledAmount).toString(),
          remainingAmount: BigNumber.from(remainingAmount).toString(),
          fillCount: typeof fillCount === 'number' ? fillCount : BigNumber.from(fillCount).toNumber(),
          isFullyFilled: Boolean(isFullyFilled),
          isCancelled: Boolean(isCancelled),
          lastFillTimestamp:
            typeof lastFillTimestamp === 'number'
              ? lastFillTimestamp
              : BigNumber.from(lastFillTimestamp).toNumber(),
          childOrders: Array.isArray(childOrders) ? childOrders : [],
        };
      }

      // Object shape
      return {
        filledAmount: BigNumber.from(state.filledAmount).toString(),
        remainingAmount: BigNumber.from(state.remainingAmount).toString(),
        fillCount:
          typeof state.fillCount === 'number'
            ? state.fillCount
            : BigNumber.from(state.fillCount).toNumber(),
        isFullyFilled: Boolean(state.isFullyFilled),
        isCancelled: Boolean(state.isCancelled),
        lastFillTimestamp:
          typeof state.lastFillTimestamp === 'number'
            ? state.lastFillTimestamp
            : BigNumber.from(state.lastFillTimestamp).toNumber(),
        childOrders: state.childOrders || [],
      };
    } catch (error) {
      logger.error(`Failed to get state for order ${orderHash}`, { error });
      throw error;
    }
  }

  /**
   * Check if an order can be partially filled
   */
  async canPartiallyFill(orderHash: string, amount: string): Promise<boolean> {
    try {
      const state = await this.getOrderState(orderHash);
      
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
      logger.error(`Error checking partial fill eligibility for order ${orderHash}`, { error });
      return false;
    }
  }

  /**
   * Estimate gas for a partial fill
   */
  async estimateGasForPartialFill(params: PartialFillParams): Promise<ethers.BigNumber> {
    try {
      const resolver = new this.ethersLike.Contract(
        this.resolverAddress,
        this.resolverAbi,
        this.provider
      );
      
      const estimatedGas = await resolver.estimateGas.processPartialFill(
        params.orderHash,
        params.fillAmount,
        params.recipient,
        params.token,
        params.minFillPercent || 10,
        params.maxFills || 10
      );
      
      // Add 20% buffer for safety
      return estimatedGas.mul(120).div(100);
    } catch (error) {
      logger.error(`Failed to estimate gas for partial fill`, { error });
      throw error;
    }
  }
}
