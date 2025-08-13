/**
 * Configuration Initialization Utility
 * Provides easy setup and initialization of the configuration service
 */

import { ConfigurationService, Configuration } from '../config/ConfigurationService.js';
import { logger } from './logger.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export interface ConfigInitOptions {
  environment?: 'development' | 'staging' | 'production';
  configPath?: string;
  createIfMissing?: boolean;
  enableHotReload?: boolean;
  validateEnvironment?: boolean;
}

/**
 * Initialize configuration service with options
 */
export async function initializeConfiguration(options: ConfigInitOptions = {}): Promise<Configuration> {
  const {
    environment = process.env.NODE_ENV as any || 'development',
    configPath,
    createIfMissing = true,
    enableHotReload = environment === 'development',
    validateEnvironment = true
  } = options;

  try {
    logger.info('Initializing configuration service', {
      environment,
      configPath,
      createIfMissing,
      enableHotReload,
      validateEnvironment
    });

    // Determine config path
    const finalConfigPath = configPath || getDefaultConfigPath(environment);
    
    // Create config file if missing and requested
    if (createIfMissing && !existsSync(finalConfigPath)) {
      await createConfigurationFile(finalConfigPath, environment);
    }

    // Initialize configuration service
    const configService = ConfigurationService.getInstance(finalConfigPath);
    const config = await configService.initialize();

    // Enable hot reload if requested
    if (enableHotReload) {
      configService.enableHotReload();
      logger.info('Hot reload enabled for configuration');
    }

    // Validate environment if requested
    if (validateEnvironment) {
      await configService.validateEnvironment();
      logger.info('Environment validation completed');
    }

    // Set up event listeners for configuration changes
    setupConfigurationEventListeners(configService);

    logger.info('Configuration service initialized successfully', {
      environment: config.environment,
      nearNetwork: config.near.networkId,
      ethereumChainId: config.ethereum.network.chainId,
      storageDir: config.relayer.storageDir
    });

    return config;
  } catch (error) {
    logger.error('Failed to initialize configuration service', error);
    throw error;
  }
}

/**
 * Create configuration file from template
 */
export async function createConfigurationFile(
  configPath: string, 
  environment: 'development' | 'staging' | 'production'
): Promise<void> {
  try {
    logger.info('Creating configuration file from template', { configPath, environment });

    // Ensure directory exists
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Create configuration from template
    const template = ConfigurationService.createTemplate(environment);
    
    // Add helpful comments to the configuration
    const configWithComments = addConfigurationComments(template);
    
    // Write configuration file
    writeFileSync(configPath, JSON.stringify(configWithComments, null, 2));
    
    logger.info('Configuration file created successfully', { configPath });
    
    // Log important setup instructions
    logSetupInstructions(environment);
  } catch (error) {
    logger.error('Failed to create configuration file', error);
    throw error;
  }
}

/**
 * Get default configuration path for environment
 */
export function getDefaultConfigPath(environment: string): string {
  return join(process.cwd(), 'config', `config.${environment}.json`);
}

/**
 * Setup configuration event listeners
 */
function setupConfigurationEventListeners(configService: ConfigurationService): void {
  configService.on('config:loaded', (config) => {
    logger.info('Configuration loaded', {
      environment: config.environment,
      timestamp: new Date().toISOString()
    });
  });

  configService.on('config:updated', (newConfig, oldConfig) => {
    logger.info('Configuration updated', {
      environment: newConfig.environment,
      changes: getConfigurationChanges(oldConfig, newConfig),
      timestamp: new Date().toISOString()
    });
  });

  configService.on('config:error', (error) => {
    logger.error('Configuration error occurred', error);
  });

  configService.on('config:validated', (config) => {
    logger.debug('Configuration validated successfully', {
      environment: config.environment
    });
  });
}

/**
 * Add helpful comments to configuration template
 */
function addConfigurationComments(config: Configuration): any {
  return {
    "_comments": {
      "setup": "Replace placeholder values with your actual configuration",
      "security": "Never commit private keys or sensitive data to version control",
      "environment": "Use environment variables for sensitive configuration in production",
      "validation": "All configuration is validated against a strict schema on startup"
    },
    ...config,
    "near": {
      ...config.near,
      "_comment": "NEAR Protocol configuration - update accountId and privateKey"
    },
    "ethereum": {
      ...config.ethereum,
      "_comment": "Ethereum configuration - update privateKey and contract addresses"
    },
    "relayer": {
      ...config.relayer,
      "_comment": "Relayer settings - adjust polling intervals and storage paths as needed"
    }
  };
}

/**
 * Get differences between old and new configuration
 */
function getConfigurationChanges(oldConfig: Configuration, newConfig: Configuration): any {
  const changes: any = {};
  
  // Simple diff implementation for logging purposes
  if (oldConfig.relayer.pollingInterval !== newConfig.relayer.pollingInterval) {
    changes.pollingInterval = {
      old: oldConfig.relayer.pollingInterval,
      new: newConfig.relayer.pollingInterval
    };
  }
  
  if (oldConfig.relayer.logLevel !== newConfig.relayer.logLevel) {
    changes.logLevel = {
      old: oldConfig.relayer.logLevel,
      new: newConfig.relayer.logLevel
    };
  }
  
  if (oldConfig.near.networkId !== newConfig.near.networkId) {
    changes.nearNetwork = {
      old: oldConfig.near.networkId,
      new: newConfig.near.networkId
    };
  }
  
  if (oldConfig.ethereum.network.chainId !== newConfig.ethereum.network.chainId) {
    changes.ethereumChainId = {
      old: oldConfig.ethereum.network.chainId,
      new: newConfig.ethereum.network.chainId
    };
  }
  
  return changes;
}

/**
 * Log setup instructions for new configuration
 */
function logSetupInstructions(environment: string): void {
  logger.info('Configuration setup instructions', {
    environment,
    instructions: [
      '1. Update NEAR accountId and privateKey in the configuration file',
      '2. Update Ethereum privateKey and contract addresses',
      '3. Configure RPC URLs for your preferred providers (Infura, Alchemy, etc.)',
      '4. Set up environment variables for sensitive data in production',
      '5. Adjust polling intervals and storage paths as needed',
      '6. Review security settings and enable TEE validation for production'
    ]
  });

  if (environment === 'production') {
    logger.warn('Production configuration created', {
      securityReminder: [
        'IMPORTANT: Use environment variables for all sensitive data',
        'Enable TEE validation and signature verification',
        'Use secure storage for private keys',
        'Set up monitoring and alerting',
        'Review all security settings before deployment'
      ]
    });
  }
}

/**
 * Validate configuration setup
 */
export async function validateConfigurationSetup(configPath?: string): Promise<boolean> {
  try {
    const environment = process.env.NODE_ENV || 'development';
    const finalConfigPath = configPath || getDefaultConfigPath(environment);
    
    if (!existsSync(finalConfigPath)) {
      logger.error('Configuration file not found', { configPath: finalConfigPath });
      return false;
    }
    
    const configService = ConfigurationService.getInstance(finalConfigPath);
    await configService.initialize();
    await configService.validateEnvironment();
    
    logger.info('Configuration setup validation passed');
    return true;
  } catch (error) {
    logger.error('Configuration setup validation failed', error);
    return false;
  }
}

/**
 * Quick setup for development environment
 */
export async function quickDevSetup(): Promise<Configuration> {
  logger.info('Running quick development setup');
  
  return await initializeConfiguration({
    environment: 'development',
    createIfMissing: true,
    enableHotReload: true,
    validateEnvironment: false // Skip validation for quick setup
  });
}

/**
 * Production-ready setup with full validation
 */
export async function productionSetup(configPath?: string): Promise<Configuration> {
  logger.info('Running production setup with full validation');
  
  return await initializeConfiguration({
    environment: 'production',
    configPath,
    createIfMissing: false, // Require explicit config file in production
    enableHotReload: false,
    validateEnvironment: true
  });
}
