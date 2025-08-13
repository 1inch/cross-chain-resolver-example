import { jest } from '@jest/globals';
import { BigNumber } from 'ethers';
import { EthereumPartialFillService } from '../../../src/services/EthereumPartialFillService';
import { logger } from '../../../src/utils/logger';

// Mock logger to prevent console output during tests
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock ethers provider and signer
const mockProvider = {
  getBlockNumber: jest.fn(async () => 1000000),
  getNetwork: jest.fn(async () => ({ chainId: 1 })),
};

const mockSigner = {
  getAddress: jest.fn(async () => '0x1234567890123456789012345678901234567890'),
  getChainId: jest.fn(async () => 1),
  signMessage: jest.fn(async () => '0xsignedMessage'),
  sendTransaction: jest.fn(async () => ({
    hash: '0x' + '1'.repeat(64),
    wait: jest.fn(async () => ({
      status: 1,
      logs: [] as any[],
    })),
  })),
};

describe('EthereumPartialFillService', () => {
  let service: EthereumPartialFillService;
  const resolverAddress = '0x1234567890123456789012345678901234567890';
  const resolverAbi = [
    'function processPartialFill(bytes32,uint256,address,address,uint8,uint8) external returns (bool)',
    'function splitOrder(bytes32,uint256[]) external returns (bytes32[])',
    'function processRefund(bytes32,address) external returns (bool)',
    'function getOrderState(bytes32) external view returns (uint256,uint256,uint8,bool,bool,uint256,bytes32[])'
  ];
  
  // Sample order data for testing
  const sampleOrderHash = '0x1234567890123456789012345678901234567890123456789012345678901234';
  const sampleFillAmount = '1000000000000000000'; // 1 ETH in wei
  const sampleRecipient = '0x9876543210987654321098765432109876543210';
  const sampleToken = '0x1111111111111111111111111111111111111111';
  
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Initialize the service with mock provider and signer
    service = new EthereumPartialFillService(
      mockProvider as any,
      mockSigner as any,
      resolverAddress,
      resolverAbi
    );
  });
  
  describe('processPartialFill', () => {
    it('should process a partial fill successfully', async () => {
      // Arrange
      const mockTxResponse = {
        hash: '0x' + '1'.repeat(64),
        wait: jest.fn(async () => ({ status: 1 })),
      };
      
      const mockContract = {
        processPartialFill: jest.fn(async () => mockTxResponse),
      };
      
      // Recreate service with injected ethers-like Contract mock
      service = new EthereumPartialFillService(
        mockProvider as any,
        mockSigner as any,
        resolverAddress,
        resolverAbi,
        { ethersLike: { Contract: jest.fn(() => mockContract) } as any }
      );
      
      // Act
      const result = await service.processPartialFill({
        orderHash: sampleOrderHash,
        fillAmount: sampleFillAmount,
        recipient: sampleRecipient,
        token: sampleToken,
      });
      
      // Assert
      expect(result).toBe(mockTxResponse);
      expect(mockContract.processPartialFill).toHaveBeenCalledWith(
        sampleOrderHash,
        sampleFillAmount,
        sampleRecipient,
        sampleToken,
        10, // minFillPercent (default)
        10, // maxFills (default)
        { gasLimit: 500000 }
      );
      expect(logger.info).toHaveBeenCalledWith(
        `Partial fill transaction sent for order ${sampleOrderHash}`,
        { txHash: '0x' + '1'.repeat(64) }
      );
    });
    
    it('should handle errors during partial fill', async () => {
      // Arrange
      const error = new Error('Transaction failed');
      const mockContract = {
        processPartialFill: jest.fn(async () => { throw error; }),
      };
      
      // Recreate service with injected ethers-like Contract mock
      service = new EthereumPartialFillService(
        mockProvider as any,
        mockSigner as any,
        resolverAddress,
        resolverAbi,
        { ethersLike: { Contract: jest.fn(() => mockContract) } as any }
      );
      
      // Act & Assert
      await expect(
        service.processPartialFill({
          orderHash: sampleOrderHash,
          fillAmount: sampleFillAmount,
          recipient: sampleRecipient,
          token: sampleToken,
        })
      ).rejects.toThrow(error);
      
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to process partial fill for order ${sampleOrderHash}`,
        { error }
      );
    });
  });
  
  describe('splitOrder', () => {
    it('should split an order into multiple parts', async () => {
      // Arrange
      const amounts = ['500000000000000000', '500000000000000000']; // Split into two 0.5 ETH orders
      const mockTxResponse = {
        hash: '0x' + '2'.repeat(64),
        wait: jest.fn(async () => ({ status: 1 })),
      };
      
      const mockContract = {
        splitOrder: jest.fn(async () => mockTxResponse),
      };
      
      // Recreate service with injected ethers-like Contract mock
      service = new EthereumPartialFillService(
        mockProvider as any,
        mockSigner as any,
        resolverAddress,
        resolverAbi,
        { ethersLike: { Contract: jest.fn(() => mockContract) } as any }
      );
      
      // Act
      const result = await service.splitOrder(sampleOrderHash, amounts);
      
      // Assert
      expect(result).toBe(mockTxResponse);
      expect(mockContract.splitOrder).toHaveBeenCalledWith(
        sampleOrderHash,
        amounts,
        { gasLimit: 300000 }
      );
      expect(logger.info).toHaveBeenCalledWith(
        `Order split transaction sent for ${sampleOrderHash}`,
        { txHash: '0x' + '2'.repeat(64) }
      );
    });
  });
  
  describe('processRefund', () => {
    it('should process a refund successfully', async () => {
      // Arrange
      const mockTxResponse = {
        hash: '0x' + '3'.repeat(64),
        wait: jest.fn(async () => ({ status: 1 })),
      };
      
      const mockContract = {
        processRefund: jest.fn(async () => mockTxResponse),
      };
      
      // Recreate service with injected ethers-like Contract mock
      service = new EthereumPartialFillService(
        mockProvider as any,
        mockSigner as any,
        resolverAddress,
        resolverAbi,
        { ethersLike: { Contract: jest.fn(() => mockContract) } as any }
      );
      
      // Act
      const result = await service.processRefund(sampleOrderHash, sampleRecipient);
      
      // Assert
      expect(result).toBe(mockTxResponse);
      expect(mockContract.processRefund).toHaveBeenCalledWith(
        sampleOrderHash,
        sampleRecipient,
        { gasLimit: 200000 }
      );
      expect(logger.info).toHaveBeenCalledWith(
        `Refund transaction sent for order ${sampleOrderHash}`,
        { txHash: '0x' + '3'.repeat(64) }
      );
    });
  });
  
  describe('getOrderState', () => {
    it('should return the current state of an order', async () => {
      // Arrange
      const mockState = {
        filledAmount: BigNumber.from('500000000000000000'), // 0.5 ETH
        remainingAmount: BigNumber.from('500000000000000000'), // 0.5 ETH
        fillCount: 1,
        isFullyFilled: false,
        isCancelled: false,
        lastFillTimestamp: Math.floor(Date.now() / 1000),
        childOrders: [] as string[],
      };
      
      const mockContract = {
        getOrderState: jest.fn(async () => [
          mockState.filledAmount,
          mockState.remainingAmount,
          mockState.fillCount,
          mockState.isFullyFilled,
          mockState.isCancelled,
          mockState.lastFillTimestamp,
          mockState.childOrders,
        ] as any),
      };
      
      // Recreate service with injected ethers-like Contract mock
      service = new EthereumPartialFillService(
        mockProvider as any,
        mockSigner as any,
        resolverAddress,
        resolverAbi,
        { ethersLike: { Contract: jest.fn(() => mockContract) } as any }
      );
      
      // Act
      const state = await service.getOrderState(sampleOrderHash);
      
      // Assert
      expect(state).toEqual({
        filledAmount: '500000000000000000',
        remainingAmount: '500000000000000000',
        fillCount: 1,
        isFullyFilled: false,
        isCancelled: false,
        lastFillTimestamp: expect.any(Number),
        childOrders: [],
      });
      
      expect(mockContract.getOrderState).toHaveBeenCalledWith(sampleOrderHash);
    });
  });
  
  describe('canPartiallyFill', () => {
    it('should return true if the order can be partially filled', async () => {
      // Arrange
      const mockContract = {
        getOrderState: jest.fn(async () => [
          BigNumber.from('500000000000000000'), // 0.5 ETH filled
          BigNumber.from('500000000000000000'), // 0.5 ETH remaining
          1, // fillCount
          false, // isFullyFilled
          false, // isCancelled
          Math.floor(Date.now() / 1000), // lastFillTimestamp
          [] as string[], // childOrders
        ] as any),
      };
      
      // Recreate service with injected ethers-like Contract mock
      service = new EthereumPartialFillService(
        mockProvider as any,
        mockSigner as any,
        resolverAddress,
        resolverAbi,
        { ethersLike: { Contract: jest.fn(() => mockContract) } as any }
      );
      
      // Act
      const result = await service.canPartiallyFill(
        sampleOrderHash,
        '100000000000000000' // 0.1 ETH (10% of remaining)
      );
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false if the order is already fully filled', async () => {
      // Arrange
      const mockContract = {
        getOrderState: jest.fn(async () => [
          BigNumber.from('1000000000000000000'), // 1 ETH filled
          BigNumber.from('0'), // 0 ETH remaining
          1, // fillCount
          true, // isFullyFilled
          false, // isCancelled
          Math.floor(Date.now() / 1000), // lastFillTimestamp
          [] as string[], // childOrders
        ] as any),
      };
      
      // Recreate service with injected ethers-like Contract mock
      service = new EthereumPartialFillService(
        mockProvider as any,
        mockSigner as any,
        resolverAddress,
        resolverAbi,
        { ethersLike: { Contract: jest.fn(() => mockContract) } as any }
      );
      
      // Act
      const result = await service.canPartiallyFill(
        sampleOrderHash,
        '100000000000000000' // 0.1 ETH
      );
      
      // Assert
      expect(result).toBe(false);
    });
  });
  
  describe('estimateGasForPartialFill', () => {
    it('should estimate gas with a buffer', async () => {
      // Arrange
      const estimatedGas = BigNumber.from('300000');
      const expectedGasWithBuffer = estimatedGas.mul(120).div(100);
      
      const mockContract = {
        estimateGas: {
          processPartialFill: jest.fn(async () => estimatedGas),
        },
      };
      
      // Recreate service with injected ethers-like Contract mock
      service = new EthereumPartialFillService(
        mockProvider as any,
        mockSigner as any,
        resolverAddress,
        resolverAbi,
        { ethersLike: { Contract: jest.fn(() => mockContract) } as any }
      );
      
      // Act
      const result = await service.estimateGasForPartialFill({
        orderHash: sampleOrderHash,
        fillAmount: sampleFillAmount,
        recipient: sampleRecipient,
        token: sampleToken,
      });
      
      // Assert
      expect(result).toEqual(expectedGasWithBuffer);
    });
  });
});
