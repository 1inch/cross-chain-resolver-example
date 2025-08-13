import { ethers } from 'ethers';

// Configuration for deployment
export interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
  privateKey: string;
  verifyContract: boolean;
  explorerUrl?: string;
  apiKey?: string;
}

// Get configuration from environment variables
export function getConfig(): NetworkConfig {
  const chainId = parseInt(process.env.CHAIN_ID || '11155111'); // Default to Sepolia
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
  const privateKey = process.env.PRIVATE_KEY || '';
  
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }

  return {
    chainId,
    rpcUrl,
    privateKey,
    verifyContract: process.env.VERIFY_CONTRACT === 'true',
    explorerUrl: process.env.EXPLORER_URL,
    apiKey: process.env.API_KEY
  };
}

// Get a provider for the network
export function getProvider(rpcUrl: string): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(rpcUrl);
}

// Get a signer for transactions
export function getSigner(privateKey: string, provider: ethers.JsonRpcProvider): ethers.Wallet {
  return new ethers.Wallet(privateKey, provider);
}
