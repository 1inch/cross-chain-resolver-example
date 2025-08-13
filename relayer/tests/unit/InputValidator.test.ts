/**
 * Comprehensive test suite for InputValidator
 */

import { InputValidator } from '../../src/utils/InputValidator';

describe('InputValidator', () => {
  describe('validateEthereumAddress', () => {
    it('should validate correct Ethereum addresses', () => {
      const validAddresses = [
        '0x742d35Cc6634C0532925a3b8D0Ac6bc4b2c0532e',
        '0x0000000000000000000000000000000000000000',
        '0xffffffffffffffffffffffffffffffffffffffff'
      ];

      validAddresses.forEach(address => {
        const result = InputValidator.validateEthereumAddress(address);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject invalid Ethereum addresses', () => {
      const invalidAddresses = [
        '',
        'not-an-address',
        '0x742d35Cc6634C0532925a3b8D0Ac6bc4b2c0532', // too short
        '0x742d35Cc6634C0532925a3b8D0Ac6bc4b2c0532ee', // too long
        '742d35Cc6634C0532925a3b8D0Ac6bc4b2c0532e', // missing 0x
        null,
        undefined
      ];

      invalidAddresses.forEach(address => {
        const result = InputValidator.validateEthereumAddress(address as any);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should warn about zero address', () => {
      const result = InputValidator.validateEthereumAddress('0x0000000000000000000000000000000000000000');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('address is the zero address');
    });
  });

  describe('validateNearAccountId', () => {
    it('should validate correct NEAR account IDs', () => {
      const validAccountIds = [
        'alice.near',
        'bob.testnet',
        'contract.factory.near',
        'user123',
        'a-b_c.d'
      ];

      validAccountIds.forEach(accountId => {
        const result = InputValidator.validateNearAccountId(accountId);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject invalid NEAR account IDs', () => {
      const invalidAccountIds = [
        '',
        'A', // too short
        'a'.repeat(65), // too long
        'Alice.near', // uppercase
        'alice@near', // invalid character
        '.alice', // starts with dot
        'alice.', // ends with dot
        'alice..near', // consecutive dots
        null,
        undefined
      ];

      invalidAccountIds.forEach(accountId => {
        const result = InputValidator.validateNearAccountId(accountId as any);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('validateAmount', () => {
    it('should validate correct amounts', () => {
      const validAmounts = [
        '1000000000000000000', // 1 ETH in wei
        '1',
        '999999999999999999999999'
      ];

      validAmounts.forEach(amount => {
        const result = InputValidator.validateAmount(amount);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject invalid amounts', () => {
      const invalidAmounts = [
        '',
        '0', // zero not allowed by default
        '-1', // negative
        'not-a-number',
        '1.5', // decimals not supported in BigNumber
        null,
        undefined
      ];

      invalidAmounts.forEach(amount => {
        const result = InputValidator.validateAmount(amount as any);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should allow zero when specified', () => {
      const result = InputValidator.validateAmount('0', 'amount', { allowZero: true });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate min/max constraints', () => {
      const result = InputValidator.validateAmount('500', 'amount', {
        minValue: '1000',
        maxValue: '100'
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('amount must be at least 1000');
      expect(result.errors).toContain('amount cannot exceed 100');
    });
  });

  describe('validateSecretHash', () => {
    it('should validate correct secret hashes', () => {
      const validHashes = [
        '0x' + 'a'.repeat(64),
        '0x' + '1234567890abcdef'.repeat(4),
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ];

      validHashes.forEach(hash => {
        const result = InputValidator.validateSecretHash(hash);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject invalid secret hashes', () => {
      const invalidHashes = [
        '',
        'a'.repeat(64), // missing 0x
        '0x' + 'a'.repeat(63), // too short
        '0x' + 'a'.repeat(65), // too long
        '0x' + 'g'.repeat(64), // invalid hex
        null,
        undefined
      ];

      invalidHashes.forEach(hash => {
        const result = InputValidator.validateSecretHash(hash as any);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('validateTimelock', () => {
    it('should validate future timelocks', () => {
      const futureTimelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const result = InputValidator.validateTimelock(futureTimelock);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject past timelocks', () => {
      const pastTimelock = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const result = InputValidator.validateTimelock(pastTimelock);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('timelock must be in the future');
    });

    it('should warn about very short/long durations', () => {
      const now = Math.floor(Date.now() / 1000);
      
      // Very short duration
      const shortResult = InputValidator.validateTimelock(now + 60); // 1 minute
      expect(shortResult.isValid).toBe(true);
      expect(shortResult.warnings.length).toBeGreaterThan(0);
      
      // Very long duration
      const longResult = InputValidator.validateTimelock(now + 86400 * 365); // 1 year
      expect(longResult.isValid).toBe(true);
      expect(longResult.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateCrossChainMessage', () => {
    const validMessage = {
      messageId: 'msg_123456',
      type: 'deposit',
      sourceChain: 'NEAR',
      destChain: 'ETH',
      timestamp: Date.now(),
      amount: '1000000000000000000',
      sender: 'alice.near',
      recipient: '0x742d35Cc6634C0532925a3b8D0Ac6bc4b2c0532e'
    };

    it('should validate correct cross-chain messages', () => {
      const result = InputValidator.validateCrossChainMessage(validMessage);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject messages with missing required fields', () => {
      const invalidMessage = { ...validMessage };
      delete (invalidMessage as any).messageId;
      
      const result = InputValidator.validateCrossChainMessage(invalidMessage);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('messageId is required');
    });

    it('should validate message type', () => {
      const invalidMessage = { ...validMessage, type: 'invalid_type' };
      const result = InputValidator.validateCrossChainMessage(invalidMessage);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid message type: invalid_type');
    });

    it('should validate addresses based on chain', () => {
      // Invalid Ethereum address for ETH destination
      const invalidEthMessage = {
        ...validMessage,
        destChain: 'ETH',
        recipient: 'invalid-address'
      };
      const ethResult = InputValidator.validateCrossChainMessage(invalidEthMessage);
      expect(ethResult.isValid).toBe(false);
      
      // Invalid NEAR account for NEAR destination
      const invalidNearMessage = {
        ...validMessage,
        destChain: 'NEAR',
        recipient: 'Invalid.Account'
      };
      const nearResult = InputValidator.validateCrossChainMessage(invalidNearMessage);
      expect(nearResult.isValid).toBe(false);
    });
  });

  describe('assertValid', () => {
    it('should not throw for valid results', () => {
      const validResult = { isValid: true, errors: [], warnings: [] };
      expect(() => {
        InputValidator.assertValid(validResult, 'test');
      }).not.toThrow();
    });

    it('should throw for invalid results', () => {
      const invalidResult = { 
        isValid: false, 
        errors: ['Test error'], 
        warnings: [] 
      };
      expect(() => {
        InputValidator.assertValid(invalidResult, 'test');
      }).toThrow('Validation failed for test: Test error');
    });
  });
});
