import { ethers } from 'ethers';
import { MOCK_CONFIG } from './test-config';

/**
 * Creates a mock Ethereum provider for testing
 */
export function createMockEthereumProvider() {
  return {
    getBlockNumber: jest.fn().mockResolvedValue(12345),
    getNetwork: jest.fn().mockResolvedValue({ chainId: MOCK_CONFIG.ethereum.chainId }),
    getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from(MOCK_CONFIG.ethereum.gasPrice)),
    estimateGas: jest.fn().mockResolvedValue(ethers.BigNumber.from(MOCK_CONFIG.ethereum.gasLimit)),
    getSigner: jest.fn().mockImplementation((address) => ({
      getAddress: jest.fn().mockResolvedValue(address || MOCK_CONFIG.ethereum.privateKey),
      signTransaction: jest.fn().mockResolvedValue('mock_signed_tx'),
      sendTransaction: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          status: 1,
          logs: [],
        }),
      }),
    })),
  };
}

/**
 * Creates a mock NEAR account for testing
 */
export function createMockNearAccount(accountId = MOCK_CONFIG.near.accountId) {
  return {
    accountId,
    connection: {},
    viewFunction: jest.fn().mockResolvedValue({
      filled_amount: '500000000000000000000000',
      remaining_amount: '500000000000000000000000',
      fill_count: 1,
      is_fully_filled: false,
      is_cancelled: false,
      last_fill_timestamp: Date.now() * 1000000,
      child_orders: [],
    }),
    functionCall: jest.fn().mockResolvedValue({
      transaction: { hash: 'mock_tx_hash' },
    }),
  };
}

/**
 * Creates a mock NEAR connection for testing
 */
export function createMockNearConnection() {
  return {
    account: jest.fn().mockImplementation((accountId) => 
      createMockNearAccount(accountId || MOCK_CONFIG.near.accountId)
    ),
  };
}

/**
 * Creates a mock Ethereum relayer configuration
 */
export function getMockEthereumRelayerConfig() {
  const provider = createMockEthereumProvider();
  const signer = provider.getSigner();
  
  return {
    provider,
    signer,
    contractAddress: MOCK_CONFIG.ethereum.contractAddress,
    chainId: MOCK_CONFIG.ethereum.chainId,
    gasLimit: MOCK_CONFIG.ethereum.gasLimit,
    gasPrice: MOCK_CONFIG.ethereum.gasPrice,
  };
}

/**
 * Creates a mock NEAR relayer configuration
 */
export function getMockNearRelayerConfig() {
  const connection = createMockNearConnection();
  
  return {
    networkId: MOCK_CONFIG.near.networkId,
    nodeUrl: MOCK_CONFIG.near.nodeUrl,
    walletUrl: MOCK_CONFIG.near.walletUrl,
    helperUrl: MOCK_CONFIG.near.helperUrl,
    explorerUrl: MOCK_CONFIG.near.explorerUrl,
    accountId: MOCK_CONFIG.near.accountId,
    contractName: MOCK_CONFIG.near.contractName,
    privateKey: MOCK_CONFIG.near.privateKey,
    connection,
    account: connection.account(),
  };
}

// Export all mocks as default
export default {
  createMockEthereumProvider,
  createMockNearAccount,
  createMockNearConnection,
  getMockEthereumRelayerConfig,
  getMockNearRelayerConfig,
};
