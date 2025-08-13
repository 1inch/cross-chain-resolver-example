// Test file for EthereumContractService

// Mock ethers module
const mockContract = {
  on: jest.fn(),
  off: jest.fn(),
  deposit: jest.fn(),
  withdraw: jest.fn(),
  refund: jest.fn(),
  getEscrow: jest.fn(),
  filters: {
    DepositInitiated: jest.fn(),
    WithdrawalCompleted: jest.fn(),
    RefundInitiated: jest.fn(),
    EscrowCreated: jest.fn(),
  },
  interface: {
    getEvent: jest.fn()
  },
  provider: {
    getBlockNumber: jest.fn()
  }
};

const mockContractFactory = {
  deploy: jest.fn(),
  attach: jest.fn()
};

const mockWallet = {
  connect: jest.fn(),
  getAddress: jest.fn(),
  signMessage: jest.fn()
};

const mockProvider = {
  getSigner: jest.fn(),
  getNetwork: jest.fn()
};

const mockEthers = {
  Contract: jest.fn().mockImplementation(() => mockContract),
  ContractFactory: jest.fn().mockImplementation(() => mockContractFactory),
  Wallet: jest.fn().mockImplementation(() => mockWallet),
  providers: {
    JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider)
  },
  utils: {
    Interface: jest.fn(),
    getAddress: jest.fn(),
    hexlify: jest.fn(),
    hexZeroPad: jest.fn(),
    parseEther: jest.fn(),
    formatEther: jest.fn()
  }
};

// Mock the entire ethers module
jest.mock('ethers', () => mockEthers);

// Import the service to test
const { EthereumContractService } = require('../../src/services/ethereumContractService');

describe('EthereumContractService', () => {
  let service;
  const config = {
    ethereum: {
      rpcUrl: 'http://localhost:8545',
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      contractAddress: '0x1234567890123456789012345678901234567890',
      chainId: 1,
      gasLimit: '1000000',
      gasPrice: '1000000000'
    }
  };

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Set up default mock implementations
    mockWallet.getAddress.mockResolvedValue('0x1234567890123456789012345678901234567890');
    mockProvider.getSigner.mockReturnValue(mockWallet);
    mockProvider.getNetwork.mockResolvedValue({ chainId: 1 });
    mockContractFactory.attach.mockReturnValue(mockContract);
    
    // Create a new instance of the service for each test
    service = new EthereumContractService(config);
  });

  describe('constructor', () => {
    it('should initialize with the provided configuration', () => {
      expect(service.config).toEqual(config.ethereum);
      expect(mockEthers.providers.JsonRpcProvider).toHaveBeenCalledWith(config.ethereum.rpcUrl);
      expect(mockEthers.Wallet).toHaveBeenCalledWith(config.ethereum.privateKey, mockProvider);
      expect(mockEthers.ContractFactory).toHaveBeenCalled();
      expect(mockContractFactory.attach).toHaveBeenCalledWith(config.ethereum.contractAddress);
    });
  });

  describe('deposit', () => {
    it('should call the deposit function on the contract with correct parameters', async () => {
      const amount = '1.0';
      const recipient = '0x9876543210987654321098765432109876543210';
      const secretHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      
      // Mock the transaction response
      const mockTx = {
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
        })
      };
      
      mockContract.deposit.mockResolvedValue(mockTx);
      
      const result = await service.deposit(amount, recipient, secretHash, timelock);
      
      expect(mockContract.deposit).toHaveBeenCalledWith(
        mockEthers.utils.parseEther(amount),
        recipient,
        secretHash,
        timelock,
        {
          gasLimit: config.ethereum.gasLimit,
          gasPrice: mockEthers.utils.parseUnits(config.ethereum.gasPrice, 'wei')
        }
      );
      expect(result).toEqual({
        status: 'success',
        transactionHash: mockTx.wait().transactionHash
      });
    });
  });

  describe('withdraw', () => {
    it('should call the withdraw function on the contract with correct parameters', async () => {
      const secret = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const secretHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      // Mock the transaction response
      const mockTx = {
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
        })
      };
      
      mockContract.withdraw.mockResolvedValue(mockTx);
      
      const result = await service.withdraw(secret, secretHash);
      
      expect(mockContract.withdraw).toHaveBeenCalledWith(
        secret,
        secretHash,
        {
          gasLimit: config.ethereum.gasLimit,
          gasPrice: mockEthers.utils.parseUnits(config.ethereum.gasPrice, 'wei')
        }
      );
      expect(result).toEqual({
        status: 'success',
        transactionHash: mockTx.wait().transactionHash
      });
    });
  });

  describe('refund', () => {
    it('should call the refund function on the contract with correct parameters', async () => {
      const secretHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      // Mock the transaction response
      const mockTx = {
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
        })
      };
      
      mockContract.refund.mockResolvedValue(mockTx);
      
      const result = await service.refund(secretHash);
      
      expect(mockContract.refund).toHaveBeenCalledWith(
        secretHash,
        {
          gasLimit: config.ethereum.gasLimit,
          gasPrice: mockEthers.utils.parseUnits(config.ethereum.gasPrice, 'wei')
        }
      );
      expect(result).toEqual({
        status: 'success',
        transactionHash: mockTx.wait().transactionHash
      });
    });
  });

  describe('getEscrow', () => {
    it('should return the escrow details for the given secret hash', async () => {
      const secretHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const mockEscrow = {
        amount: '1000000000000000000', // 1.0 ETH in wei
        recipient: '0x9876543210987654321098765432109876543210',
        refundAddress: '0x1234567890123456789012345678901234567890',
        timelock: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        withdrawn: false,
        refunded: false
      };
      
      mockContract.getEscrow.mockResolvedValue([
        mockEscrow.amount,
        mockEscrow.recipient,
        mockEscrow.refundAddress,
        mockEscrow.timelock,
        mockEscrow.withdrawn,
        mockEscrow.refunded
      ]);
      
      const result = await service.getEscrow(secretHash);
      
      expect(mockContract.getEscrow).toHaveBeenCalledWith(secretHash);
      expect(result).toEqual({
        amount: mockEscrow.amount,
        recipient: mockEscrow.recipient,
        refundAddress: mockEscrow.refundAddress,
        timelock: mockEscrow.timelock,
        withdrawn: mockEscrow.withdrawn,
        refunded: mockEscrow.refunded
      });
    });
  });

  describe('event listeners', () => {
    it('should set up event listeners', () => {
      const callback = jest.fn();
      
      // Test DepositInitiated event
      service.onDepositInitiated(callback);
      expect(mockContract.on).toHaveBeenCalledWith('DepositInitiated', expect.any(Function));
      
      // Test WithdrawalCompleted event
      service.onWithdrawalCompleted(callback);
      expect(mockContract.on).toHaveBeenCalledWith('WithdrawalCompleted', expect.any(Function));
      
      // Test RefundInitiated event
      service.onRefundInitiated(callback);
      expect(mockContract.on).toHaveBeenCalledWith('RefundInitiated', expect.any(Function));
      
      // Test EscrowCreated event
      service.onEscrowCreated(callback);
      expect(mockContract.on).toHaveBeenCalledWith('EscrowCreated', expect.any(Function));
    });
  });

  describe('cleanup', () => {
    it('should remove all event listeners', () => {
      service.cleanup();
      expect(mockContract.off).toHaveBeenCalledWith('DepositInitiated');
      expect(mockContract.off).toHaveBeenCalledWith('WithdrawalCompleted');
      expect(mockContract.off).toHaveBeenCalledWith('RefundInitiated');
      expect(mockContract.off).toHaveBeenCalledWith('EscrowCreated');
    });
  });
});
