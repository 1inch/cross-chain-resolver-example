import { jest } from '@jest/globals';

export const ValidationService = {
  validateDepositMessage: jest.fn(),
  validateWithdrawalMessage: jest.fn(),
  validateRefundMessage: jest.fn(),
  validateCrossChainMessage: jest.fn(),
};

export default ValidationService;
