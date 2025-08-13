import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Silence logs
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/logger.js', () => ({
  __esModule: true,
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Capture constructor args
type CtorArg = any;
let ethereumCtorArgs: CtorArg[] = [];
let nearCtorArgs: CtorArg[] = [];

// Expected auction config
const expectedAuction = {
  duration: 321,
  initialRateBump: 777,
  points: [{ delay: 0, coefficient: 0 }],
  gasBumpEstimate: 1234,
  gasPriceEstimate: 9,
  minFillPercentage: 0.15,
  maxRateBump: 999999,
};

// Required env vars used by src/index.ts
const REQUIRED_ENV: Record<string, string> = {
  ETHEREUM_RPC_URL: 'http://localhost:8545',
  ETHEREUM_CHAIN_ID: '11155111',
  DEPLOYER_PRIVATE_KEY: '0x' + '3'.repeat(64),
  ETHEREUM_PRIVATE_KEY: '0x' + '3'.repeat(64),
  NEAR_NETWORK_ID: 'testnet',
  NEAR_NODE_URL: 'https://rpc.testnet.near.org',
  NEAR_RELAYER_ACCOUNT_ID: 'relayer.testnet',
  NEAR_RELAYER_PRIVATE_KEY: 'ed25519:' + 'b'.repeat(44),
  ETHEREUM_ESCROW_FACTORY_ADDRESS: '0x' + 'c'.repeat(40),
  ETHEREUM_BRIDGE_ADDRESS: '0x' + 'd'.repeat(40),
  NEAR_ESCROW_CONTRACT_ID: 'escrow.testnet',
  RELAYER_POLL_INTERVAL: '100',
};

describe('Relayer startup auctionConfig injection', () => {
  const saved: Record<string, string | undefined> = {};
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let maxListenersSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    ethereumCtorArgs = [];
    nearCtorArgs = [];
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      // swallow exit in tests
      return undefined as never;
    }) as any);
    maxListenersSpy = jest.spyOn(process, 'setMaxListeners').mockImplementation((() => {
      return process as any;
    }) as any);
    process.env.RELAYER_AUTO_START = 'false';
    for (const [k, v] of Object.entries(REQUIRED_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });

  afterEach(() => {
    jest.resetModules();
    if (exitSpy) exitSpy.mockRestore();
    if (maxListenersSpy) maxListenersSpy.mockRestore();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('passes ConfigurationService.auction into EthereumRelayer constructor at startup', async () => {
    let EthCtor!: jest.Mock;
    let NearCtor!: jest.Mock;
    // Load index.ts in isolated context to trigger main()
    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(() => {
        try {
          // Ethers mocks to avoid real network calls in index.ts
          class MockProvider {
            url: string;
            constructor(url: string) { this.url = url; }
            async getNetwork() { return { name: 'sepolia', chainId: 11155111 }; }
          }
          class MockWallet {
            public provider: any;
            constructor(_pk: string, provider: any) { this.provider = provider; }
            async getAddress() { return '0x' + '1'.repeat(40); }
          }

          // Mock NEAR libs used by index.ts
          jest.doMock('@near-js/providers', () => ({
            __esModule: true,
            JsonRpcProvider: class {
              url: string;
              constructor({ url }: { url: string }) { this.url = url; }
            },
            Provider: class {},
          }));
          jest.doMock('@near-js/signers', () => ({
            __esModule: true,
            KeyPairSigner: class {
              static fromSecretKey(_sk: string) { return {}; }
            },
          }));
          jest.doMock('@near-js/accounts', () => ({
            __esModule: true,
            Account: class {
              accountId: string;
              constructor(accountId: string, _provider: any, _signer: any) {
                this.accountId = accountId;
              }
              async functionCall() { return { status: { SuccessValue: '' } }; }
            },
          }));

          const { main } = require('../../src/index.ts');

          EthCtor = jest.fn(function (this: any, cfg: any) {
            ethereumCtorArgs.push(cfg);
            this.start = jest.fn(async () => {});
            this.stop = jest.fn(async () => {});
          });
          NearCtor = jest.fn(function (this: any, _cfg: any) {
            nearCtorArgs.push(_cfg);
            this.start = jest.fn(async () => {});
            this.stop = jest.fn(async () => {});
          });

          const cfgService = {
            loadForEnvironment: async () => ({
              environment: 'development',
              near: {
                networkId: 'testnet',
                nodeUrl: 'https://rpc.testnet.near.org',
                accountId: 'relayer.testnet',
                privateKey: 'ed25519:' + 'a'.repeat(44),
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
              relayer: { storageDir: './storage', pollingInterval: 5000, maxRetries: 3, retryDelay: 1000, batchSize: 10, logLevel: 'info', enableMetrics: false, metricsPort: 3001 },
              auction: expectedAuction,
            }),
            createTemplate: () => ({ auction: expectedAuction }),
          };

          (main as Function)({
            EthereumRelayerCtor: EthCtor as any,
            NearRelayerCtor: NearCtor as any,
            ConfigService: cfgService as any,
            Ethers: { providers: { JsonRpcProvider: MockProvider }, Wallet: MockWallet },
          }).then(() => resolve()).catch(reject);
        } catch (e) {
          reject(e);
        }
      });
    });

    expect(EthCtor.mock.calls.length).toBe(1);
    const cfgArg = EthCtor.mock.calls[0][0] as any;
    expect(cfgArg.auctionConfig).toEqual(expectedAuction);
  });
});
