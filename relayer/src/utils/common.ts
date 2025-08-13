/**
 * Common utility functions
 */

/**
 * Sleep for a specified number of milliseconds
 * @param ms Number of milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Generate a random string of specified length
 * @param length Length of the random string to generate
 * @returns Random string
 */
export const generateRandomString = (length: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const crypto = require('crypto');
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  
  return result;
};

/**
 * Parse error message from unknown error type
 * @param error Unknown error type
 * @returns Error message string
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
};

/**
 * Check if a string is a valid Ethereum address
 * @param address Address to validate
 * @returns True if the address is valid
 */
export const isValidEthereumAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

/**
 * Check if a string is a valid NEAR account ID
 * @param accountId Account ID to validate
 * @returns True if the account ID is valid
 */
export const isValidNearAccountId = (accountId: string): boolean => {
  if (accountId.length < 2 || accountId.length > 64) {
    return false;
  }
  // NEAR account IDs can contain:
  // - Lowercase alphanumeric characters (a-z, 0-9)
  // - Underscores (_)
  // - Hyphens (-)
  // - Dots (.) but not at the end
  // - Must start with a letter or number
  return /^(([a-z\d]+[\w-]*(?<!\.))|([a-z\d]+[\w-]*\.[a-z\d][\w-]*(?<!\.)))$/.test(accountId);
};
