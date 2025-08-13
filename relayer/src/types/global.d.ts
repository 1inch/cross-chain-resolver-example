// Global type declarations for the project
declare module 'near-api-js' {
  export interface Account {
    // Add the minimum required Account interface
    accountId: string;
    // Add other methods and properties as needed
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
    RESOLVER_ADDRESS: string;
    ESCROW_FACTORY_ADDRESS: string;
    ETHEREUM_ESCROW_FACTORY_ADDRESS?: string;
    RELAYER_POLL_INTERVAL?: string;
  }
}

// Extend the Window interface for browser environments
declare interface Window {
  ethereum?: any;
}

// Add missing types for Node.js
declare namespace NodeJS {
  interface Timeout {}
  interface Process {}
}
