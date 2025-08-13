/**
 * Ethereum contract service
 * Handles all Ethereum smart contract interactions with proper error handling
 */

import { ethers } from 'ethers';
import { IContractService, EthereumEscrowDetails } from '../types/interfaces.js';
import { ContractError, ValidationError, ErrorHandler } from '../utils/errors.js';
import { ValidationService } from './ValidationService.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

// Escrow contract ABI
const EscrowABI = [
  'function getDetails() view returns (tuple(uint8 status, address token, uint256 amount, uint256 timelock, bytes32 secretHash, address initiator, address recipient, uint256 chainId))',
  'function withdraw(string memory secret) external',
  'function refund() external',
  'function setStatus(uint8 status) external',
  'event StatusChanged(uint8 newStatus)',
  'event Withdrawn(address indexed recipient, uint256 amount)',
  'event Refunded(address indexed initiator, uint256 amount)'
] as const;

const EscrowFactoryABI = [
  // Matches deployed IEscrowFactory: maker/taker/token are addresses
  'function createDstEscrow(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable returns (address)',
  'function addressOfEscrowSrc(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) immutables) external view returns (address)',
  'event DstEscrowCreated(address escrow, bytes32 hashlock, uint256 taker)'
] as const;

export interface EscrowSearchParams {
  initiator?: string;
  amount?: string;
  secretHash?: string;
  maxBlocksToSearch?: number;
  maxEscrowsToCheck?: number;
}

export class EthereumContractService implements IContractService {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly signer: ethers.Signer;
  private readonly factoryContract: ethers.Contract;
  private readonly validator: ValidationService;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    signer: ethers.Signer,
    factoryAddress: string
  ) {
    this.validateConstructorParams(provider, signer, factoryAddress);
    
    this.provider = provider;
    this.signer = signer;
    this.validator = new ValidationService();
    
    // Initialize factory contract
    this.factoryContract = new ethers.Contract(factoryAddress, EscrowFactoryABI, provider);
  }

  /**
   * Get details of any contract (generic implementation)
   */
  async getContractDetails(address: string): Promise<any> {
    try {
      this.validator.validateEthereumAddress(address);
      
      // For escrow contracts, return escrow details
      return await this.getEscrowDetails(address);
    } catch (error) {
      throw new ContractError(
        'Failed to get contract details',
        address,
        'getDetails',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Get the signer's address
   */
  async getSignerAddress(): Promise<string> {
    try {
      return await withRetry(() => this.signer.getAddress());
    } catch (error) {
      throw new ContractError(
        'Failed to get signer address',
        'N/A',
        'getSignerAddress',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Execute a transaction on the factory contract
   */
  async executeFactoryTransaction(
    method: string,
    params: any[],
    value?: ethers.BigNumber
  ): Promise<ethers.ContractTransaction> {
    try {
      if (!method || typeof method !== 'string') {
        throw ErrorHandler.createValidationError('method', method, 'Method name must be a non-empty string');
      }

      if (!Array.isArray(params)) {
        throw ErrorHandler.createValidationError('params', params, 'Parameters must be an array');
      }

      // Use factory contract with signer for write operations
      const factoryWithSigner = this.factoryContract.connect(this.signer);
      
      // Prepare transaction options
      const txOptions: any = {
        gasLimit: 1500000 // Increased gas limit for escrow creation (was 800k, now 1.5M)
      };
      if (value && value.gt(0)) {
        txOptions.value = value;
        logger.info('Sending ETH value with transaction', {
          method,
          ethValue: ethers.utils.formatEther(value)
        });
      }
      
      logger.info('Using manual gas limit to bypass estimation', {
        method,
        gasLimit: txOptions.gasLimit
      });

      // Execute the transaction
      const tx = await withRetry<ethers.ContractTransaction>(
        () => factoryWithSigner[method](...params, txOptions)
      );
      
      logger.info('Factory transaction executed successfully', {
        factoryAddress: this.factoryContract.address,
        method,
        txHash: tx.hash,
        nonce: tx.nonce
      });

      return tx;
    } catch (error) {
      throw new ContractError(
        `Failed to execute factory transaction: ${method}`,
        this.factoryContract.address,
        method,
        { 
          params,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Execute a transaction on a contract
   */
  async executeTransaction(
    contractAddress: string,
    method: string,
    params: any[]
  ): Promise<ethers.ContractTransaction> {
    try {
      this.validator.validateEthereumAddress(contractAddress);
      
      if (!method || typeof method !== 'string') {
        throw ErrorHandler.createValidationError('method', method, 'Method name must be a non-empty string');
      }

      if (!Array.isArray(params)) {
        throw ErrorHandler.createValidationError('params', params, 'Parameters must be an array');
      }

      // Create contract instance with signer for write operations
      const contract = new ethers.Contract(contractAddress, EscrowABI, this.signer);
      
      // Execute the transaction
      const tx = await withRetry<ethers.ContractTransaction>(() => contract[method](...params));
      
      logger.info('Transaction executed successfully', {
        contractAddress,
        method,
        txHash: tx.hash,
        nonce: tx.nonce
      });

      return tx;
    } catch (error) {
      throw new ContractError(
        `Failed to execute transaction: ${method}`,
        contractAddress,
        method,
        { 
          params,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Get escrow contract details
   */
  async getEscrowDetails(escrowAddress: string): Promise<EthereumEscrowDetails> {
    try {
      this.validator.validateEthereumAddress(escrowAddress);

      const escrowContract = new ethers.Contract(escrowAddress, EscrowABI, this.provider);
      const details = await withRetry<{
        status: number;
        token: string;
        amount: ethers.BigNumber;
        timelock: ethers.BigNumber;
        secretHash: string;
        initiator: string;
        recipient: string;
        chainId: ethers.BigNumber;
      }>(() => escrowContract.getDetails());

      const escrowDetails: EthereumEscrowDetails = {
        status: details.status,
        token: details.token,
        amount: details.amount.toString(),
        timelock: details.timelock.toNumber(),
        secretHash: details.secretHash,
        initiator: details.initiator,
        recipient: details.recipient,
        chainId: details.chainId.toNumber(),
        escrowAddress
      };

      logger.debug('Retrieved escrow details', {
        escrowAddress,
        status: escrowDetails.status,
        amount: ethers.utils.formatEther(escrowDetails.amount),
        timelock: new Date(escrowDetails.timelock * 1000).toISOString()
      });

      return escrowDetails;
    } catch (error) {
      throw new ContractError(
        'Failed to get escrow details',
        escrowAddress,
        'getDetails',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Find escrow by secret hash - crucial for NEAR→Ethereum withdrawals
   */
  async findEscrowBySecretHash(
    secretHash: string,
    maxBlocksToSearch: number = 10000
  ): Promise<EthereumEscrowDetails | null> {
    try {
      this.validator.validateSecretHash(secretHash);

      logger.debug('Searching for Ethereum escrow by secret hash', {
        secretHash,
        maxBlocksToSearch
      });

      const currentBlock = await withRetry<number>(() => this.provider.getBlockNumber());
      const fromBlock = Math.max(0, currentBlock - maxBlocksToSearch);

      // Query all EscrowCreated events
      const filter = this.factoryContract.filters.DstEscrowCreated();
      const events = await withRetry<ethers.Event[]>(() => this.factoryContract.queryFilter(filter, fromBlock));
      
      logger.debug(`Found ${events.length} EscrowCreated events to check for secret hash`);

      // Check each escrow for matching secret hash
      for (const event of events) {
        const escrowAddress = event.args?.[0];
        if (!escrowAddress) continue;

        try {
          const details = await this.getEscrowDetails(escrowAddress);
          if (details && details.secretHash.toLowerCase() === secretHash.toLowerCase()) {
            logger.info('Found Ethereum escrow with matching secret hash', {
              escrowAddress,
              secretHash
            });
            return details;
          }
        } catch (error) {
          logger.debug(`Failed to get details for escrow ${escrowAddress}`, {
            error: error instanceof Error ? error.message : String(error)
          });
          continue;
        }
      }

      logger.debug('No Ethereum escrow found with secret hash', { secretHash });
      return null;
    } catch (error) {
      throw new ContractError(
        'Failed to find escrow by secret hash',
        this.factoryContract.address,
        'findEscrowBySecretHash',
        { 
          secretHash,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Find Ethereum escrow by various criteria
   */
  async findEscrowByParams(params: EscrowSearchParams): Promise<EthereumEscrowDetails | null> {
    try {
      // Validate search parameters
      if (params.initiator) {
        this.validator.validateEthereumAddress(params.initiator);
      }
      
      if (params.amount) {
        this.validator.validateAmount(params.amount);
      }
      
      if (params.secretHash) {
        this.validator.validateSecretHash(params.secretHash);
      }

      const maxBlocksToSearch = params.maxBlocksToSearch || 10000;
      const maxEscrowsToCheck = params.maxEscrowsToCheck || 100;

      // Get current block number and calculate search range
      const currentBlock = await withRetry<number>(() => this.provider.getBlockNumber());
      const fromBlock = Math.max(0, currentBlock - maxBlocksToSearch);

      logger.debug('Searching for escrow', {
        params,
        searchRange: { fromBlock, currentBlock },
        maxEscrowsToCheck
      });

      // Query DstEscrowCreated events (filtering by initiator is done after fetching details)
      const filter = this.factoryContract.filters.DstEscrowCreated();
      const events = await withRetry<ethers.Event[]>(() => this.factoryContract.queryFilter(filter, fromBlock, currentBlock));

      // Sort events by block number (newest first)
      const sortedEvents = events.sort((a, b) => b.blockNumber - a.blockNumber);

      logger.info(`Found ${sortedEvents.length} escrow events to check`);

      // Check each escrow
      let escrowsChecked = 0;
      for (const event of sortedEvents) {
        if (maxEscrowsToCheck > 0 && escrowsChecked >= maxEscrowsToCheck) {
          logger.debug('Reached maximum escrows to check limit', { maxEscrowsToCheck });
          break;
        }

        const escrowAddress = event.args?.[0];
        if (!escrowAddress) continue;

        escrowsChecked++;

        try {
          const details = await this.getEscrowDetails(escrowAddress);
          
          // Check if this escrow matches our criteria
          if (this.matchesSearchCriteria(details, params)) {
            logger.info('Found matching escrow', {
              escrowAddress,
              status: details.status,
              amount: ethers.utils.formatEther(details.amount)
            });
            return details;
          }
        } catch (error) {
          logger.debug(`Failed to get details for escrow ${escrowAddress}`, {
            error: error instanceof Error ? error.message : String(error)
          });
          continue;
        }
      }

      logger.info('No matching escrow found', {
        params,
        escrowsChecked,
        totalEvents: sortedEvents.length
      });

      return null;
    } catch (error) {
      throw new ContractError(
        'Failed to search for escrow',
        this.factoryContract.address,
        'findEscrowByParams',
        { 
          params,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Execute withdrawal on an escrow contract
   */
  async executeWithdrawal(escrowAddress: string, secret: string): Promise<ethers.ContractReceipt> {
    try {
      this.validator.validateEthereumAddress(escrowAddress);
      
      if (!secret || typeof secret !== 'string') {
        throw ErrorHandler.createValidationError('secret', secret, 'Secret must be a non-empty string');
      }

      // Get escrow details first to validate state
      const details = await this.getEscrowDetails(escrowAddress);
      
      if (details.status !== 1) { // Assuming 1 is active status
        throw new ContractError(
          `Escrow is not in active state: ${details.status}`,
          escrowAddress,
          'withdraw',
          { currentStatus: details.status }
        );
      }

      // Execute withdrawal
      const escrowContract = new ethers.Contract(escrowAddress, EscrowABI, this.signer);
      
      // Estimate gas with buffer
      let gasLimit: ethers.BigNumber;
      try {
        const gasEstimate = await withRetry<ethers.BigNumber>(() => escrowContract.estimateGas.withdraw(secret));
        gasLimit = gasEstimate.mul(130).div(100); // 30% buffer
      } catch {
        gasLimit = ethers.BigNumber.from('300000'); // Fallback gas limit
      }

      const tx = await withRetry<ethers.ContractTransaction>(() => escrowContract.withdraw(secret, { gasLimit }));
      
      logger.info('Withdrawal transaction sent', {
        escrowAddress,
        txHash: tx.hash,
        gasLimit: gasLimit.toString()
      });

      const receipt = await withRetry<ethers.ContractReceipt>(() => tx.wait());
      
      if (receipt.status !== 1) {
        throw new ContractError(
          'Withdrawal transaction failed',
          escrowAddress,
          'withdraw',
          { txHash: receipt.transactionHash, status: receipt.status }
        );
      }

      logger.info('Withdrawal completed successfully', {
        escrowAddress,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber
      });

      return receipt;
    } catch (error) {
      if (error instanceof ContractError || error instanceof ValidationError) {
        throw error;
      }
      
      throw new ContractError(
        'Failed to execute withdrawal',
        escrowAddress,
        'withdraw',
        { 
          secret: '***redacted***',
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  /**
   * Execute refund on an escrow contract
   */
  async executeRefund(escrowAddress: string): Promise<ethers.ContractReceipt> {
    try {
      this.validator.validateEthereumAddress(escrowAddress);

      // Get escrow details first to validate state
      const details = await this.getEscrowDetails(escrowAddress);
      
      // Check if refund is allowed (timelock expired and not withdrawn)
      const currentTime = Math.floor(Date.now() / 1000);
      if (details.timelock > currentTime) {
        throw new ContractError(
          `Refund not available yet. Timelock expires in ${details.timelock - currentTime} seconds`,
          escrowAddress,
          'refund',
          { timelock: details.timelock, currentTime }
        );
      }

      if (details.status === 2) { // Assuming 2 is withdrawn status
        throw new ContractError(
          'Escrow has already been withdrawn',
          escrowAddress,
          'refund',
          { currentStatus: details.status }
        );
      }

      // Execute refund
      const escrowContract = new ethers.Contract(escrowAddress, EscrowABI, this.signer);
      
      const tx = await withRetry<ethers.ContractTransaction>(() => escrowContract.refund());
      
      logger.info('Refund transaction sent', {
        escrowAddress,
        txHash: tx.hash
      });

      const receipt = await withRetry<ethers.ContractReceipt>(() => tx.wait());
      
      if (receipt.status !== 1) {
        throw new ContractError(
          'Refund transaction failed',
          escrowAddress,
          'refund',
          { txHash: receipt.transactionHash, status: receipt.status }
        );
      }

      logger.info('Refund completed successfully', {
        escrowAddress,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString()
      });

      return receipt;
    } catch (error) {
      if (error instanceof ContractError || error instanceof ValidationError) {
        throw error;
      }
      
      throw new ContractError(
        'Failed to execute refund',
        escrowAddress,
        'refund',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  // Private helper methods

  private validateConstructorParams(
    provider: ethers.providers.JsonRpcProvider,
    signer: ethers.Signer,
    factoryAddress: string
  ): void {
    if (!provider) {
      throw ErrorHandler.createValidationError('provider', provider, 'Provider is required');
    }

    if (!signer) {
      throw ErrorHandler.createValidationError('signer', signer, 'Signer is required');
    }

    if (!signer.provider) {
      throw ErrorHandler.createValidationError('signer.provider', signer.provider, 'Signer must be connected to a provider');
    }

    if (!ethers.utils.isAddress(factoryAddress)) {
      throw ErrorHandler.createValidationError('factoryAddress', factoryAddress, 'Invalid factory address');
    }
  }

  private matchesSearchCriteria(details: EthereumEscrowDetails, params: EscrowSearchParams): boolean {
    // Check amount match with tolerance
    if (params.amount) {
      const expectedAmount = ethers.utils.parseEther(params.amount);
      const actualAmount = ethers.BigNumber.from(details.amount);
      const tolerance = ethers.utils.parseEther('0.0001'); // 0.0001 ETH tolerance
      
      const diff = actualAmount.sub(expectedAmount).abs();
      if (diff.gt(tolerance)) {
        return false;
      }
    }

    // Check secret hash match
    if (params.secretHash) {
      if (details.secretHash.toLowerCase() !== params.secretHash.toLowerCase()) {
        return false;
      }
    }

    // Check if escrow is in valid state for withdrawal
    if (details.status !== 1) { // Assuming 1 is active status
      return false;
    }

    return true;
  }
}
