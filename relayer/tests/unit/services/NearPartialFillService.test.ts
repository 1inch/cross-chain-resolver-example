import { jest } from '@jest/globals';
import { NearPartialFillService } from '../../../src/services/NearPartialFillService';
import { logger } from '../../../src/utils/logger';

// Mock logger to prevent console output during tests
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('NearPartialFillService', () => {
  let service: NearPartialFillService;
  let mockNearAccount: any;
  let mockProvider: any;
  const contractId = 'test-contract.testnet';
  
  // Sample order data for testing
  const sampleOrderId = 'order-123';
  const sampleFillAmount = '1000000000000000000'; // 1 NEAR in yoctoNEAR
  const sampleRecipient = 'test-recipient.testnet';
  const sampleToken = 'wrap.testnet';
  
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Create typed mocks to avoid TS 'never' inference issues
    const functionCall = jest.fn() as jest.MockedFunction<(args: any) => Promise<any>>;
    functionCall.mockResolvedValue({} as any);
    const viewFunction = jest.fn() as jest.MockedFunction<(args: any) => Promise<any>>;

    // Create a mock NEAR account
    mockNearAccount = {
      functionCall,
      viewFunction,
    };

    // Create a mock provider used by the service for view calls
    const callFunction = jest.fn() as jest.MockedFunction<(
      contractId: string,
      methodName: string,
      args: any
    ) => Promise<any>>;
    callFunction.mockResolvedValue({
      filled_amount: '500000000000000000', // 0.5 NEAR filled
      remaining_amount: '500000000000000000', // 0.5 NEAR remaining
      fill_count: 1,
      is_fully_filled: false,
      is_cancelled: false,
      last_fill_timestamp: Math.floor(Date.now() / 1000),
      child_orders: [],
    } as any);
    mockProvider = { callFunction };
    
    // Initialize the service with the mock account
    service = new NearPartialFillService(mockNearAccount, mockProvider, contractId);
  });
  
  describe('processPartialFill', () => {
    it('should process a partial fill successfully', async () => {
      // Act
      const result = await service.processPartialFill({
        orderId: sampleOrderId,
        fillAmount: sampleFillAmount,
        recipient: sampleRecipient,
        token: sampleToken,
      });
      
      // Assert
      expect(result).toBe(true);
      expect(mockNearAccount.functionCall).toHaveBeenCalledWith({
        contractId,
        methodName: 'process_partial_fill',
        args: {
          order_id: sampleOrderId,
          fill_amount: sampleFillAmount,
          recipient: sampleRecipient,
          token: sampleToken,
          min_fill_percent: 10,
          max_fills: 10,
        },
        gas: 300000000000000n,
        attachedDeposit: 0n,
      });
      expect(logger.info).toHaveBeenCalledWith(
        `Processing partial fill for order ${sampleOrderId}`,
        expect.any(Object)
      );
    });
    
    it('should throw an error if the contract call fails', async () => {
      // Arrange
      const error = new Error('Contract call failed');
      mockNearAccount.functionCall.mockRejectedValue(error);
      
      // Act & Assert
      await expect(
        service.processPartialFill({
          orderId: sampleOrderId,
          fillAmount: sampleFillAmount,
          recipient: sampleRecipient,
          token: sampleToken,
        })
      ).rejects.toThrow(error);
      
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to process partial fill for order ${sampleOrderId}`,
        { error }
      );
    });
  });
  
  describe('splitOrder', () => {
    it('should split an order into multiple parts', async () => {
      // Arrange
      const amounts = ['500000000000000000', '500000000000000000']; // Split into two 0.5 NEAR orders
      const expectedResult = { orderIds: ['child-1', 'child-2'] };
      mockNearAccount.functionCall.mockResolvedValueOnce(expectedResult);
      
      // Act
      const result = await service.splitOrder(sampleOrderId, amounts);
      
      // Assert
      expect(result).toEqual(expectedResult);
      expect(mockNearAccount.functionCall).toHaveBeenCalledWith({
        contractId,
        methodName: 'split_order',
        args: {
          order_id: sampleOrderId,
          amounts,
        },
        gas: 300000000000000n,
        attachedDeposit: 0n,
      });
    });
  });
  
  describe('processRefund', () => {
    it('should process a refund successfully', async () => {
      // Act
      const result = await service.processRefund(sampleOrderId, sampleRecipient);
      
      // Assert
      expect(result).toBe(true);
      expect(mockNearAccount.functionCall).toHaveBeenCalledWith({
        contractId,
        methodName: 'process_refund',
        args: {
          order_id: sampleOrderId,
          recipient: sampleRecipient,
        },
        gas: 200000000000000n,
        attachedDeposit: 0n,
      });
    });
  });
  
  describe('getOrderState', () => {
    it('should return the current state of an order', async () => {
      // Act
      const state = await service.getOrderState(sampleOrderId);
      
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
      
      expect(mockProvider.callFunction).toHaveBeenCalledWith(
        contractId,
        'get_order_state',
        { order_id: sampleOrderId }
      );
    });
  });
  
  describe('canPartiallyFill', () => {
    it('should return true if the order can be partially filled', async () => {
      // Arrange
      const fillAmount = '100000000000000000'; // 0.1 NEAR (10% of remaining)
      
      // Act
      const result = await service.canPartiallyFill(sampleOrderId, fillAmount);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false if the order is already fully filled', async () => {
      // Arrange
      mockProvider.callFunction.mockResolvedValueOnce({
        filled_amount: '1000000000000000000', // 1 NEAR filled
        remaining_amount: '0', // 0 NEAR remaining
        fill_count: 1,
        is_fully_filled: true,
        is_cancelled: false,
        last_fill_timestamp: Math.floor(Date.now() / 1000),
        child_orders: [],
      });
      
      // Act
      const result = await service.canPartiallyFill(sampleOrderId, '100000000000000000');
      
      // Assert
      expect(result).toBe(false);
    });
    
    it('should return false if the fill amount is too small', async () => {
      // Arrange
      const tinyFillAmount = '1000000000000000'; // 0.001 NEAR (0.1% of remaining)
      
      // Act
      const result = await service.canPartiallyFill(sampleOrderId, tinyFillAmount);
      
      // Assert
      expect(result).toBe(false);
    });
  });
});
