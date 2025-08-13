import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Import using require to align with CJS-compatible jest config
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ConfigurationService } = require('../../src/config/ConfigurationService');

const REQUIRED_ENV = {
  NEAR_NETWORK_ID: 'testnet',
  NEAR_NODE_URL: 'https://rpc.testnet.near.org',
  NEAR_RELAYER_ACCOUNT_ID: 'relayer.testnet',
  NEAR_RELAYER_PRIVATE_KEY: 'ed25519:'.padEnd(64, 'a'),
  ETHEREUM_RPC_URL: 'http://localhost:8545',
  ETHEREUM_CHAIN_ID: '11155111',
  DEPLOYER_PRIVATE_KEY: '0x' + '1'.repeat(64),
  NEAR_ESCROW_CONTRACT_ID: 'escrow.testnet',
};

function writeConfig(dir: string) {
  const configDir = path.join(dir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const baseConfig = {
    environment: 'development',
    near: {
      networkId: 'testnet',
      nodeUrl: 'https://rpc.testnet.near.org',
      accountId: 'relayer.testnet',
      privateKey: 'ed25519:'.padEnd(64, 'b'),
      escrowContractId: 'escrow.testnet',
    },
    ethereum: {
      network: {
        name: 'sepolia',
        rpcUrl: 'http://localhost:8545',
        chainId: 11155111,
        blockConfirmations: 1,
      },
      privateKey: '0x' + '2'.repeat(64),
      escrowContractAddress: '0x' + 'a'.repeat(40),
      bridgeContractAddress: '0x' + 'b'.repeat(40),
    },
    relayer: {
      pollingInterval: 5000,
      maxRetries: 3,
      retryDelay: 1000,
      batchSize: 10,
      storageDir: './storage',
      logLevel: 'info',
      enableMetrics: false,
      metricsPort: 3001,
    },
    auction: {
      duration: 180,
      initialRateBump: 50000,
      points: [
        { delay: 30, coefficient: 40000 },
        { delay: 60, coefficient: 30000 },
        { delay: 90, coefficient: 20000 },
      ],
      gasBumpEstimate: 5000,
      gasPriceEstimate: 20,
      minFillPercentage: 0.1,
      maxRateBump: 500000,
    },
  };
  fs.writeFileSync(path.join(configDir, 'config.development.json'), JSON.stringify(baseConfig, null, 2));
  return configDir;
}

describe('ConfigurationService - AUCTION_* env overrides', () => {
  const toCleanup: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and set required env vars
    for (const [k, v] of Object.entries(REQUIRED_ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
  });

  afterEach(() => {
    // Restore env
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // Cleanup tmp dirs
    for (const d of toCleanup) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    toCleanup.length = 0;
    // Clear overrides from process.env
    delete process.env.AUCTION_DURATION;
    delete process.env.AUCTION_INITIAL_RATE_BUMP;
    delete process.env.AUCTION_POINTS;
    delete process.env.AUCTION_GAS_BUMP_ESTIMATE;
    delete process.env.AUCTION_GAS_PRICE_ESTIMATE;
    delete process.env.AUCTION_MIN_FILL_PERCENTAGE;
    delete process.env.AUCTION_MAX_RATE_BUMP;
  });

  it('applies AUCTION_* env variable overrides onto loaded config', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    toCleanup.push(tmp);
    const configDir = writeConfig(tmp);

    // Set overrides
    process.env.AUCTION_DURATION = '240';
    process.env.AUCTION_INITIAL_RATE_BUMP = '12345';
    const points = [ { delay: 0, coefficient: 60000 }, { delay: 60, coefficient: 30000 } ];
    process.env.AUCTION_POINTS = JSON.stringify(points);
    process.env.AUCTION_GAS_BUMP_ESTIMATE = '7000';
    process.env.AUCTION_GAS_PRICE_ESTIMATE = '42.5';
    process.env.AUCTION_MIN_FILL_PERCENTAGE = '0.25';
    process.env.AUCTION_MAX_RATE_BUMP = '999999';

    const cfg = await ConfigurationService.loadForEnvironment('development', configDir);
    expect(cfg.auction).toBeDefined();

    // Verify overrides applied
    expect(cfg.auction!.duration).toBe(240);
    expect(cfg.auction!.initialRateBump).toBe(12345);
    expect(cfg.auction!.points).toEqual(points);
    expect(cfg.auction!.gasBumpEstimate).toBe(7000);
    expect(cfg.auction!.gasPriceEstimate).toBeCloseTo(42.5);
    expect(cfg.auction!.minFillPercentage).toBeCloseTo(0.25);
    expect(cfg.auction!.maxRateBump).toBe(999999);
  });
});
