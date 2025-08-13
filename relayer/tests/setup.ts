/// <reference types="jest" />
// TypeScript test setup file for Jest

// Store original console methods
const originalConsole = { ...console };

// Create mock console methods
const consoleMocks = {
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Set up mocks before all tests
beforeAll(() => {
  // Apply mock console
  Object.assign(console, consoleMocks);
  
  // Set any global test configurations here
  
  // Add any global test setup here
});

// Clean up after all tests
afterAll(() => {
  // Restore original console methods
  Object.assign(console, originalConsole);
});

// Reset mocks between tests
afterEach(() => {
  jest.clearAllMocks();
});
