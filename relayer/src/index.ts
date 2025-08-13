import * as dotenv from 'dotenv';
import { ethers, providers, Wallet } from 'ethers';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider, Provider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { EthereumRelayer } from './relay/EthereumRelayer.js';
import { NearRelayer } from './relay/NearRelayer.js';
import { logger } from './utils/logger.js';
import { ConfigurationService } from './config/ConfigurationService.js';
import type { NearAccount } from './types/interfaces.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'ETHEREUM_RPC_URL',
  'ETHEREUM_CHAIN_ID',
  // Prefer unified ETHEREUM_PRIVATE_KEY; support legacy DEPLOYER_PRIVATE_KEY for now
  process.env.DEPLOYER_PRIVATE_KEY ? 'DEPLOYER_PRIVATE_KEY' : 'ETHEREUM_PRIVATE_KEY',
  'NEAR_NETWORK_ID',
  'NEAR_NODE_URL',
  'NEAR_RELAYER_ACCOUNT_ID',
  'NEAR_RELAYER_PRIVATE_KEY',
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

export async function main(deps?: {
  EthereumRelayerCtor?: typeof EthereumRelayer;
  NearRelayerCtor?: typeof NearRelayer;
  ConfigService?: typeof ConfigurationService;
  Ethers?: { providers: { JsonRpcProvider: any }, Wallet: any };
}) {
  try {
    logger.info('Starting cross-chain relayer...');

    // Initialize Ethereum provider and signer
    const E = deps?.Ethers ?? { providers, Wallet };
    const ethereumProvider = new E.providers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
    // Prefer ETHEREUM_PRIVATE_KEY; fallback to legacy DEPLOYER_PRIVATE_KEY with warning
    const ethPrivKey = process.env.ETHEREUM_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
    if (!ethPrivKey) {
      throw new Error('ETHEREUM_PRIVATE_KEY is required (DEPLOYER_PRIVATE_KEY is deprecated but supported temporarily).');
    }
    if (process.env.DEPLOYER_PRIVATE_KEY && !process.env.ETHEREUM_PRIVATE_KEY) {
      logger.warn('DEPLOYER_PRIVATE_KEY is deprecated. Please set ETHEREUM_PRIVATE_KEY to avoid future breakage.');
    }
    const ethereumSigner = new E.Wallet(ethPrivKey, ethereumProvider);
    logger.info(`Connected to Ethereum network: ${await ethereumProvider.getNetwork().then((n: any) => n.name)} (${process.env.ETHEREUM_CHAIN_ID})`);
    logger.info(`Ethereum relayer address: ${await ethereumSigner.getAddress()}`);

    // Initialize NEAR signer and provider
    const signer = KeyPairSigner.fromSecretKey(process.env.NEAR_RELAYER_PRIVATE_KEY! as any);
    const provider = new JsonRpcProvider({ url: process.env.NEAR_NODE_URL! });
    
    // Create proper NEAR account instance with functionCall method
    // Use the working pattern from chainSignatureService.ts
    // Create NEAR Account instance using the correct constructor pattern
    const account = new Account(
      process.env.NEAR_RELAYER_ACCOUNT_ID!,
      provider as unknown as Provider, // Type assertion to handle compatibility
      signer
    );
    
    // Create wrapper object with expected interface for NEAR relayer compatibility
    const nearAccount: NearAccount = {
      ...account,
      connection: {
        provider: provider as unknown as any, // TODO: Create proper NearProvider interface
        signer,
      },
      functionCall: account.functionCall.bind(account)
    };

    logger.info(`Connected to NEAR network: ${process.env.NEAR_NETWORK_ID}`);
    logger.info(`NEAR account ID: ${nearAccount.accountId}`);

    // Optionally load auction config from ConfigurationService (if config file exists)
    let auctionConfig = undefined as ReturnType<typeof ConfigurationService.createTemplate>['auction'] | undefined;
    try {
      const cfg = await (deps?.ConfigService ?? ConfigurationService).loadForEnvironment(process.env.NODE_ENV || 'development');
      auctionConfig = cfg.auction;
      if (auctionConfig) {
        logger.info('Loaded auction configuration from ConfigurationService');
      }
    } catch (e) {
      logger.debug('No configuration file found or failed to load; continuing without auction config', {
        error: e instanceof Error ? e.message : String(e)
      });
    }

    // Initialize relayers with configuration objects
    const EthereumRelayerCtor = deps?.EthereumRelayerCtor ?? EthereumRelayer;
    const NearRelayerCtor = deps?.NearRelayerCtor ?? NearRelayer;

    const ethereumRelayer = new EthereumRelayerCtor({
      provider: ethereumSigner.provider as ethers.providers.JsonRpcProvider,
      signer: ethereumSigner,
      nearAccount: nearAccount as NearAccount,
      factoryAddress: process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS!,
      bridgeAddress: process.env.ETHEREUM_BRIDGE_ADDRESS!,
      resolverAddress: process.env.RESOLVER_ADDRESS || process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS!,
      storageDir: process.env.STORAGE_DIR || './storage',
      pollIntervalMs: parseInt(process.env.RELAYER_POLL_INTERVAL || '5000', 10),
      auctionConfig
    });

    const nearRelayer = new NearRelayerCtor({
      nearAccount: nearAccount as any,
      ethereum: {
        rpcUrl: process.env.ETHEREUM_RPC_URL!,
        privateKey: process.env.ETHEREUM_PRIVATE_KEY!
      },
      escrowContractId: process.env.NEAR_ESCROW_CONTRACT_ID!,
      ethereumEscrowFactoryAddress: process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS!,
      storageDir: process.env.STORAGE_DIR || './storage',
      pollIntervalMs: parseInt(process.env.RELAYER_POLL_INTERVAL || '5000', 10)
    });

    // Start relayers
    await Promise.all([
      ethereumRelayer.start(),
      nearRelayer.start()
    ]);

    logger.info('Cross-chain relayer started successfully');
    
    // Handle shutdown gracefully
    const shutdown = async () => {
      logger.info('Shutting down cross-chain relayer...');
      await Promise.all([
        ethereumRelayer.stop(),
        nearRelayer.stop()
      ]);
      process.exit(0);
    };

    // Set higher limit for process event listeners to prevent MaxListenersExceededWarning
    process.setMaxListeners(20);
    
    // Remove any existing listeners to prevent duplicates
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.error('Failed to start cross-chain relayer:', error);
    // In tests (when deps are injected), rethrow to help debugging
    if (deps) {
      throw error;
    }
    process.exit(1);
  }
}

if (process.env.RELAYER_AUTO_START !== 'false') {
  main().catch(error => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}
