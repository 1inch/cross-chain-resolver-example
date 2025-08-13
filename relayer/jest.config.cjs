// CommonJS module exports for better compatibility
module.exports = {
  // Use ts-jest in CommonJS mode to avoid ESM parse issues in tests
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts',
    '**/src/**/*.test.ts',
    '**/src/**/*.spec.ts',
  ],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Test setup - use CJS to avoid ESM parsing issues in setup phase
  setupFilesAfterEnv: ['<rootDir>/tests/setup.cjs'],
  testTimeout: 30000,
  verbose: true,
  
  // Module handling
  moduleFileExtensions: ['js', 'ts', 'json', 'node'],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    // Ignore legacy duplicate test using old constructor shape
    '/tests/unit/EthereumContractService.new.test.ts',
  ],
  
  // Module name mapper
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Map near-api-js to our test mock to avoid real dependency and ESM issues
    '^near-api-js$': '<rootDir>/tests/mocks/near-api-mock.ts',
  },
  
  // Transform configuration for CJS
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: '<rootDir>/tsconfig.test.json',
        diagnostics: {
          ignoreCodes: [1343],
        },
      },
    ],
  },
  
  // Transform ignore patterns (leave default; we don't need ESM exceptions)
  transformIgnorePatterns: [
    '/node_modules/',
  ],
  
  // Test environment options
  testEnvironmentOptions: {
    url: 'http://localhost/',
  },
  
  // Worker options
  workerIdleMemoryLimit: '512MB',
};
