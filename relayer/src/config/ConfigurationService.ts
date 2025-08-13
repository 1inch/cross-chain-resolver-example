/**
 * Centralized Configuration Management Service
 * Provides schema validation, hot-reloading, and environment-specific settings
 */

import { z } from 'zod';
import { readFileSync, watchFile, existsSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { ValidationError, ConfigurationError } from '../utils/errors.js';

// Configuration schema definitions
const NetworkConfigSchema = z.object({
  name: z.string().min(1),
  rpcUrl: z.string().url(),
  chainId: z.number().positive(),
  blockConfirmations: z.number().min(1).default(12),
  gasLimit: z.string().regex(/^\d+$/).optional(),
  gasPrice: z.string().regex(/^\d+$/).optional()
});

const NearConfigSchema = z.object({
  networkId: z.enum(['mainnet', 'testnet', 'localnet']),
  nodeUrl: z.string().url(),
  walletUrl: z.string().url().optional(),
  helperUrl: z.string().url().optional(),
  explorerUrl: z.string().url().optional(),
  accountId: z.string().min(1),
  privateKey: z.string().min(1),
  escrowContractId: z.string().min(1),
  keyStore: z.object({
    type: z.enum(['file', 'memory', 'browser']).default('file'),
    path: z.string().optional()
  }).optional()
});

// Auction configuration schema (for DynamicAuctionService)
const AuctionPointSchema = z.object({
  delay: z.number().min(0),
  coefficient: z.number().int()
});

const AuctionConfigSchema = z.object({
  duration: z.number().min(30).max(1800).default(180),
  initialRateBump: z.number().int().default(50000),
  points: z.array(AuctionPointSchema).nonempty().default([
    { delay: 30, coefficient: 40000 },
    { delay: 60, coefficient: 30000 },
    { delay: 90, coefficient: 20000 }
  ]),
  gasBumpEstimate: z.number().int().default(5000),
  gasPriceEstimate: z.number().min(0).default(20),
  minFillPercentage: z.number().min(0).max(1).optional().default(0.1),
  maxRateBump: z.number().int().optional().default(500000)
});

const EthereumConfigSchema = z.object({
  network: NetworkConfigSchema,
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  escrowContractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  bridgeContractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  maxGasPrice: z.string().regex(/^\d+$/).optional(),
  priorityFee: z.string().regex(/^\d+$/).optional()
});

const RelayerConfigSchema = z.object({
  pollingInterval: z.number().min(1000).max(60000).default(5000),
  maxRetries: z.number().min(1).max(10).default(3),
  retryDelay: z.number().min(100).max(10000).default(1000),
  batchSize: z.number().min(1).max(100).default(10),
  storageDir: z.string().min(1),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  enableMetrics: z.boolean().default(false),
  metricsPort: z.number().min(1000).max(65535).default(3001)
});

const SecurityConfigSchema = z.object({
  enableTeeValidation: z.boolean().default(true),
  allowedTeeTypes: z.array(z.enum(['SGX', 'SEV', 'TrustZone', 'AWS_Nitro', 'Azure_Attestation', 'Asylo'])).default(['SGX']),
  signatureValidation: z.boolean().default(true),
  encryptSecrets: z.boolean().default(true),
  secretEncryptionKey: z.string().min(32).optional(),
  rateLimiting: z.object({
    enabled: z.boolean().default(true),
    maxRequestsPerMinute: z.number().min(1).max(1000).default(100),
    maxRequestsPerHour: z.number().min(1).max(10000).default(1000)
  }).optional()
});

const MonitoringConfigSchema = z.object({
  healthCheck: z.object({
    enabled: z.boolean().default(true),
    interval: z.number().min(5000).max(300000).default(30000),
    timeout: z.number().min(1000).max(30000).default(5000)
  }).optional(),
  alerts: z.object({
    enabled: z.boolean().default(false),
    webhookUrl: z.string().url().optional(),
    slackToken: z.string().optional(),
    emailConfig: z.object({
      smtp: z.string().optional(),
      from: z.string().email().optional(),
      to: z.array(z.string().email()).optional()
    }).optional()
  }).optional()
});

const MainConfigSchema = z.object({
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  near: NearConfigSchema,
  ethereum: EthereumConfigSchema,
  relayer: RelayerConfigSchema,
  auction: AuctionConfigSchema.optional(),
  security: SecurityConfigSchema.optional(),
  monitoring: MonitoringConfigSchema.optional()
});

export type Configuration = z.infer<typeof MainConfigSchema>;
export type NearConfig = z.infer<typeof NearConfigSchema>;
export type EthereumConfig = z.infer<typeof EthereumConfigSchema>;
export type RelayerConfig = z.infer<typeof RelayerConfigSchema>;
export type AuctionConfig = z.infer<typeof AuctionConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;

export interface ConfigurationEvents {
  'config:loaded': (config: Configuration) => void;
  'config:updated': (config: Configuration, previousConfig: Configuration) => void;
  'config:error': (error: Error) => void;
  'config:validated': (config: Configuration) => void;
}

export class ConfigurationService extends EventEmitter {
  private static instance: ConfigurationService | null = null;
  private config: Configuration | null = null;
  private configPath: string;
  private watching: boolean = false;
  private watchAbortController: AbortController | null = null;

  private constructor(configPath?: string) {
    super();
    // Set higher limit for event listeners to prevent MaxListenersExceededWarning
    this.setMaxListeners(20);
    this.configPath = configPath || this.getDefaultConfigPath();
  }

  /**
   * Get singleton instance of ConfigurationService
   */
  public static getInstance(configPath?: string): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService(configPath);
    }
    return ConfigurationService.instance;
  }

  /**
   * Initialize configuration service
   */
  public async initialize(): Promise<Configuration> {
    try {
      logger.info('Initializing configuration service', { configPath: this.configPath });
      
      await this.loadConfiguration();
      await this.validateConfiguration();
      
      if (this.config) {
        this.emit('config:loaded', this.config);
        this.emit('config:validated', this.config);
        
        logger.info('Configuration service initialized successfully', {
          environment: this.config.environment,
          nearNetwork: this.config.near.networkId,
          ethereumChainId: this.config.ethereum.network.chainId
        });
        
        return this.config;
      } else {
        throw new ConfigurationError('Failed to load configuration', 'general');
      }
    } catch (error) {
      logger.error('Failed to initialize configuration service', error);
      this.emit('config:error', error as Error);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): Configuration {
    if (!this.config) {
      throw new ConfigurationError('Configuration not initialized. Call initialize() first.', 'initialization');
    }
    return this.config;
  }

  /**
   * Get specific configuration section
   */
  public getNearConfig(): NearConfig {
    return this.getConfig().near;
  }

  public getEthereumConfig(): EthereumConfig {
    return this.getConfig().ethereum;
  }

  public getRelayerConfig(): RelayerConfig {
    return this.getConfig().relayer;
  }

  /**
   * Get auction configuration (if provided)
   */
  public getAuctionConfig(): AuctionConfig | undefined {
    return this.getConfig().auction;
  }

  public enableHotReload(): void {
    if (this.watching) {
      logger.warn('Hot reload already enabled');
      return;
    }

    try {
      this.watchAbortController = new AbortController();
      
      watchFile(this.configPath, { interval: 1000 }, async (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          logger.info('Configuration file changed, reloading...', { configPath: this.configPath });
          await this.reloadConfiguration();
        }
      });

      this.watching = true;
      logger.info('Hot reload enabled for configuration', { configPath: this.configPath });
    } catch (error) {
      logger.error('Failed to enable hot reload', error);
      throw new ConfigurationError(`Failed to enable hot reload: ${(error as Error).message}`, 'hot_reload');
    }
  }

  /**
   * Disable hot-reloading
   */
  public disableHotReload(): void {
    if (!this.watching) {
      return;
    }

    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = null;
    }

    this.watching = false;
    logger.info('Hot reload disabled for configuration');
  }

  /**
   * Reload configuration from file
   */
  public async reloadConfiguration(): Promise<Configuration> {
    try {
      const previousConfig = this.config;
      await this.loadConfiguration();
      await this.validateConfiguration();

      if (this.config && previousConfig) {
        this.emit('config:updated', this.config, previousConfig);
        logger.info('Configuration reloaded successfully');
      }

      return this.getConfig();
    } catch (error) {
      logger.error('Failed to reload configuration', error);
      this.emit('config:error', error as Error);
      throw error;
    }
  }

  /**
   * Validate configuration against environment
   */
  public async validateEnvironment(): Promise<void> {
    const config = this.getConfig();

    try {
      // Validate NEAR network connectivity
      await this.validateNearConnectivity(config.near);
      
      // Validate Ethereum network connectivity
      await this.validateEthereumConnectivity(config.ethereum);
      
      // Validate storage directory
      await this.validateStorageDirectory(config.relayer.storageDir);
      
      // Validate security settings
      await this.validateSecuritySettings(config.security);

      logger.info('Environment validation completed successfully');
    } catch (error) {
      logger.error('Environment validation failed', error);
      throw new ConfigurationError(`Environment validation failed: ${(error as Error).message}`, 'environment_validation');
    }
  }

  /**
   * Get configuration for specific environment
   */
  public static async loadForEnvironment(environment: string, configDir?: string): Promise<Configuration> {
    const configPath = configDir 
      ? join(configDir, `config.${environment}.json`)
      : join(process.cwd(), 'config', `config.${environment}.json`);

    const service = new ConfigurationService(configPath);
    return await service.initialize();
  }

  /**
   * Create configuration template
   */
  public static createTemplate(environment: 'development' | 'staging' | 'production' = 'development'): Configuration {
    const template: Configuration = {
      environment,
      near: {
        networkId: environment === 'production' ? 'mainnet' : 'testnet',
        nodeUrl: environment === 'production' 
          ? 'https://rpc.mainnet.near.org' 
          : 'https://rpc.testnet.near.org',
        accountId: 'your-account.testnet',
        privateKey: 'your-private-key',
        escrowContractId: 'escrow.your-account.testnet'
      },
      ethereum: {
        network: {
          name: environment === 'production' ? 'mainnet' : 'sepolia',
          rpcUrl: environment === 'production' 
            ? 'https://mainnet.infura.io/v3/YOUR_PROJECT_ID'
            : 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
          chainId: environment === 'production' ? 1 : 11155111,
          blockConfirmations: environment === 'production' ? 12 : 1
        },
        privateKey: '0x0000000000000000000000000000000000000000000000000000000000000000',
        escrowContractAddress: '0x0000000000000000000000000000000000000000',
        bridgeContractAddress: '0x0000000000000000000000000000000000000000'
      },
      relayer: {
        pollingInterval: 5000,
        maxRetries: 3,
        retryDelay: 1000,
        batchSize: 10,
        storageDir: './storage',
        logLevel: environment === 'production' ? 'info' : 'debug',
        enableMetrics: false,
        metricsPort: 3001
      },
      auction: {
        duration: 180,
        initialRateBump: 50000,
        points: [
          { delay: 30, coefficient: 40000 },
          { delay: 60, coefficient: 30000 },
          { delay: 90, coefficient: 20000 }
        ],
        gasBumpEstimate: 5000,
        gasPriceEstimate: 20,
        minFillPercentage: 0.1,
        maxRateBump: 500000
      },
      security: {
        enableTeeValidation: true,
        allowedTeeTypes: ['SGX'],
        signatureValidation: true,
        encryptSecrets: environment === 'production'
      },
      monitoring: {
        healthCheck: {
          enabled: true,
          interval: 30000,
          timeout: 5000
        }
      }
    };

    return template;
  }

  // Private methods

  private getDefaultConfigPath(): string {
    const environment = process.env.NODE_ENV || 'development';
    return join(process.cwd(), 'config', `config.${environment}.json`);
  }

  private async loadConfiguration(): Promise<void> {
    try {
      if (!existsSync(this.configPath)) {
        throw new ConfigurationError(`Configuration file not found: ${this.configPath}`, 'file_path');
      }

      const configData = readFileSync(this.configPath, 'utf-8');
      const parsedConfig = JSON.parse(configData);

      // Merge with environment variables
      const configWithEnv = this.mergeWithEnvironmentVariables(parsedConfig);

      this.config = configWithEnv;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigurationError(`Invalid JSON in configuration file: ${this.configPath}`, 'schema_validation');
      }
      throw error;
    }
  }

  private async validateConfiguration(): Promise<void> {
    if (!this.config) {
      throw new ConfigurationError('No configuration to validate', 'validation');
    }

    try {
      const validatedConfig = MainConfigSchema.parse(this.config);
      this.config = validatedConfig;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        throw new ConfigurationError(`Configuration validation failed: ${errorMessages}`, 'schema_validation');
      }
      throw error;
    }
  }

  private mergeWithEnvironmentVariables(config: any): any {
    const envOverrides: any = {};

    // NEAR configuration overrides
    if (process.env.NEAR_NETWORK_ID) envOverrides.near = { ...envOverrides.near, networkId: process.env.NEAR_NETWORK_ID };
    if (process.env.NEAR_NODE_URL) envOverrides.near = { ...envOverrides.near, nodeUrl: process.env.NEAR_NODE_URL };
    if (process.env.NEAR_ACCOUNT_ID) envOverrides.near = { ...envOverrides.near, accountId: process.env.NEAR_ACCOUNT_ID };
    if (process.env.NEAR_PRIVATE_KEY) envOverrides.near = { ...envOverrides.near, privateKey: process.env.NEAR_PRIVATE_KEY };
    if (process.env.NEAR_ESCROW_CONTRACT_ID) envOverrides.near = { ...envOverrides.near, escrowContractId: process.env.NEAR_ESCROW_CONTRACT_ID };

    // Ethereum configuration overrides
    if (process.env.ETHEREUM_RPC_URL) {
      envOverrides.ethereum = { 
        ...envOverrides.ethereum, 
        network: { ...envOverrides.ethereum?.network, rpcUrl: process.env.ETHEREUM_RPC_URL }
      };
    }
    if (process.env.ETHEREUM_CHAIN_ID) {
      envOverrides.ethereum = { 
        ...envOverrides.ethereum, 
        network: { ...envOverrides.ethereum?.network, chainId: parseInt(process.env.ETHEREUM_CHAIN_ID) }
      };
    }
    if (process.env.ETHEREUM_PRIVATE_KEY) envOverrides.ethereum = { ...envOverrides.ethereum, privateKey: process.env.ETHEREUM_PRIVATE_KEY };
    if (process.env.ETHEREUM_ESCROW_CONTRACT) envOverrides.ethereum = { ...envOverrides.ethereum, escrowContractAddress: process.env.ETHEREUM_ESCROW_CONTRACT };
    if (process.env.ETHEREUM_BRIDGE_CONTRACT) envOverrides.ethereum = { ...envOverrides.ethereum, bridgeContractAddress: process.env.ETHEREUM_BRIDGE_CONTRACT };

    // Relayer configuration overrides
    if (process.env.POLLING_INTERVAL) envOverrides.relayer = { ...envOverrides.relayer, pollingInterval: parseInt(process.env.POLLING_INTERVAL) };
    if (process.env.STORAGE_DIR) envOverrides.relayer = { ...envOverrides.relayer, storageDir: process.env.STORAGE_DIR };
    if (process.env.LOG_LEVEL) envOverrides.relayer = { ...envOverrides.relayer, logLevel: process.env.LOG_LEVEL };

    // Auction configuration overrides
    if (process.env.AUCTION_DURATION) {
      const v = parseInt(process.env.AUCTION_DURATION);
      if (!Number.isNaN(v)) envOverrides.auction = { ...envOverrides.auction, duration: v };
    }
    if (process.env.AUCTION_INITIAL_RATE_BUMP) {
      const v = parseInt(process.env.AUCTION_INITIAL_RATE_BUMP);
      if (!Number.isNaN(v)) envOverrides.auction = { ...envOverrides.auction, initialRateBump: v };
    }
    if (process.env.AUCTION_POINTS) {
      try {
        const pts = JSON.parse(process.env.AUCTION_POINTS);
        if (Array.isArray(pts)) {
          envOverrides.auction = { ...envOverrides.auction, points: pts };
        }
      } catch {
        // ignore invalid JSON; validation will catch later
      }
    }
    if (process.env.AUCTION_GAS_BUMP_ESTIMATE) {
      const v = parseInt(process.env.AUCTION_GAS_BUMP_ESTIMATE);
      if (!Number.isNaN(v)) envOverrides.auction = { ...envOverrides.auction, gasBumpEstimate: v };
    }
    if (process.env.AUCTION_GAS_PRICE_ESTIMATE) {
      const v = Number(process.env.AUCTION_GAS_PRICE_ESTIMATE);
      if (!Number.isNaN(v)) envOverrides.auction = { ...envOverrides.auction, gasPriceEstimate: v };
    }
    if (process.env.AUCTION_MIN_FILL_PERCENTAGE) {
      const v = Number(process.env.AUCTION_MIN_FILL_PERCENTAGE);
      if (!Number.isNaN(v)) envOverrides.auction = { ...envOverrides.auction, minFillPercentage: v };
    }
    if (process.env.AUCTION_MAX_RATE_BUMP) {
      const v = parseInt(process.env.AUCTION_MAX_RATE_BUMP);
      if (!Number.isNaN(v)) envOverrides.auction = { ...envOverrides.auction, maxRateBump: v };
    }

    return this.deepMerge(config, envOverrides);
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  private async validateNearConnectivity(nearConfig: NearConfig): Promise<void> {
    // Implementation would test NEAR network connectivity
    // This is a placeholder for actual network validation
    logger.debug('Validating NEAR connectivity', { networkId: nearConfig.networkId });
  }

  private async validateEthereumConnectivity(ethereumConfig: EthereumConfig): Promise<void> {
    // Implementation would test Ethereum network connectivity
    // This is a placeholder for actual network validation
    logger.debug('Validating Ethereum connectivity', { chainId: ethereumConfig.network.chainId });
  }

  private async validateStorageDirectory(storageDir: string): Promise<void> {
    // Implementation would validate storage directory permissions
    // This is a placeholder for actual storage validation
    logger.debug('Validating storage directory', { storageDir });
  }

  private async validateSecuritySettings(securityConfig?: SecurityConfig): Promise<void> {
    // Implementation would validate security settings
    // This is a placeholder for actual security validation
    if (securityConfig) {
      logger.debug('Validating security settings', { 
        teeValidation: securityConfig.enableTeeValidation,
        allowedTeeTypes: securityConfig.allowedTeeTypes 
      });
    }
  }
}

// Export singleton instance getter
export const getConfigurationService = (configPath?: string): ConfigurationService => {
  return ConfigurationService.getInstance(configPath);
};
