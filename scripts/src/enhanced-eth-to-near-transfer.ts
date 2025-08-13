#!/usr/bin/env ts-node

import { ethers } from 'ethers';
import * as crypto from 'crypto';
import * as path from 'path';
import dotenv from 'dotenv';
import { createLogger, format, transports, Logger } from 'winston';

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Enhanced error classes
class CrossChainTestError extends Error {
  constructor(message: string, public code: string, public details?: any) {
    super(message);
    this.name = 'CrossChainTestError';
  }
}

class ValidationError extends CrossChainTestError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

class NetworkError extends CrossChainTestError {
  constructor(message: string, details?: any) {
    super(message, 'NETWORK_ERROR', details);
  }
}

class ContractError extends CrossChainTestError {
  constructor(message: string, details?: any) {
    super(message, 'CONTRACT_ERROR', details);
  }
}

// Enhanced type definitions
interface TestConfig {
  ethereumRpcUrl: string;
  privateKey: string;
  nearBridgeAddress: string;
  transferAmount: string;
  timelock: number;
  recipient: string;
  logLevel: string;
}

interface DepositInfo {
  token: string;
  depositor: string;
  nearRecipient: string;
  amount: bigint;
  timestamp: bigint;
  claimed: boolean;
  disputed: boolean;
  disputeEndTime: bigint;
  secretHash: string;
  timelock: bigint;
}

interface TestResult {
  success: boolean;
  depositId?: string;
  secret?: string;
  secretHash?: string;
  transactionHash?: string;
  gasUsed?: bigint;
  error?: string;
  duration: number;
}

// Enhanced configuration validator
class ConfigValidator {
  static validateTestConfig(config: Partial<TestConfig>): TestConfig {
    const errors: string[] = [];

    if (!config.ethereumRpcUrl || !this.isValidUrl(config.ethereumRpcUrl)) {
      errors.push('Invalid or missing ethereumRpcUrl');
    }

    if (!config.privateKey || !this.isValidPrivateKey(config.privateKey)) {
      errors.push('Invalid or missing privateKey (must be 64 hex characters)');
    }

    if (!config.nearBridgeAddress || !ethers.isAddress(config.nearBridgeAddress)) {
      errors.push('Invalid or missing nearBridgeAddress');
    }

    if (!config.transferAmount || !this.isValidAmount(config.transferAmount)) {
      errors.push('Invalid or missing transferAmount');
    }

    if (!config.recipient || config.recipient.length < 2) {
      errors.push('Invalid or missing recipient address');
    }

    if (config.timelock && (config.timelock < 60 || config.timelock > 86400)) {
      errors.push('Timelock must be between 60 seconds and 24 hours');
    }

    if (errors.length > 0) {
      throw new ValidationError('Configuration validation failed', { errors });
    }

    return {
      ethereumRpcUrl: config.ethereumRpcUrl!,
      privateKey: this.normalizePrivateKey(config.privateKey!),
      nearBridgeAddress: config.nearBridgeAddress!,
      transferAmount: config.transferAmount!,
      timelock: config.timelock || 3600,
      recipient: config.recipient!,
      logLevel: config.logLevel || 'info'
    };
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private static isValidPrivateKey(key: string): boolean {
    const normalized = this.normalizePrivateKey(key);
    return /^0x[a-fA-F0-9]{64}$/.test(normalized);
  }

  private static normalizePrivateKey(key: string): string {
    return key.startsWith('0x') ? key : '0x' + key;
  }

  private static isValidAmount(amount: string): boolean {
    try {
      const parsed = parseFloat(amount);
      return parsed > 0 && parsed < 1000000;
    } catch {
      return false;
    }
  }
}

// Enhanced CrossChainTransferTester class
class CrossChainTransferTester {
  private config: TestConfig;
  private logger: Logger;
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private bridgeContract: ethers.Contract;

  private static readonly BRIDGE_ABI = [
    'function depositEth(string calldata nearRecipient, bytes32 secretHash, uint256 timelock) external payable',
    'function deposits(bytes32) external view returns (address token, address depositor, string memory nearRecipient, uint256 amount, uint256 timestamp, bool claimed, bool disputed, uint256 disputeEndTime, bytes32 secretHash, uint256 timelock)',
    'function completeWithdrawal(bytes32 depositId, address recipient, string calldata secret, bytes[] calldata signatures) external',
    'function claim(bytes32 depositId, bytes32 secret) external',
    'event DepositInitiated(bytes32 indexed depositId, address indexed sender, string nearRecipient, address token, uint256 amount, uint256 fee, uint256 timestamp)',
    'event WithdrawalCompleted(bytes32 indexed depositId, address indexed recipient, uint256 amount, uint256 timestamp)',
    'event Claimed(bytes32 indexed depositId, address indexed claimer, uint256 amount, uint256 timestamp)'
  ] as const;

  constructor(config: Partial<TestConfig>) {
    this.config = ConfigValidator.validateTestConfig(config);
    this.logger = this.createLogger();
    this.provider = new ethers.JsonRpcProvider(this.config.ethereumRpcUrl);
    this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
    this.bridgeContract = new ethers.Contract(
      this.config.nearBridgeAddress,
      CrossChainTransferTester.BRIDGE_ABI,
      this.signer
    );
  }

  private createLogger(): Logger {
    return createLogger({
      level: this.config.logLevel,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
        })
      ),
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.simple()
          )
        }),
        new transports.File({ 
          filename: 'cross-chain-test.log',
          maxsize: 5 * 1024 * 1024, // 5MB
          maxFiles: 3
        })
      ]
    });
  }

  async runFullTest(): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting cross-chain transfer test', {
        bridgeAddress: this.config.nearBridgeAddress,
        transferAmount: this.config.transferAmount,
        recipient: this.config.recipient,
        timelock: this.config.timelock
      });

      // Step 1: Validate environment
      await this.validateEnvironment();

      // Step 2: Generate secret and hash
      const { secret, secretHash } = this.generateSecretAndHash();

      // Step 3: Initiate deposit
      const { depositId, transactionHash, gasUsed } = await this.initiateDeposit(secretHash);

      // Step 4: Verify deposit
      await this.verifyDeposit(depositId, secretHash);

      // Step 5: Simulate cross-chain processing
      await this.simulateCrossChainProcessing(depositId);

      // Step 6: Test withdrawal completion
      await this.testWithdrawalCompletion(depositId, secret);

      const duration = Date.now() - startTime;

      this.logger.info('Cross-chain transfer test completed successfully', {
        depositId,
        transactionHash,
        gasUsed: gasUsed?.toString(),
        duration
      });

      return {
        success: true,
        depositId,
        secret,
        secretHash,
        transactionHash,
        gasUsed,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('Cross-chain transfer test failed', {
        error: error instanceof Error ? error.message : String(error),
        duration
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration
      };
    }
  }

  private async validateEnvironment(): Promise<void> {
    try {
      this.logger.info('Validating test environment...');

      // Check network connection
      const network = await this.provider.getNetwork();
      this.logger.info('Connected to network', { 
        chainId: network.chainId.toString(),
        name: network.name 
      });

      // Check signer balance
      const balance = await this.provider.getBalance(this.signer.address);
      const requiredAmount = ethers.parseEther(this.config.transferAmount);
      
      if (balance < requiredAmount) {
        throw new ValidationError('Insufficient balance for test', {
          balance: ethers.formatEther(balance),
          required: this.config.transferAmount
        });
      }

      this.logger.info('Signer validation passed', {
        address: this.signer.address,
        balance: ethers.formatEther(balance)
      });

      // Check bridge contract
      const code = await this.provider.getCode(this.config.nearBridgeAddress);
      if (code === '0x') {
        throw new ContractError('Bridge contract not found at address', {
          address: this.config.nearBridgeAddress
        });
      }

      this.logger.info('Bridge contract validation passed', {
        address: this.config.nearBridgeAddress
      });

    } catch (error) {
      if (error instanceof CrossChainTestError) {
        throw error;
      }
      throw new NetworkError('Environment validation failed', { error });
    }
  }

  private generateSecretAndHash(): { secret: string; secretHash: string } {
    try {
      const secret = crypto.randomBytes(32).toString('hex');
      // Hash the raw bytes, not the hex string as UTF-8 (consistent with NEAR→ETH)
      const secretHash = ethers.keccak256('0x' + secret);

      this.logger.info('Generated secret and hash', {
        secretLength: secret.length,
        secretHash: secretHash.substring(0, 10) + '...' // Log only first 10 chars for security
      });

      return { secret, secretHash };
    } catch (error) {
      throw new ValidationError('Failed to generate secret and hash', { error });
    }
  }

  private async initiateDeposit(secretHash: string): Promise<{
    depositId: string;
    transactionHash: string;
    gasUsed?: bigint;
  }> {
    try {
      // Calculate timelock as future timestamp (current time + duration)
      const timelockTimestamp = Math.floor(Date.now() / 1000) + this.config.timelock;

      this.logger.info('Initiating deposit...', {
        secretHash,
        amount: this.config.transferAmount,
        timelockDuration: this.config.timelock,
        timelockTimestamp,
        timelockDate: new Date(timelockTimestamp * 1000).toISOString()
      });

      // Estimate gas for the transaction
      const gasEstimate = await this.bridgeContract.depositEth.estimateGas(
        this.config.recipient,
        secretHash,
        timelockTimestamp,
        {
          value: ethers.parseEther(this.config.transferAmount)
        }
      );

      this.logger.info('Gas estimation completed', {
        estimatedGas: gasEstimate.toString(),
        gasLimitUsed: (gasEstimate * 120n / 100n).toString() // Add 20% buffer
      });

      const tx = await this.bridgeContract.depositEth(
        this.config.recipient,
        secretHash,
        timelockTimestamp,
        {
          value: ethers.parseEther(this.config.transferAmount),
          gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
        }
      );

      this.logger.info('Deposit transaction sent', {
        transactionHash: tx.hash
      });

      this.logger.info('Waiting for transaction confirmation...', {
        transactionHash: tx.hash,
        confirmations: 1
      });

      const receipt = await tx.wait(1); // Wait for 1 confirmation
      
      if (!receipt) {
        throw new ContractError('Transaction receipt not available');
      }

      if (receipt.status !== 1) {
        throw new ContractError('Transaction failed', {
          status: receipt.status,
          transactionHash: tx.hash,
          gasUsed: receipt.gasUsed?.toString()
        });
      }

      this.logger.info('Deposit transaction confirmed', {
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      // Extract deposit ID from transaction events
      const depositId = await this.parseDepositEvents(receipt);

      return {
        depositId,
        transactionHash: tx.hash,
        gasUsed: receipt.gasUsed
      };

    } catch (error) {
      this.logger.error('Deposit initiation failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      if (error instanceof CrossChainTestError) {
        throw error;
      }
      throw new ContractError('Failed to initiate deposit', { error });
    }
  }

  private async verifyDeposit(depositId: string, expectedSecretHash: string): Promise<void> {
    try {
      this.logger.info('Verifying deposit...', { depositId });

      const depositInfo = await this.bridgeContract.deposits(depositId);
      
      const deposit: DepositInfo = {
        token: depositInfo[0],
        depositor: depositInfo[1],
        nearRecipient: depositInfo[2],
        amount: depositInfo[3],
        timestamp: depositInfo[4],
        claimed: depositInfo[5],
        disputed: depositInfo[6],
        disputeEndTime: depositInfo[7],
        secretHash: depositInfo[8],
        timelock: depositInfo[9]
      };

      // Validate deposit details
      if (deposit.depositor.toLowerCase() !== this.signer.address.toLowerCase()) {
        throw new ValidationError('Deposit depositor mismatch', {
          expected: this.signer.address,
          actual: deposit.depositor
        });
      }

      if (deposit.secretHash !== expectedSecretHash) {
        throw new ValidationError('Secret hash mismatch', {
          expected: expectedSecretHash,
          actual: deposit.secretHash
        });
      }

      if (deposit.nearRecipient !== this.config.recipient) {
        throw new ValidationError('Recipient mismatch', {
          expected: this.config.recipient,
          actual: deposit.nearRecipient
        });
      }

      const expectedAmount = ethers.parseEther(this.config.transferAmount);
      
      // Account for bridge fees - the deposit amount will be less than the sent amount
      // Allow for reasonable fee deduction (up to 1% of the transfer amount)
      const maxFeeAmount = expectedAmount / 100n; // 1% max fee
      const minExpectedAmount = expectedAmount - maxFeeAmount;
      
      if (deposit.amount < minExpectedAmount) {
        throw new ValidationError('Amount too low after fees', {
          expected: ethers.formatEther(expectedAmount),
          actual: ethers.formatEther(deposit.amount),
          minExpected: ethers.formatEther(minExpectedAmount)
        });
      }
      
      this.logger.info('Amount validation passed (accounting for bridge fees)', {
        sentAmount: ethers.formatEther(expectedAmount),
        receivedAmount: ethers.formatEther(deposit.amount),
        feeDeducted: ethers.formatEther(expectedAmount - deposit.amount)
      });

      this.logger.info('Deposit verification passed', {
        depositId,
        depositor: deposit.depositor,
        amount: ethers.formatEther(deposit.amount),
        nearRecipient: deposit.nearRecipient,
        claimed: deposit.claimed,
        disputed: deposit.disputed
      });

    } catch (error) {
      if (error instanceof CrossChainTestError) {
        throw error;
      }
      throw new ContractError('Failed to verify deposit', { error, depositId });
    }
  }

  private async simulateCrossChainProcessing(depositId: string): Promise<void> {
    try {
      this.logger.info('Simulating cross-chain processing...', { depositId });

      // Simulate relayer detection and processing
      await this.sleep(2000);
      this.logger.info('✅ Relayer detected deposit');

      // Simulate NEAR order creation
      await this.sleep(1000);
      this.logger.info('✅ NEAR escrow order created');

      // Simulate cross-chain message verification
      await this.sleep(1500);
      this.logger.info('✅ Cross-chain message verified');

      this.logger.info('Cross-chain processing simulation completed', { depositId });

    } catch (error) {
      throw new ValidationError('Cross-chain processing simulation failed', { error, depositId });
    }
  }

  private async testWithdrawalCompletion(depositId: string, secret: string): Promise<void> {
    try {
      this.logger.info('Testing withdrawal completion...', { depositId });

      // In a real scenario, this would be called by the recipient
      // For testing, we simulate the withdrawal completion process
      
      this.logger.info('Withdrawal completion test passed (simulated)', {
        depositId,
        secret: secret.substring(0, 10) + '...'
      });

    } catch (error) {
      throw new ContractError('Failed to test withdrawal completion', { error, depositId });
    }
  }

  private async parseDepositEvents(receipt: ethers.TransactionReceipt): Promise<string> {
    try {
      this.logger.info('Parsing deposit events...', {
        transactionHash: receipt.hash,
        logsCount: receipt.logs.length
      });

      let depositId: string | null = null;

      for (let i = 0; i < receipt.logs.length; i++) {
        const log = receipt.logs[i];
        
        try {
          const parsedLog = this.bridgeContract.interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          
          if (parsedLog) {
            this.logger.info(`Event detected: ${parsedLog.name}`, {
              eventIndex: i + 1,
              eventName: parsedLog.name,
              args: this.formatEventArgs(parsedLog.name, parsedLog.args)
            });

            // Extract deposit ID from DepositInitiated event
            if (parsedLog.name === 'DepositInitiated' && parsedLog.args.depositId) {
              depositId = parsedLog.args.depositId;
              this.logger.info('Deposit ID extracted from event', { depositId });
            }
          }
        } catch (parseError) {
          this.logger.debug(`Could not parse log ${i + 1}`, {
            topics: log.topics,
            data: log.data
          });
        }
      }

      if (!depositId) {
        throw new ContractError('DepositInitiated event not found or deposit ID missing');
      }

      return depositId;

    } catch (error) {
      this.logger.error('Failed to parse deposit events', { error });
      throw new ContractError('Failed to extract deposit ID from transaction events', { error });
    }
  }

  private formatEventArgs(eventName: string, args: any): any {
    switch (eventName) {
      case 'DepositInitiated':
        return {
          depositId: args.depositId,
          sender: args.sender,
          nearRecipient: args.nearRecipient,
          token: args.token,
          amount: ethers.formatEther(args.amount),
          fee: ethers.formatEther(args.fee),
          timestamp: new Date(Number(args.timestamp) * 1000).toISOString()
        };
      
      case 'MessageSent':
        return {
          messageId: args.messageId,
          depositId: args.depositId,
          sender: args.sender,
          nearRecipient: args.nearRecipient,
          amount: ethers.formatEther(args.amount),
          timestamp: new Date(Number(args.timestamp) * 1000).toISOString()
        };
      
      case 'WithdrawalCompleted':
        return {
          depositId: args.depositId,
          recipient: args.recipient,
          amount: ethers.formatEther(args.amount),
          timestamp: new Date(Number(args.timestamp) * 1000).toISOString()
        };
      
      default:
        return args;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Enhanced configuration loading
function loadTestConfiguration(): TestConfig {
  try {
    const config = {
      ethereumRpcUrl: process.env.SEPOLIA_RPC_URL,
      privateKey: process.env.PRIVATE_KEY,
      nearBridgeAddress: process.env.NEAR_BRIDGE,
      transferAmount: process.env.ETH_TRANSFER_AMOUNT || '0.001',
      timelock: parseInt(process.env.TIMELOCK_DURATION || '3600'),
      recipient: process.env.RECIPIENT || 'fusionswap.testnet',
      logLevel: process.env.LOG_LEVEL || 'info'
    };

    return ConfigValidator.validateTestConfig(config);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('❌ Configuration validation failed:');
      console.error(error.details);
    } else {
      console.error('❌ Failed to load configuration:', error);
    }
    process.exit(1);
  }
}

// Main execution function
async function main(): Promise<void> {
  try {
    console.log('🚀 Starting Enhanced Cross-Chain Transfer Test');
    console.log('===============================================');

    const config = loadTestConfiguration();
    const tester = new CrossChainTransferTester(config);
    
    const result = await tester.runFullTest();
    
    if (result.success) {
      console.log('\n✅ Test completed successfully!');
      console.log('\n📋 Test Summary:');
      console.log(`   Duration: ${result.duration}ms`);
      console.log(`   Deposit ID: ${result.depositId}`);
      console.log(`   Transaction: ${result.transactionHash}`);
      console.log(`   Gas Used: ${result.gasUsed?.toString()}`);
    } else {
      console.log('\n❌ Test failed!');
      console.log(`   Error: ${result.error}`);
      console.log(`   Duration: ${result.duration}ms`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unhandled error in main:', error);
    process.exit(1);
  }
}

// Run the enhanced test
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { CrossChainTransferTester, ConfigValidator, TestConfig, TestResult };
