import { ethers } from 'ethers';
import { jest } from '@jest/globals';
import { EscrowSearchParams } from '../../src/types/interfaces';

// Import mock after jest.mock
import { MockProvider } from '../mocks/ethers-mock-enhanced';

// Type-safe mock implementations (synchronous to match real service)
const mockValidationService = {
  validateEthereumAddress: jest.fn((address: string): boolean => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error('Invalid Ethereum address');
    }
    return true;
  }),
  
  validateSecret: jest.fn((secret: string): boolean => {
    if (!secret || typeof secret !== 'string' || secret.trim() === '') {
      throw new Error('Secret must be a non-empty string');
    }
    return true;
  }),
  
  validateSecretHash: jest.fn((hash: string): boolean => {
    if (!hash || typeof hash !== 'string' || hash.trim() === '') {
      throw new Error('Secret hash is required');
    }
    return true;
  }),
  
  validateAmount: jest.fn((amount: string | bigint): boolean => {
    const amountStr = amount.toString();
    if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n) {
      throw new Error('Invalid amount');
    }
    return true;
  }),
  
  validateEscrowDetails: jest.fn((details: unknown): boolean => {
    if (!details) {
      throw new Error('Escrow details are required');
    }
    return true;
  })
};

// Mock the ValidationService
jest.mock('../../src/services/ValidationService', () => ({
  ValidationService: jest.fn(() => mockValidationService)
}));

// Import the service after setting up mocks
import { EthereumContractService } from '../../src/services/EthereumContractService';

describe('EthereumContractService Edge Cases', () => {
  let service: EthereumContractService;
  let mockProvider: MockProvider;
  let mockSigner: ethers.Wallet;
  const factoryAddress = '0x1234567890123456789012345678901234567890';

  beforeEach(() => {
    // Create a mock provider and signer
    mockProvider = new MockProvider();
    mockSigner = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Hardhat default private key
      mockProvider as any
    );
    
    // Mock the getAddress method
    jest.spyOn(mockSigner, 'getAddress').mockResolvedValue('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    
    // Initialize the service with mock provider and signer
    service = new EthereumContractService(
      mockProvider as unknown as ethers.providers.JsonRpcProvider,
      mockSigner as unknown as ethers.Signer,
      factoryAddress
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEscrowDetails', () => {
    it('should handle invalid escrow address', async () => {
      const invalidAddress = '0xinvalid';
      
      await expect(service.getEscrowDetails(invalidAddress))
        .rejects
        .toThrow('Failed to get escrow details');
    });

    it('should handle contract call failure', async () => {
      const escrowAddress = '0x1234567890123456789012345678901234567891';
      const mockError = new Error('Contract call failed');
      
      // Mock underlying contract.getDetails to fail so service wrapper throws ContractError
      const contractSpy = jest
        .spyOn(ethers as any, 'Contract')
        .mockImplementation(() => ({
          getDetails: jest.fn(async () => { throw mockError; })
        }));
      
      await expect(service.getEscrowDetails(escrowAddress))
        .rejects
        .toThrow('Failed to get escrow details');
      
      contractSpy.mockRestore();
    });
  });

  describe('findEscrowBySecretHash', () => {
    it('should handle empty secret hash', async () => {
      await expect(service.findEscrowBySecretHash(''))
        .rejects
        .toThrow('Failed to find escrow by secret hash');
    });

    it('should handle search with no results', async () => {
      const secretHash = '0x' + '1'.repeat(64);
      
      // Stub factory contract to provide EscrowCreated filter and no events
      const stubFactory = {
        address: factoryAddress,
        filters: { EscrowCreated: jest.fn((..._args: any[]) => ({})) },
        queryFilter: jest.fn(async () => [])
      } as any;
      (service as any).factoryContract = stubFactory;
      
      const result = await service.findEscrowBySecretHash(secretHash, 100);
      
      expect(result).toBeNull();
      expect(stubFactory.filters.EscrowCreated).toHaveBeenCalled();
    });
  });

  describe('executeWithdrawal', () => {
    it('should handle invalid secret', async () => {
      const escrowAddress = '0x1234567890123456789012345678901234567891';
      const invalidSecret = '';
      
      await expect(service.executeWithdrawal(escrowAddress, invalidSecret))
        .rejects
        .toThrow('Secret must be a non-empty string');
    });

    it('should handle withdrawal failure', async () => {
      const escrowAddress = '0x1234567890123456789012345678901234567891';
      const secret = 'valid-secret';
      const mockError = new Error('Withdrawal failed');
      
      // Ensure state allows withdrawal
      jest.spyOn(service as any, 'getEscrowDetails').mockResolvedValue({
        status: 1,
        token: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        timelock: 0,
        secretHash: '0x' + '1'.repeat(64),
        initiator: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        escrowAddress
      });
      
      // Mock contract.withdraw to fail
      const contractSpy = jest.spyOn(ethers as any, 'Contract').mockImplementation(() => ({
        estimateGas: { withdraw: jest.fn(async () => ethers.BigNumber.from('300000') as any) },
        withdraw: jest.fn(async () => { throw mockError; })
      }));
      
      await expect(service.executeWithdrawal(escrowAddress, secret))
        .rejects
        .toThrow('Failed to execute withdrawal');
      
      contractSpy.mockRestore();
    });
  });

  describe('executeRefund', () => {
    it('should handle refund failure', async () => {
      const escrowAddress = '0x1234567890123456789012345678901234567891';
      const mockError = new Error('Refund failed');
      
      // Ensure state allows refund
      jest.spyOn(service as any, 'getEscrowDetails').mockResolvedValue({
        status: 1,
        token: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        timelock: 0,
        secretHash: '0x' + '1'.repeat(64),
        initiator: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        escrowAddress
      });
      
      // Mock contract.refund to fail
      const contractSpy = jest.spyOn(ethers as any, 'Contract').mockImplementation(() => ({
        refund: jest.fn(async () => { throw mockError; })
      }));
      
      await expect(service.executeRefund(escrowAddress))
        .rejects
        .toThrow('Failed to execute refund');
      
      contractSpy.mockRestore();
    });
  });

  describe('findEscrowByParams', () => {
    it('should handle invalid search parameters', async () => {
      const invalidParams = {} as EscrowSearchParams;
      // Stub factory contract to avoid errors when creating filters
      const stubFactory = {
        address: factoryAddress,
        filters: { EscrowCreated: jest.fn((..._args: any[]) => ({})) },
        queryFilter: jest.fn(async () => [])
      } as any;
      (service as any).factoryContract = stubFactory;
      const result = await service.findEscrowByParams(invalidParams);
      expect(result).toBeNull();
      expect(stubFactory.filters.EscrowCreated).toHaveBeenCalled();
    });

    it('should handle search with invalid block range', async () => {
      const params: EscrowSearchParams = {
        initiator: '0x1234567890123456789012345678901234567890',
        maxBlocksToSearch: 0 // Will fallback to default; should not throw
      };
      
      // Stub factory with empty results to avoid ContractError due to missing filters
      const stubFactory = {
        address: factoryAddress,
        filters: { EscrowCreated: jest.fn((..._args: any[]) => ({})) },
        queryFilter: jest.fn(async () => [])
      } as any;
      (service as any).factoryContract = stubFactory;
      
      const querySpy = jest.spyOn(stubFactory, 'queryFilter').mockImplementation(async () => []);
      const result = await service.findEscrowByParams(params);
      expect(result).toBeNull();
      querySpy.mockRestore();
    });
  });
});
