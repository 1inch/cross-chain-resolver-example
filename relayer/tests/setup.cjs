// Plain CommonJS Jest setup file
// Suppress console output during tests

const { MOCK_CONFIG } = require('./test-config.js');
const originalConsole = { ...global.console };
const consoleMocks = {
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

beforeAll(() => {
  Object.assign(global.console, consoleMocks);
});

afterAll(() => {
  Object.assign(global.console, originalConsole);
});

afterEach(() => {
  jest.clearAllMocks();
});

// Mock ethers.Contract so that:
// - All write method calls route through the injected signer's sendTransaction()
// - Read methods used by tests (getDetails) return data from provider._mockEscrow
// - Event filters and queryFilter return a mocked EscrowCreated event with escrowAddress
// - estimateGas.withdraw returns a reasonable mock BigNumber
jest.mock('ethers', () => {
  const original = jest.requireActual('ethers');
  return {
    ...original,
    Contract: jest.fn().mockImplementation((address, _abi, signerOrProvider) => {
      const state = {
        address,
        _signer: (signerOrProvider && typeof signerOrProvider.sendTransaction === 'function') ? signerOrProvider : null,
        _provider: (signerOrProvider && typeof signerOrProvider.sendTransaction !== 'function') ? signerOrProvider : null,
      };

      const handler = {
        get(_target, prop) {
          if (prop === 'address') return state.address;
          if (prop === 'connect') {
            return (signer) => {
              state._signer = signer;
              return new Proxy({}, handler);
            };
          }
          if (prop === 'filters') {
            return {
              EscrowCreated: () => ({ event: 'EscrowCreated' }),
            };
          }
          if (prop === 'queryFilter') {
            return async (_filter, _fromBlock, _toBlock) => {
              const escrow = state._provider && state._provider._mockEscrow ? state._provider._mockEscrow : null;
              const escrowAddress = escrow && escrow.escrowAddress ? escrow.escrowAddress : ('0x' + '5'.repeat(40));
              return [
                {
                  args: [escrowAddress],
                  blockNumber: 1,
                },
              ];
            };
          }
          if (prop === 'estimateGas') {
            return new Proxy({}, {
              get(_t, gasProp) {
                if (gasProp === 'withdraw') {
                  return async () => original.BigNumber.from('100000');
                }
                return async () => original.BigNumber.from('100000');
              },
            });
          }
          if (prop === 'getDetails') {
            return async () => {
              const escrow = state._provider && state._provider._mockEscrow ? state._provider._mockEscrow : null;
              if (!escrow) {
                return {
                  status: 1,
                  token: '0x' + '0'.repeat(40),
                  amount: original.BigNumber.from('0'),
                  timelock: original.BigNumber.from(Math.floor(Date.now() / 1000) + 3600),
                  secretHash: '0x' + '1'.repeat(64),
                  initiator: '0x' + '2'.repeat(40),
                  recipient: '0x' + '3'.repeat(40),
                  chainId: original.BigNumber.from(11155111),
                };
              }
              const toBN = (v) => (typeof v === 'string' || typeof v === 'number') ? original.BigNumber.from(v.toString()) : v;
              return {
                status: escrow.status === 'active' ? 1 : (escrow.status === 'withdrawn' ? 2 : 0),
                token: escrow.token || '0x' + '0'.repeat(40),
                amount: toBN(escrow.amount || '0'),
                timelock: toBN(escrow.timelock || Math.floor(Date.now() / 1000) + 3600),
                secretHash: escrow.secretHash || ('0x' + '1'.repeat(64)),
                initiator: escrow.initiator || ('0x' + '2'.repeat(40)),
                recipient: escrow.recipient || ('0x' + '3'.repeat(40)),
                chainId: toBN(escrow.chainId || 11155111),
              };
            };
          }
          // For any other string property access, treat as a write method
          if (typeof prop === 'string') {
            return (...args) => {
              const last = args.length > 0 ? args[args.length - 1] : undefined;
              const overrides = last && typeof last === 'object' && ((('gasLimit' in last)) || ('value' in last)) ? last : undefined;
              if (state._signer && typeof state._signer.sendTransaction === 'function') {
                const txRequest = {
                  to: state.address,
                  data: '0x',
                  ...(overrides && overrides.value ? { value: overrides.value } : {}),
                };
                return state._signer.sendTransaction(txRequest);
              }
              return Promise.resolve({
                hash: '0x' + '1'.repeat(64),
                wait: jest.fn().mockResolvedValue({ status: 1, logs: [], transactionHash: '0x' + '1'.repeat(64) }),
              });
            };
          }
          return undefined;
        },
      };

      return new Proxy({}, handler);
    }),
  };
});
