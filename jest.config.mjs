/*
 * Root Jest config delegating to relayer/jest.config.cjs.
 * Keeps a single source of truth under CommonJS for relayer tests.
 */

export default {
  projects: ['<rootDir>/relayer/jest.config.cjs'],
};
