/*
 Minimal E2E runner for NEAR→ETH on a Sepolia fork.
 Requirements:
  - Run a local fork first: anvil --fork-url $SEPOLIA_RPC_URL --chain-id 11155111 --port 8545
  - Set env: RPC_URL, FACTORY_ADDRESS, BRIDGE_ADDRESS, PRIVATE_KEY, NEAR_ESCROW_CONTRACT_ID
*/

import 'dotenv/config';
import { ethers } from 'ethers';
import { EthereumRelayer, EthereumRelayerConfig } from '../src/relay/EthereumRelayer.js';
import type { DepositMessage } from '../src/types/interfaces.js';
import { MessageType } from '../src/types/interfaces.js';

async function main() {
  const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS as string;
  const BRIDGE_ADDRESS = process.env.BRIDGE_ADDRESS as string;
  const PRIVATE_KEY = process.env.PRIVATE_KEY as string;
  const NEAR_ESCROW_CONTRACT_ID = process.env.NEAR_ESCROW_CONTRACT_ID as string;
  if (!FACTORY_ADDRESS || !BRIDGE_ADDRESS || !PRIVATE_KEY || !NEAR_ESCROW_CONTRACT_ID) {
    throw new Error('Missing required env: FACTORY_ADDRESS, BRIDGE_ADDRESS, PRIVATE_KEY, NEAR_ESCROW_CONTRACT_ID');
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL, { chainId: 11155111, name: 'sepolia' });
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  // Minimal nearAccount stub (not used by NEAR→ETH deposit path)
  const nearAccount = {
    async functionCall() {
      throw new Error('nearAccount.functionCall not expected in NEAR→ETH deposit flow');
    }
  } as any;

  const config: EthereumRelayerConfig = {
    provider,
    signer,
    nearAccount,
    factoryAddress: FACTORY_ADDRESS,
    bridgeAddress: BRIDGE_ADDRESS,
    resolverAddress: ethers.constants.AddressZero,
    resolverAbi: [],
    pollIntervalMs: 2000,
    storageDir: `storage/e2e-${Date.now()}`,
    concurrencyLimit: Number(process.env.CONCURRENCY_LIMIT || 3),
    retry: {
      default: { retries: 3, minDelayMs: 250, maxDelayMs: 3000, factor: 2, jitter: true, shouldRetry: () => true },
      factoryTx: { retries: 4, minDelayMs: 300, maxDelayMs: 5000, factor: 2, jitter: true, shouldRetry: (e) => /UNPREDICTABLE_GAS_LIMIT|rate limit|nonce|network|ETIMEOUT/i.test((e as any)?.message || '') },
      receipt: { retries: 5, minDelayMs: 500, maxDelayMs: 8000, factor: 2, jitter: true, shouldRetry: (e) => /timeout|rpc|ETIMEOUT/i.test((e as any)?.message || '') },
    }
  };

  const relayer = new EthereumRelayer(config);

  // Construct a NEAR→ETH DepositMessage mimicking a message from bridge
  const now = Math.floor(Date.now() / 1000);
  const secretHash = '0x' + '5'.repeat(64);
  const message: DepositMessage = {
    type: MessageType.DEPOSIT,
    messageId: `e2e_deposit_${Date.now()}`,
    sourceChain: 'NEAR',
    destChain: 'ETH',
    sender: 'alice.near',
    recipient: await signer.getAddress(),
    amount: '1000000000000000000', // 1 NEAR in yocto or ignored depending on auction impl
    token: ethers.constants.AddressZero,
    secretHash,
    timelock: now + 3600,
    data: {
      txHash: 'NEARtxHashE2E'.padEnd(32, 'E'),
      secretHash,
      timelock: now + 3600,
    },
    timestamp: Date.now(),
  };

  console.log('Sending NEAR→ETH deposit message to relayer...');
  await relayer.processMessage(message);
  console.log('Message processed. Check your fork logs and the emitted DstEscrowCreated event.');
}

main().catch((err) => {
  console.error('E2E runner failed:', err);
  process.exit(1);
});
