#!/usr/bin/env ts-node
/**
 * Deployment script for the Cross-Chain Relayer
 * 
 * This script handles the deployment of the relayer service to various environments.
 * It sets up the necessary configuration and starts the relayer.
 */

import dotenv from 'dotenv';
import path from 'path';
import { ethers } from 'ethers';
import { EthereumRelayer } from '../src/relay/ethereum';
import { logger } from '../src/utils/logger';
import { startServer, setupGracefulShutdown, ethereumBlockHeight, nearBlockHeight } from '../src/server';

// Load environment variables from .env file
dotenv.config();

// Configuration interface for the relayer
interface RelayerConfig {
  // Ethereum configuration
  ethereum: {
    rpcUrl: string;
    privateKey: string;
    escrowFactoryAddress: string;
    chainId: number;
  };
  
  // NEAR configuration
  near: {
    networkId: string;
    nodeUrl: string;
    walletUrl: string;
    helperUrl: string;
    explorerUrl: string;
    accountId: string;
    privateKey: string;
    escrowFactoryAddress: string;
  };
  
  // General configuration
  pollingInterval: number;
  logLevel: string;
}

/**
 * Main deployment function
 */
async function deploy() {
  logger.info('🚀 Starting Cross-Chain Relayer deployment...');
  
  try {
    // Load and validate configuration
    const config = loadConfig();
    
    // Initialize Ethereum provider and signer
    const provider = new ethers.JsonRpcProvider(config.ethereum.rpcUrl);
    const signer = new ethers.Wallet(config.ethereum.privateKey, provider);
    
    logger.info(`🔗 Connected to Ethereum network: ${config.ethereum.chainId}`);
    logger.info(`👤 Using account: ${await signer.getAddress()}`);
    
    // Initialize NEAR account (this is a placeholder - in a real implementation,
    // you would use near-api-js to connect to a NEAR account)
    const nearAccount = {
      accountId: config.near.accountId,
      functionCall: async (params: any) => {
        logger.info(`📝 NEAR function call: ${params.methodName}`, params.args);
        return { transaction: { hash: '0x' + Math.random().toString(16).substr(2, 64) } };
      },
    };
    
    // Create and start the Ethereum relayer
    const ethereumRelayer = new EthereumRelayer(
      provider,
      signer,
      nearAccount as any,
      {
        escrowFactoryAddress: config.ethereum.escrowFactoryAddress,
        nearEscrowFactoryAddress: config.near.escrowFactoryAddress,
        pollingInterval: config.pollingInterval,
      }
    );
    
    // Start the relayer
    await ethereumRelayer.start();
    
    // Start the monitoring server
    const server = await startServer();
    setupGracefulShutdown(server);
    
    // Update block height metrics periodically
    const updateBlockHeights = async () => {
      try {
        const ethBlock = await provider.getBlockNumber();
        ethereumBlockHeight.set(ethBlock);
        
        // TODO: Update NEAR block height when NEAR client is implemented
        // const nearBlock = await nearClient.getBlockHeight();
        // nearBlockHeight.set(nearBlock);
      } catch (error) {
        logger.error('Error updating block heights:', error);
      }
    };
    
    // Initial update
    await updateBlockHeights();
    
    // Update block heights every 15 seconds
    const blockHeightInterval = setInterval(updateBlockHeights, 15000);
    
    logger.info('✅ Cross-Chain Relayer deployed and running!');
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    async function shutdown() {
      logger.info('🛑 Shutting down relayer...');
      clearInterval(blockHeightInterval);
      await ethereumRelayer.stop();
      server.close(() => {
        logger.info('✅ Server closed');
        process.exit(0);
      });
      
      // Force exit after timeout
      setTimeout(() => {
        logger.error('⚠️ Forcing shutdown after timeout');
        process.exit(1);
      }, 5000);
    }
    
  } catch (error) {
    logger.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

/**
 * Load and validate configuration from environment variables
 */
function loadConfig(): RelayerConfig {
  // Required environment variables
  const requiredVars = [
    'ETHEREUM_RPC_URL',
    'ETHEREUM_PRIVATE_KEY',
    'ETHEREUM_ESCROW_FACTORY_ADDRESS',
    'NEAR_NETWORK_ID',
    'NEAR_NODE_URL',
    'NEAR_ACCOUNT_ID',
    'NEAR_PRIVATE_KEY',
    'NEAR_ESCROW_FACTORY_ADDRESS',
  ];
  
  // Check for missing required variables
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
  
  // Build configuration object
  const config: RelayerConfig = {
    ethereum: {
      rpcUrl: process.env.ETHEREUM_RPC_URL!,
      privateKey: process.env.ETHEREUM_PRIVATE_KEY!,
      escrowFactoryAddress: process.env.ETHEREUM_ESCROW_FACTORY_ADDRESS!,
      chainId: parseInt(process.env.ETHEREUM_CHAIN_ID || '1', 10),
    },
    near: {
      networkId: process.env.NEAR_NETWORK_ID!,
      nodeUrl: process.env.NEAR_NODE_URL!,
      walletUrl: process.env.NEAR_WALLET_URL || `https://wallet.${process.env.NEAR_NETWORK_ID}.near.org`,
      helperUrl: process.env.NEAR_HELPER_URL || `https://helper.${process.env.NEAR_NETWORK_ID}.near.org`,
      explorerUrl: process.env.NEAR_EXPLORER_URL || `https://explorer.${process.env.NEAR_NETWORK_ID}.near.org`,
      accountId: process.env.NEAR_ACCOUNT_ID!,
      privateKey: process.env.NEAR_PRIVATE_KEY!,
      escrowFactoryAddress: process.env.NEAR_ESCROW_FACTORY_ADDRESS!,
    },
    pollingInterval: parseInt(process.env.POLLING_INTERVAL || '5000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
  
  return config;
}

// Run the deployment
if (require.main === module) {
  deploy().catch(error => {
    logger.error('Unhandled error in deployment:', error);
    process.exit(1);
  });
}

export { deploy };
