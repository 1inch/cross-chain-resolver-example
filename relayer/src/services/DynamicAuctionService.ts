/**
 * Dynamic Auction Service - 1inch Fusion+ Style
 * Implements dynamic pricing curves and auction mechanics for cross-chain transfers
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

export interface AuctionPoint {
  /**
   * Delay in seconds relative to the previous point (or auction start for first point)
   */
  delay: number;
  /**
   * Rate bump coefficient in basis points (1e6 = 100%)
   * Defines the rate bump at this point in the auction
   */
  coefficient: number;
}

export interface AuctionConfig {
  /**
   * Total auction duration in seconds (60-300 seconds recommended)
   */
  duration: number;
  /**
   * Initial rate bump in basis points (1e6 = 100%)
   * This is the starting premium for the auction
   */
  initialRateBump: number;
  /**
   * Array of points defining the auction price curve
   * Must be sorted by delay in ascending order
   */
  points: AuctionPoint[];
  /**
   * Gas bump estimate in basis points (1e6 = 100%)
   * Covers gas costs for the transaction
   */
  gasBumpEstimate: number;
  /**
   * Estimated gas price in Gwei
   * Used for calculating gas costs
   */
  gasPriceEstimate: number;
  /**
   * Minimum fill percentage (0-1)
   * Prevents tiny fills that may not be worth the gas
   */
  minFillPercentage?: number;
  /**
   * Maximum rate bump (1e6 = 100%)
   * Safety limit to prevent excessive rates
   */
  maxRateBump?: number;
}

export interface CrossChainAuctionParams {
  fromChain: 'NEAR' | 'ETH';
  toChain: 'ETH' | 'NEAR';
  fromAmount: string;
  baseExchangeRate: number; // base rate (e.g., 1 NEAR = 0.001 ETH)
  startTime: number; // unix timestamp
  orderId: string;
}

export interface AuctionResult {
  currentRate: ethers.BigNumber;
  outputAmount: string;
  feeAmount: string;
  totalCost: string;
  timeRemaining: number;
  isExpired: boolean;
}

export interface AuctionState {
  auctionId: string;
  status: 'active' | 'filled' | 'expired' | 'cancelled';
  startTime: number;
  endTime: number;
  currentRate: number;
  filledAmount: string;
  remainingAmount: string;
  statusCode: number;
}

export class DynamicAuctionService {
  // Default configuration aligned with 1inch Fusion+ recommendations
  private readonly defaultConfig: Required<AuctionConfig> = {
    duration: 180, // 3 minutes
    initialRateBump: 50000, // 0.5% initial bump (50000 = 0.5% in 1e8 precision)
    points: [
      { delay: 30, coefficient: 40000 },  // 0.4% after 30s
      { delay: 60, coefficient: 30000 },  // 0.3% after 90s
      { delay: 90, coefficient: 20000 }   // 0.2% after 180s (end of auction)
    ],
    gasBumpEstimate: 5000,  // 0.05% for gas costs (aligned with 1inch)
    gasPriceEstimate: 20,   // 20 Gwei
    minFillPercentage: 0.1, // 10% minimum fill
    maxRateBump: 500000     // 5% maximum rate bump (safety limit)
  };
  
  // Gas limits for different operations (in wei)
  private readonly GAS_LIMITS = {
    ETH_TRANSFER: 21000,
    TOKEN_APPROVAL: 45000,
    SWAP: 180000,
    DEPOSIT: 100000,
    WITHDRAW: 100000,
    // Additional gas costs for cross-chain operations
    CROSS_CHAIN_BASE: 50000,
    // Gas per byte for calldata (approximate)
    PER_BYTE: 16,
    // Additional gas for complex operations
    COMPLEX_OPERATION: 30000
  };

  /**
   * Create a new cross-chain auction with 1inch Fusion+ compatible parameters
   * @param params Cross-chain auction parameters
   * @param config Optional configuration overrides
   * @param maxRetries Maximum number of retry attempts (default: 3)
   * @param retryDelayMs Delay between retries in milliseconds (default: 1000)
   * @returns Auction ID for tracking
   * @throws Error if parameters are invalid or max retries exceeded
   */
  async createAuction(
    params: CrossChainAuctionParams, 
    config?: Partial<AuctionConfig>,
    maxRetries = 3,
    retryDelayMs = 1000
  ): Promise<string> {
    let attempts = 0;
    let lastError: Error | null = null;
    
    while (attempts < maxRetries) {
      try {
        // Merge with defaults and validate
        const auctionConfig: Required<AuctionConfig> = { 
          ...this.defaultConfig, 
          ...config 
        };
        
        // Validate auction parameters
        this.validateAuctionParams(params, auctionConfig);
        
        logger.info('Creating 1inch Fusion+ compatible auction', {
          orderId: params.orderId,
          fromChain: params.fromChain,
          toChain: params.toChain,
          fromAmount: params.fromAmount,
          baseRate: params.baseExchangeRate,
          duration: auctionConfig.duration,
          startTime: new Date(params.startTime * 1000).toISOString(),
          attempt: attempts + 1,
          maxRetries
        });
        
        // Calculate initial rate and gas cost with error handling
        const initialRate = await this.withRetry(
          () => this.calculateInitialRate(params, auctionConfig),
          `Failed to calculate initial rate for order ${params.orderId}`,
          maxRetries,
          retryDelayMs
        );
        
        const gasCost = await this.withRetry(
          () => this.estimateGasCost(params, auctionConfig),
          `Failed to estimate gas cost for order ${params.orderId}`,
          maxRetries,
          retryDelayMs
        );
        
        // Store auction data (in production, use persistent storage)
        const auctionData = {
          ...params,
          config: auctionConfig,
          initialRate,
          gasCost,
          createdAt: Date.now()
        };
        
        // In a real implementation, store this in a database
        await this.logAuctionCreation(auctionData);
        
        // Return auction ID for tracking
        return `auction_${params.orderId}_${Date.now()}`;
        
      } catch (error) {
        attempts++;
        lastError = error as Error;
        
        logger.warn(`Auction creation attempt ${attempts} failed`, {
          orderId: params.orderId,
          error: error instanceof Error ? error.message : String(error),
          retryIn: `${retryDelayMs}ms`,
          attemptsRemaining: maxRetries - attempts
        });
        
        if (attempts < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    
    // If we get here, all retry attempts have failed
    throw new Error(
      `Failed to create auction after ${maxRetries} attempts. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Calculate current auction rate and output amount based on 1inch Fusion+ mechanism
   * @param params Cross-chain auction parameters
   * @param config Optional configuration overrides
   * @returns Auction result with current rate and amounts
   */
  calculateCurrentRate(
    params: CrossChainAuctionParams, 
    config?: Partial<AuctionConfig>
  ): AuctionResult {
    const auctionConfig: Required<AuctionConfig> = { 
      ...this.defaultConfig, 
      ...config 
    };
    
    const currentTime = Math.floor(Date.now() / 1000);
    const elapsedTime = currentTime - params.startTime;
    
    // Check if auction is expired
    if (elapsedTime >= auctionConfig.duration) {
      return this.getExpiredAuctionResult(params, auctionConfig);
    }
    
    try {
      // Calculate rate bump based on time and curve
      const rateBump = this.calculateRateBump(elapsedTime, auctionConfig);
      
      // Apply rate bump to base exchange rate (1inch uses 1e18 precision)
      const rateMultiplier = ethers.BigNumber.from(1_000_000 + rateBump);
      const adjustedRate = ethers.BigNumber.from(
        Math.floor(params.baseExchangeRate * 1_000_000)
      ).mul(rateMultiplier).div(1_000_000);
      
      // Calculate output amount with precise decimal handling
      const fromAmountBN = ethers.BigNumber.isBigNumber(params.fromAmount) 
        ? params.fromAmount 
        : ethers.BigNumber.from(params.fromAmount);
        
      const outputAmount = this.calculateOutputAmount(fromAmountBN, adjustedRate, params);
      
      // Calculate fees (gas cost + security deposit)
      const gasCost = this.estimateGasCost(params, auctionConfig);
      const securityDeposit = outputAmount.div(20); // 5% security deposit (aligned with 1inch)
      const totalFee = gasCost.add(securityDeposit);
      const totalCost = outputAmount.add(totalFee);
      
      // Enforce minimum fill amount
      const minFillPctScaled = Math.floor((auctionConfig.minFillPercentage ?? 0) * 100);
      const minFillFromAmount = fromAmountBN.mul(minFillPctScaled).div(100);
      const minFillOutputAmount = this.calculateOutputAmount(minFillFromAmount, adjustedRate, params);
      if (outputAmount.lt(minFillOutputAmount)) {
        throw new Error(`Fill amount too small. Minimum: ${minFillOutputAmount.toString()}`);
      }
      
      logger.debug('1inch Fusion+ auction rate calculation', {
        orderId: params.orderId,
        elapsedTime: `${elapsedTime}s`,
        rateBump: `${(rateBump / 100).toFixed(2)}%`,
        adjustedRate: adjustedRate.toString(),
        outputAmount: ethers.utils.formatUnits(outputAmount, 18),
        gasCost: ethers.utils.formatEther(gasCost),
        securityDeposit: ethers.utils.formatEther(securityDeposit),
        totalCost: ethers.utils.formatEther(totalCost)
      });
      
      return {
        currentRate: adjustedRate,
        outputAmount: outputAmount.toString(),
        feeAmount: totalFee.toString(),
        totalCost: totalCost.toString(),
        timeRemaining: Math.max(0, auctionConfig.duration - elapsedTime),
        isExpired: false
      };
      
    } catch (error) {
      logger.error('Error calculating auction rate:', {
        error: error instanceof Error ? error.message : String(error),
        orderId: params.orderId,
        elapsedTime
      });
      throw error;
    }
  }

  /**
   * Validate auction parameters according to 1inch Fusion+ standards
   * @param params Cross-chain auction parameters
   * @param config Auction configuration
   * @throws Error if any parameter is invalid
   */
  private validateAuctionParams(
    params: CrossChainAuctionParams,
    config: Required<AuctionConfig>
  ): void {
    // Validate chain parameters
    if (!['NEAR', 'ETH'].includes(params.fromChain)) {
      throw new Error(`Invalid fromChain: ${params.fromChain}. Must be 'NEAR' or 'ETH'`);
    }
    
    if (!['NEAR', 'ETH'].includes(params.toChain)) {
      throw new Error(`Invalid toChain: ${params.toChain}. Must be 'NEAR' or 'ETH'`);
    }
    
    if (params.fromChain === params.toChain) {
      throw new Error('Source and destination chains must be different');
    }
    
    // Validate order ID
    if (!params.orderId || typeof params.orderId !== 'string') {
      throw new Error('Order ID is required and must be a string');
    }
    
    // Validate amounts and rates
    let fromAmount: ethers.BigNumber;
    try {
      fromAmount = ethers.BigNumber.isBigNumber(params.fromAmount)
        ? params.fromAmount
        : ethers.BigNumber.from(params.fromAmount);
        
      if (fromAmount.lte(0)) {
        throw new Error('From amount must be positive');
      }
    } catch (e) {
      throw new Error(`Invalid fromAmount: ${params.fromAmount}. Must be a valid number or BigNumber string`);
    }
    
    if (typeof params.baseExchangeRate !== 'number' || params.baseExchangeRate <= 0) {
      throw new Error('Base exchange rate must be a positive number');
    }
    
    // Validate timestamps
    const currentTime = Math.floor(Date.now() / 1000);
    const maxStartTimeDrift = 300; // 5 minutes
    
    if (params.startTime > currentTime + maxStartTimeDrift) {
      throw new Error('Start time cannot be more than 5 minutes in the future');
    }
    
    if (params.startTime < currentTime - config.duration) {
      throw new Error('Auction has already expired based on start time and duration');
    }
    
    // Validate auction configuration
    if (config.duration < 30 || config.duration > 300) {
      throw new Error('Auction duration must be between 30 and 300 seconds');
    }
    
    if (config.initialRateBump < 0 || config.initialRateBump > 1_000_000) {
      throw new Error('Initial rate bump must be between 0 and 1,000,000 (0% to 100%)');
    }
    
    if (config.maxRateBump < config.initialRateBump || config.maxRateBump > 1_000_000) {
      throw new Error('Max rate bump must be between initialRateBump and 1,000,000 (100%)');
    }
    
    if (config.gasBumpEstimate < 0 || config.gasBumpEstimate > 100_000) {
      throw new Error('Gas bump estimate must be between 0 and 100,000 (0% to 10%)');
    }
    
    if (config.gasPriceEstimate <= 0) {
      throw new Error('Gas price estimate must be positive');
    }
    
    if (config.minFillPercentage < 0 || config.minFillPercentage > 1) {
      throw new Error('Minimum fill percentage must be between 0 and 1');
    }
    
    // Validate auction curve points
    if (!Array.isArray(config.points) || config.points.length === 0) {
      throw new Error('Auction curve points must be a non-empty array');
    }
    
    let lastDelay = -1;
    for (let i = 0; i < config.points.length; i++) {
      const point = config.points[i];
      
      if (point.delay <= lastDelay) {
        throw new Error('Auction points must be in ascending order by delay');
      }
      lastDelay = point.delay;
      
      if (point.coefficient < 0 || point.coefficient > 1_000_000) {
        throw new Error(`Point at index ${i} has invalid coefficient. Must be between 0 and 1,000,000`);
      }
      
      if (point.delay < 0 || point.delay > config.duration) {
        throw new Error(`Point at index ${i} has invalid delay. Must be between 0 and ${config.duration}`);
      }
    }
    
    logger.debug('Auction parameters validated successfully', { orderId: params.orderId });
  }
  
  /**
   * Calculate the initial rate for the auction
   */
  private calculateInitialRate(
    params: CrossChainAuctionParams,
    config: Required<AuctionConfig>
  ): ethers.BigNumber {
    // Apply initial rate bump to base exchange rate (1e18 precision)
    const rateWithBump = ethers.BigNumber.from(Math.floor(params.baseExchangeRate * 1_000_000))
      .mul(1_000_000 + config.initialRateBump)
      .div(1_000_000);
      
    return rateWithBump;
  }
  
  /**
   * Dynamically estimate gas cost for the cross-chain operation
   * Based on 1inch Fusion+ gas estimation model
   */
  private estimateGasCost(
    params: CrossChainAuctionParams,
    config: Required<AuctionConfig>
  ): ethers.BigNumber {
    // Base gas cost for the operation
    let gasEstimate = this.GAS_LIMITS.CROSS_CHAIN_BASE;
    
    // Add gas based on operation type
    if (params.fromChain === 'NEAR' && params.toChain === 'ETH') {
      // NEAR → ETH: Deposit + Swap + Withdraw
      gasEstimate += this.GAS_LIMITS.DEPOSIT + this.GAS_LIMITS.SWAP + this.GAS_LIMITS.WITHDRAW;
    } else if (params.fromChain === 'ETH' && params.toChain === 'NEAR') {
      // ETH → NEAR: Approve + Deposit + Swap
      gasEstimate += this.GAS_LIMITS.TOKEN_APPROVAL + this.GAS_LIMITS.DEPOSIT + this.GAS_LIMITS.SWAP;
    }
    
    // Add gas for calldata (approximate)
    const calldataSize = JSON.stringify(params).length;
    gasEstimate += calldataSize * this.GAS_LIMITS.PER_BYTE;
    
    // Add buffer for complex operations and auction logic
    gasEstimate += this.GAS_LIMITS.COMPLEX_OPERATION;
    
    // Apply gas bump from config (if any)
    const gasWithBump = gasEstimate * (1 + (config.gasBumpEstimate / 1_000_000));
    
    // Calculate total gas cost in wei
    const gasPriceWei = ethers.utils.parseUnits(config.gasPriceEstimate.toString(), 'gwei');
    const totalGasCost = ethers.BigNumber.from(Math.ceil(gasWithBump)).mul(gasPriceWei);
    
    logger.debug('Estimated gas cost', {
      operation: `${params.fromChain}→${params.toChain}`,
      gasEstimate,
      gasWithBump: Math.ceil(gasWithBump),
      gasPriceGwei: config.gasPriceEstimate,
      totalGasCost: ethers.utils.formatEther(totalGasCost),
      orderId: params.orderId
    });
    
    return totalGasCost;
    // Base gas cost for the operation
    let gasCost = ethers.BigNumber.from(150_000); // Base gas for contract calls
    
    // Add gas cost based on operation type and chain
    if (params.toChain === 'ETH') {
      // Ethereum gas price is higher, add more buffer
      gasCost = gasCost.add(50_000);
    }
    
    // Apply current gas price (in wei) and convert to token amount
    const gasPrice = ethers.utils.parseUnits(config.gasPriceEstimate.toString(), 'gwei');
    return gasCost.mul(gasPrice);
  }
  
  /**
   * Execute a function with retry logic
   * @param fn Function to execute
   * @param errorMessage Error message prefix
   * @param maxRetries Maximum number of retry attempts
   * @param retryDelayMs Delay between retries in milliseconds
   * @returns Promise that resolves with the function result
   */
  private async withRetry<T>(
    fn: () => Promise<T> | T,
    errorMessage: string,
    maxRetries = 3,
    retryDelayMs = 1000
  ): Promise<T> {
    let attempts = 0;
    let lastError: Error | null = null;
    
    while (attempts < maxRetries) {
      try {
        return await fn();
      } catch (error) {
        attempts++;
        lastError = error as Error;
        
        if (attempts < maxRetries) {
          logger.warn(`${errorMessage} (attempt ${attempts}/${maxRetries})`, {
            error: lastError.message,
            retryIn: `${retryDelayMs}ms`
          });
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    
    throw new Error(`${errorMessage} after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }
  
  /**
   * Calculate the current rate bump based on elapsed time and auction curve
   */
  private calculateRateBump(elapsedTime: number, config: Required<AuctionConfig>): number {
    if (elapsedTime <= 0) return config.initialRateBump;
    if (elapsedTime >= config.duration) return config.maxRateBump;
    
    // Start with initial rate bump
    let currentRateBump = config.initialRateBump;
    let timeAccumulator = 0;

    // Apply curve points with interpolation
    for (const point of config.points) {
      timeAccumulator += point.delay;
      
      if (elapsedTime >= timeAccumulator) {
        currentRateBump = point.coefficient;
      } else {
        // Interpolate between current and next point
        const prevTime = timeAccumulator - point.delay;
        const progress = (elapsedTime - prevTime) / point.delay;
        const prevRateBump = currentRateBump;
        currentRateBump = prevRateBump + (point.coefficient - prevRateBump) * progress;
        break;
      }
    }

    // Add gas cost bump
    currentRateBump += config.gasBumpEstimate;
    
    // Ensure we don't exceed maximum rate bump
    return Math.min(currentRateBump, config.maxRateBump);
  }

  /**
   * Log auction creation details
   */
  private async logAuctionCreation(auctionData: any): Promise<void> {
    try {
      // In a real implementation, this would write to a database
      logger.info('Auction created', {
        orderId: auctionData.orderId,
        fromChain: auctionData.fromChain,
        toChain: auctionData.toChain,
        fromAmount: auctionData.fromAmount,
        initialRate: auctionData.initialRate?.toString(),
        gasCost: auctionData.gasCost?.toString(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      // Don't fail the auction creation if logging fails, but log the error
      logger.error('Failed to log auction creation', {
        orderId: auctionData.orderId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Calculate output amount based on input amount and exchange rate
   * @param fromAmount Input amount as BigNumber
   * @param rate Exchange rate as BigNumber (1e18 precision)
   * @param params Cross-chain auction parameters
   * @returns Output amount as BigNumber
   */
  private calculateOutputAmount(
    fromAmount: ethers.BigNumber,
    rate: ethers.BigNumber | number,
    params: CrossChainAuctionParams
  ): ethers.BigNumber {
    // Ensure rate is a BigNumber
    const rateBN = ethers.BigNumber.isBigNumber(rate) 
      ? rate 
      : ethers.BigNumber.from(Math.floor(Number(rate) * 1_000_000));
    
    // Calculate output amount with proper decimal handling
    const PRECISION = ethers.BigNumber.from(1_000_000);
    let outputAmount = fromAmount.mul(rateBN).div(PRECISION);
    
    // Apply chain-specific decimal adjustments
    const fromDecimals = params.fromChain === 'NEAR' ? 24 : 18;
    const toDecimals = params.toChain === 'NEAR' ? 24 : 18;
    
    if (fromDecimals > toDecimals) {
      // Convert to fewer decimals (e.g., NEAR → ETH)
      const decimalDiff = fromDecimals - toDecimals;
      outputAmount = outputAmount.div(ethers.BigNumber.from(10).pow(decimalDiff));
    } else if (toDecimals > fromDecimals) {
      // Convert to more decimals (e.g., ETH → NEAR)
      const decimalDiff = toDecimals - fromDecimals;
      outputAmount = outputAmount.mul(ethers.BigNumber.from(10).pow(decimalDiff));
    }

    return outputAmount;
  }

  /**
   * Get result for expired auction
   */
  private getExpiredAuctionResult(
    params: CrossChainAuctionParams,
    config: Required<AuctionConfig>
  ): AuctionResult {
    logger.warn('Auction expired', {
      orderId: params.orderId,
      elapsedTime: Math.floor(Date.now() / 1000) - params.startTime,
      duration: config.duration,
    });

    // Return zero amounts for expired auction
    return {
      currentRate: ethers.BigNumber.from(0),
      outputAmount: '0',
      feeAmount: '0',
      totalCost: '0',
      timeRemaining: 0,
      isExpired: true,
    };
  }

  /**
   * Get the current state of an auction
   */
  public getAuctionState(auctionId: string): AuctionState {
    // In a real implementation, this would fetch the current state from a database or blockchain
    // For now, return a mock state
    return {
      auctionId,
      status: 'active',
      startTime: Math.floor(Date.now() / 1000) - 60, // Started 1 minute ago
      endTime: Math.floor(Date.now() / 1000) + 300, // Ends in 5 minutes
      currentRate: 1.0,
      filledAmount: '0',
      remainingAmount: '1000000',
      statusCode: 200
    };
  }

  /**
   * Calculate the optimal execution time for an auction
   */
  private getOptimalExecutionTime(
    params: CrossChainAuctionParams & { duration?: number },
    targetProfitBps: number,
    volatilityBps: number
  ): number {
    // Simple implementation - return midpoint of auction
    // In a real implementation, this would use more sophisticated logic
    // based on market conditions and historical data
    const currentTime = Math.floor(Date.now() / 1000);
    const timeElapsed = currentTime - params.startTime;
    const auctionDuration = params.duration || 180; // Default to 3 minutes if not specified
    const endTime = params.startTime + auctionDuration;
    const timeRemaining = endTime - currentTime;
    
    // Return a point 60% through the auction
    return params.startTime + Math.floor(auctionDuration * 0.6);
  }

  /**
   * Create a market configuration based on volatility
   */
  private createMarketConfig(volatility: number): Required<AuctionConfig> {
    // Higher volatility leads to higher initial rate bumps and steeper curves
    const baseConfig = {
      duration: 180, // 3 minutes
      initialRateBump: Math.floor(5000 * (1 + volatility)), // 0.5% base + volatility adjustment
      points: [
        { delay: 30, coefficient: 40000 },  // 0.4% after 30s
        { delay: 60, coefficient: 30000 },  // 0.3% after 90s
        { delay: 90, coefficient: 20000 }   // 0.2% after 180s (end of auction)
      ],
      gasBumpEstimate: 5000,  // 0.05% for gas costs (aligned with 1inch)
      gasPriceEstimate: 20,   // 20 Gwei
      minFillPercentage: 0.1, // 10% minimum fill
      maxRateBump: 500000     // 5% maximum rate bump (safety limit)
    };

    // Adjust based on volatility
    const volatilityMultiplier = 1 + (volatility * 0.5);
    return {
      ...baseConfig,
      initialRateBump: Math.floor(baseConfig.initialRateBump * volatilityMultiplier),
      points: baseConfig.points.map(p => ({
        ...p,
        coefficient: Math.floor(p.coefficient * volatilityMultiplier)
      })),
    };
  }
}
