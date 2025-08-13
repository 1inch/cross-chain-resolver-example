/**
 * Comprehensive unit tests for ValidationService
 * Tests all validation methods with positive and negative cases
 */

import assert from 'node:assert';
import { ValidationService } from '../../src/services/ValidationService';
import { ValidationError } from '../../src/utils/errors';

describe('ValidationService', () => {
  let validationService: ValidationService;

  // Setup before each test
  test('should initialize ValidationService', () => {
    validationService = new ValidationService();
    assert(validationService instanceof ValidationService);
  });

  describe('validateEthereumAddress', () => {
    test('should validate correct Ethereum addresses', () => {
      const validAddresses = [
        '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
        '0x0000000000000000000000000000000000000000',
        '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF',
        '0x1234567890123456789012345678901234567890'
      ];

      validAddresses.forEach(address => {
        assert.strictEqual(
          validationService.validateEthereumAddress(address),
          true,
          `Should validate address: ${address}`
        );
      });
    });

    test('should reject invalid Ethereum addresses', () => {
      const invalidAddresses = [
        '',
        null,
        undefined,
        '0x123', // too short
        '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0C0', // too long
        '742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0', // missing 0x
        '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // invalid hex
        123,
        {},
        []
      ];

      invalidAddresses.forEach(address => {
        assert.throws(
          () => validationService.validateEthereumAddress(address as any),
          ValidationError,
          `Should reject invalid address: ${address}`
        );
      });
    });
  });

  describe('validateNearAccountId', () => {
    test('should validate correct NEAR account IDs', () => {
      const validAccountIds = [
        'alice.testnet',
        'bob.near',
        'contract.example.testnet',
        'a1',
        'test-account',
        'test_account',
        'account123',
        'sub.account.testnet'
      ];

      validAccountIds.forEach(accountId => {
        assert.strictEqual(
          validationService.validateNearAccountId(accountId),
          true,
          `Should validate account ID: ${accountId}`
        );
      });
    });

    test('should reject invalid NEAR account IDs', () => {
      const invalidAccountIds = [
        '',
        null,
        undefined,
        'a', // too short
        'a'.repeat(65), // too long
        '.invalid', // starts with dot
        'invalid.', // ends with dot
        'invalid..account', // consecutive dots
        'Invalid', // uppercase
        'account@invalid', // invalid character
        'account space', // space
        123,
        {},
        []
      ];

      invalidAccountIds.forEach(accountId => {
        assert.throws(
          () => validationService.validateNearAccountId(accountId as any),
          ValidationError,
          `Should reject invalid account ID: ${accountId}`
        );
      });
    });
  });

  describe('validateAmount', () => {
    test('should validate correct amounts', () => {
      const validAmounts = [
        '1',
        '1000000000000000000', // 1 ETH in wei
        '1.5', // decimal ETH
        '0.001', // small decimal
        BigInt('1000000000000000000'),
        BigInt('1'),
        '999999999' // large amount
      ];

      validAmounts.forEach(amount => {
        assert.strictEqual(
          validationService.validateAmount(amount),
          true,
          `Should validate amount: ${amount}`
        );
      });
    });

    test('should reject invalid amounts', () => {
      const invalidAmounts = [
        '',
        null,
        undefined,
        '0',
        '-1',
        '-0.5',
        BigInt('0'),
        BigInt('-1'),
        'abc',
        '1.5.5', // invalid decimal
        '10000000000', // exceeds max (1 billion ETH)
        {},
        [],
        NaN,
        Infinity
      ];

      invalidAmounts.forEach(amount => {
        assert.throws(
          () => validationService.validateAmount(amount as any),
          ValidationError,
          `Should reject invalid amount: ${amount}`
        );
      });
    });
  });

  describe('validateSecretHash', () => {
    test('should validate correct secret hashes', () => {
      const validHashes = [
        '0x' + '1'.repeat(64),
        '0x' + 'a'.repeat(64),
        '0x' + 'A'.repeat(64),
        '0x' + '0'.repeat(64),
        '1'.repeat(64), // without 0x prefix
        'abcdef1234567890'.repeat(4) // mixed hex
      ];

      validHashes.forEach(hash => {
        assert.strictEqual(
          validationService.validateSecretHash(hash),
          true,
          `Should validate hash: ${hash}`
        );
      });
    });

    test('should reject invalid secret hashes', () => {
      const invalidHashes = [
        '',
        null,
        undefined,
        '0x123', // too short
        '0x' + '1'.repeat(65), // too long
        '0x' + 'G'.repeat(64), // invalid hex
        '0x' + '1'.repeat(63), // one char short
        123,
        {},
        []
      ];

      invalidHashes.forEach(hash => {
        assert.throws(
          () => validationService.validateSecretHash(hash as any),
          ValidationError,
          `Should reject invalid hash: ${hash}`
        );
      });
    });
  });

  describe('validateTransactionHash', () => {
    test('should validate correct Ethereum transaction hashes', () => {
      const validEthHashes = [
        '0x' + '1'.repeat(64),
        '0x' + 'a'.repeat(64),
        '0x' + 'A'.repeat(64),
        '0x' + '0'.repeat(64)
      ];

      validEthHashes.forEach(hash => {
        assert.strictEqual(
          validationService.validateTransactionHash(hash, 'ETH'),
          true,
          `Should validate ETH hash: ${hash}`
        );
      });
    });

    test('should validate correct NEAR transaction hashes', () => {
      const validNearHashes = [
        'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2W3X4Y5Z6',
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
        '1234567890123456789012345678901234567890123456789012345678901234'
      ];

      validNearHashes.forEach(hash => {
        assert.strictEqual(
          validationService.validateTransactionHash(hash, 'NEAR'),
          true,
          `Should validate NEAR hash: ${hash}`
        );
      });
    });

    test('should reject invalid transaction hashes', () => {
      const invalidHashes = [
        '',
        null,
        undefined,
        '0x123', // too short for ETH
        '0x' + '1'.repeat(65), // too long for ETH
        'short', // too short for NEAR
        '1'.repeat(100), // too long for NEAR
        123,
        {},
        []
      ];

      invalidHashes.forEach(hash => {
        assert.throws(
          () => validationService.validateTransactionHash(hash as any, 'ETH'),
          ValidationError,
          `Should reject invalid ETH hash: ${hash}`
        );

        assert.throws(
          () => validationService.validateTransactionHash(hash as any, 'NEAR'),
          ValidationError,
          `Should reject invalid NEAR hash: ${hash}`
        );
      });
    });
  });

  describe('validateMessageId', () => {
    test('should validate correct message IDs', () => {
      const validMessageIds = [
        'message123',
        'msg-456',
        'test_message',
        'a1b2c3d4',
        'MESSAGE-ID-123',
        'msg_' + '1'.repeat(120) // max length
      ];

      validMessageIds.forEach(messageId => {
        assert.strictEqual(
          validationService.validateMessageId(messageId),
          true,
          `Should validate message ID: ${messageId}`
        );
      });
    });

    test('should reject invalid message IDs', () => {
      const invalidMessageIds = [
        '',
        null,
        undefined,
        'short', // too short
        'a'.repeat(129), // too long
        'msg@invalid', // invalid character
        'msg space', // space
        'msg.invalid', // dot
        123,
        {},
        []
      ];

      invalidMessageIds.forEach(messageId => {
        assert.throws(
          () => validationService.validateMessageId(messageId as any),
          ValidationError,
          `Should reject invalid message ID: ${messageId}`
        );
      });
    });
  });

  describe('validateTimelock', () => {
    test('should validate correct timelock values', () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const validTimelocks = [
        currentTime + 3600, // 1 hour from now
        currentTime + 86400, // 1 day from now
        currentTime + 604800, // 1 week from now
        0, // epoch time
        1234567890 // valid past time
      ];

      validTimelocks.forEach(timelock => {
        assert.strictEqual(
          validationService.validateTimelock(timelock),
          true,
          `Should validate timelock: ${timelock}`
        );
      });
    });

    test('should reject invalid timelock values', () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const invalidTimelocks = [
        -1, // negative
        currentTime + (366 * 24 * 60 * 60), // more than 1 year in future
        1.5, // not integer
        NaN,
        Infinity,
        null,
        undefined,
        'string',
        {},
        []
      ];

      invalidTimelocks.forEach(timelock => {
        assert.throws(
          () => validationService.validateTimelock(timelock as any),
          ValidationError,
          `Should reject invalid timelock: ${timelock}`
        );
      });
    });
  });

  describe('validateCrossChainMessage', () => {
    test('should validate correct cross-chain messages', () => {
      const validMessages = [
        {
          messageId: 'msg-123',
          type: 'DEPOSIT',
          sourceChain: 'ETH',
          destChain: 'NEAR',
          sender: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          recipient: 'alice.testnet',
          amount: '1000000000000000000',
          data: {
            txHash: '0x' + '1'.repeat(64),
            secretHash: '0x' + '3'.repeat(64),
            timelock: Math.floor(Date.now() / 1000) + 86400
          }
        },
        {
          messageId: 'msg-456',
          type: 'WITHDRAWAL',
          sourceChain: 'NEAR',
          destChain: 'ETH',
          sender: 'bob.testnet',
          recipient: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          amount: BigInt('2000000000000000000'),
          data: {
            txHash: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2W3X4Y5Z6'
          }
        },
        {
          messageId: 'msg-789',
          type: 'REFUND',
          sourceChain: 'ETH',
          destChain: 'NEAR',
          sender: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          recipient: 'charlie.testnet',
          amount: '500000000000000000',
          data: {
            txHash: '0x' + '2'.repeat(64)
          }
        }
      ];

      validMessages.forEach((message, index) => {
        assert.strictEqual(
          validationService.validateCrossChainMessage(message),
          true,
          `Should validate message ${index + 1}`
        );
      });
    });

    test('should reject invalid cross-chain messages', () => {
      const invalidMessages = [
        null,
        undefined,
        {},
        [],
        'string',
        123,
        // Missing required fields
        {
          type: 'DEPOSIT',
          sourceChain: 'ETH',
          destChain: 'NEAR'
        },
        // Invalid message type
        {
          messageId: 'msg-123',
          type: 'INVALID',
          sourceChain: 'ETH',
          destChain: 'NEAR',
          sender: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          recipient: 'alice.testnet',
          amount: '1000000000000000000',
          data: { txHash: '0x' + '1'.repeat(64) }
        },
        // Invalid source chain
        {
          messageId: 'msg-123',
          type: 'DEPOSIT',
          sourceChain: 'INVALID',
          destChain: 'NEAR',
          sender: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          recipient: 'alice.testnet',
          amount: '1000000000000000000',
          data: { txHash: '0x' + '1'.repeat(64) }
        },
        // Invalid sender address for ETH
        {
          messageId: 'msg-123',
          type: 'DEPOSIT',
          sourceChain: 'ETH',
          destChain: 'NEAR',
          sender: 'invalid-eth-address',
          recipient: 'alice.testnet',
          amount: '1000000000000000000',
          data: { txHash: '0x' + '1'.repeat(64) }
        },
        // Invalid recipient for NEAR
        {
          messageId: 'msg-123',
          type: 'DEPOSIT',
          sourceChain: 'ETH',
          destChain: 'NEAR',
          sender: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          recipient: 'Invalid.Account',
          amount: '1000000000000000000',
          data: { txHash: '0x' + '1'.repeat(64) }
        },
        // Invalid amount
        {
          messageId: 'msg-123',
          type: 'DEPOSIT',
          sourceChain: 'ETH',
          destChain: 'NEAR',
          sender: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          recipient: 'alice.testnet',
          amount: '0',
          data: { txHash: '0x' + '1'.repeat(64) }
        },
        // Missing data
        {
          messageId: 'msg-123',
          type: 'DEPOSIT',
          sourceChain: 'ETH',
          destChain: 'NEAR',
          sender: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          recipient: 'alice.testnet',
          amount: '1000000000000000000'
        },
        // Invalid txHash
        {
          messageId: 'msg-123',
          type: 'DEPOSIT',
          sourceChain: 'ETH',
          destChain: 'NEAR',
          sender: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
          recipient: 'alice.testnet',
          amount: '1000000000000000000',
          data: { txHash: 'invalid-hash' }
        }
      ];

      invalidMessages.forEach((message, index) => {
        assert.throws(
          () => validationService.validateCrossChainMessage(message as any),
          ValidationError,
          `Should reject invalid message ${index + 1}`
        );
      });
    });
  });

  describe('validateContractConfig', () => {
    test('should validate correct contract configurations', () => {
      const validConfigs = [
        {
          ethereum: {
            factoryAddress: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0',
            bridgeAddress: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C1'
          },
          near: {
            accountId: 'contract.testnet',
            escrowContractId: 'escrow.testnet'
          }
        },
        {
          ethereum: {
            factoryAddress: '0x742d35Cc6634C0532925a3b8D0C9C0C0C0C0C0C0'
          }
        },
        {
          near: {
            accountId: 'contract.testnet'
          }
        },
        {} // empty config should be valid
      ];

      validConfigs.forEach((config, index) => {
        assert.strictEqual(
          validationService.validateContractConfig(config),
          true,
          `Should validate config ${index + 1}`
        );
      });
    });

    test('should reject invalid contract configurations', () => {
      const invalidConfigs = [
        null,
        undefined,
        'string',
        123,
        [],
        {
          ethereum: {
            factoryAddress: 'invalid-address'
          }
        },
        {
          ethereum: {
            bridgeAddress: 'invalid-address'
          }
        },
        {
          near: {
            accountId: 'Invalid.Account'
          }
        },
        {
          near: {
            escrowContractId: '.invalid'
          }
        }
      ];

      invalidConfigs.forEach((config, index) => {
        assert.throws(
          () => validationService.validateContractConfig(config as any),
          ValidationError,
          `Should reject invalid config ${index + 1}`
        );
      });
    });
  });

  describe('Error handling', () => {
    test('should throw ValidationError with proper details', () => {
      try {
        validationService.validateEthereumAddress('invalid');
        assert.fail('Should have thrown ValidationError');
      } catch (error) {
        assert(error instanceof ValidationError);
        assert(error.message.includes('Invalid Ethereum address format'));
        assert.strictEqual(error.field, 'address');
        assert.strictEqual(error.value, 'invalid');
      }
    });

    test('should handle edge cases gracefully', () => {
      // Test with various falsy values
      const falsyValues = [null, undefined, '', 0, false, NaN];
      
      falsyValues.forEach(value => {
        assert.throws(
          () => validationService.validateEthereumAddress(value as any),
          ValidationError,
          `Should handle falsy value: ${value}`
        );
      });
    });
  });
  
  describe('validateAuctionConfig', () => {
    test('should accept a fully valid auction config', () => {
      const cfg = {
        duration: 300,
        initialRateBump: 50,
        points: [
          { delay: 0, coefficient: 0 },
          { delay: 60, coefficient: 10 },
          { delay: 120, coefficient: 25 }
        ],
        gasBumpEstimate: 21000,
        gasPriceEstimate: 20,
        minFillPercentage: 0.5,
        maxRateBump: 200
      };
      assert.strictEqual(validationService.validateAuctionConfig(cfg), true);
    });

    test('should allow partial config overrides', () => {
      const cfg = { duration: 180 };
      assert.strictEqual(validationService.validateAuctionConfig(cfg), true);
    });

    test('should reject invalid auction configs', () => {
      const invalids: Array<{ cfg: any; reason: string }> = [
        { cfg: null, reason: 'null config' },
        { cfg: [], reason: 'array config' },
        { cfg: { duration: 10 }, reason: 'duration too small' },
        { cfg: { initialRateBump: -1 }, reason: 'negative initialRateBump' },
        { cfg: { points: [] }, reason: 'empty points' },
        { cfg: { points: [{ delay: 10, coefficient: 1 }, { delay: 5, coefficient: 2 }] }, reason: 'unsorted points' },
        { cfg: { points: [{ delay: 0, coefficient: 1.2 }] }, reason: 'non-integer coefficient' },
        { cfg: { gasBumpEstimate: -5 }, reason: 'negative gasBumpEstimate' },
        { cfg: { gasPriceEstimate: -1 }, reason: 'negative gasPriceEstimate' },
        { cfg: { minFillPercentage: 1.5 }, reason: 'minFillPercentage > 1' },
        { cfg: { maxRateBump: -10 }, reason: 'negative maxRateBump' }
      ];

      invalids.forEach(({ cfg, reason }) => {
        assert.throws(() => validationService.validateAuctionConfig(cfg), ValidationError, `Should reject: ${reason}`);
      });
    });
  });

  describe('validateAuctionRuntimeParams', () => {
    test('should accept valid runtime params', () => {
      const now = Math.floor(Date.now() / 1000);
      const params = {
        fromChain: 'ETH',
        toChain: 'NEAR',
        fromAmount: '1000000000000000000',
        baseExchangeRate: 900,
        startTime: now,
        orderId: 'order_123456'
      };
      assert.strictEqual(validationService.validateAuctionRuntimeParams(params), true);
    });

    test('should reject invalid runtime params', () => {
      const cases: Array<{ params: any; reason: string }> = [
        { params: { fromChain: 'ETH', toChain: 'ETH', fromAmount: '1', baseExchangeRate: 1, startTime: 0, orderId: 'valid_id' }, reason: 'same chain' },
        { params: { fromChain: 'FOO', toChain: 'NEAR', fromAmount: '1', baseExchangeRate: 1, startTime: 0, orderId: 'valid_id' }, reason: 'invalid fromChain' },
        { params: { fromChain: 'ETH', toChain: 'NEAR', fromAmount: 'abc', baseExchangeRate: 1, startTime: 0, orderId: 'valid_id' }, reason: 'invalid amount' },
        { params: { fromChain: 'ETH', toChain: 'NEAR', fromAmount: '1', baseExchangeRate: 0, startTime: 0, orderId: 'valid_id' }, reason: 'non-positive baseExchangeRate' },
        { params: { fromChain: 'ETH', toChain: 'NEAR', fromAmount: '1', baseExchangeRate: 1, startTime: -1, orderId: 'valid_id' }, reason: 'negative startTime' },
        { params: { fromChain: 'ETH', toChain: 'NEAR', fromAmount: '1', baseExchangeRate: 1, startTime: 1.5, orderId: 'valid_id' }, reason: 'non-integer startTime' },
        { params: { fromChain: 'ETH', toChain: 'NEAR', fromAmount: '1', baseExchangeRate: 1, startTime: 0, orderId: 'x' }, reason: 'invalid orderId (too short)' }
      ];

      cases.forEach(({ params, reason }) => {
        assert.throws(() => validationService.validateAuctionRuntimeParams(params), ValidationError, `Should reject: ${reason}`);
      });
    });
  });
});
