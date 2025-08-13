# Cross-Chain Relayer Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Components](#components)
4. [Services](#services)
5. [Configuration](#configuration)
6. [Deployment](#deployment)
7. [Testing](#testing)
8. [Monitoring](#monitoring)
9. [API Reference](#api-reference)
10. [Troubleshooting](#troubleshooting)

## Overview

The Cross-Chain Relayer is a sophisticated system that facilitates cross-chain transactions between NEAR Protocol and Ethereum networks. It supports partial order fills, dynamic auction pricing, and comprehensive event monitoring for secure and efficient cross-chain asset transfers.

### Key Features
- **Cross-Chain Coordination**: Seamless NEAR ↔ Ethereum transaction processing
- **Partial Fill Support**: Advanced order splitting and partial fulfillment capabilities
- **Dynamic Auction Pricing**: 1inch Fusion+ style auction system for optimal pricing
- **Event-Driven Architecture**: Real-time monitoring and processing of blockchain events
- **Production-Ready**: Comprehensive error handling, logging, and monitoring
- **Type-Safe**: Full TypeScript implementation with strict type checking

## Architecture

### High-Level Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   NEAR Chain    │    │     Relayer     │    │  Ethereum Chain │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │   Orders    │◄┼────┼►│ Near Relayer│ │    │ │   Escrows   │ │
│ │   Events    │ │    │ │             │ │    │ │   Events    │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│                 │    │ ┌─────────────┐ │    │                 │
│                 │    │ │ Eth Relayer │◄┼────┼►                │
│                 │    │ │             │ │    │                 │
│                 │    │ └─────────────┘ │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Core Components
- **NearRelayer**: Handles NEAR Protocol interactions and cross-chain coordination
- **EthereumRelayer**: Manages Ethereum contract interactions and event processing
- **Event Listeners**: Monitor blockchain events for order creation, fills, and refunds
- **Partial Fill Services**: Implement advanced order splitting and partial fulfillment logic
- **Dynamic Auction Service**: Provides 1inch Fusion+ style auction pricing
- **Storage Service**: Persistent storage for order states and transaction history

## Components

### 1. Relay Components (`src/relay/`)

#### NearRelayer (`src/relay/NearRelayer.ts`)
**Purpose**: Orchestrates NEAR Protocol interactions and cross-chain message processing.

**Key Responsibilities**:
- Monitor NEAR blockchain for order creation events
- Process cross-chain messages from Ethereum
- Coordinate partial fill operations
- Handle order refunds and cancellations
- Apply dynamic auction pricing

**Configuration**:
```typescript
interface NearRelayerConfig {
  nearAccount: NearAccount;
  ethereum: {
    rpcUrl: string;
    privateKey: string;
  };
  ethereumEscrowFactoryAddress: string;
  escrowContractId: string;
  pollIntervalMs?: number;
  storageDir?: string;
}
```

**Key Methods**:
- `start()`: Initializes relayer and begins event monitoring
- `stop()`: Gracefully shuts down relayer operations
- `processSwapOrderCreated()`: Handles new NEAR order events
- `createEthereumEscrowFromNearOrder()`: Creates corresponding Ethereum escrow

#### EthereumRelayer (`src/relay/EthereumRelayer.ts`)
**Purpose**: Manages Ethereum contract interactions and cross-chain coordination.

**Key Responsibilities**:
- Monitor Ethereum escrow events
- Process partial fills and refunds
- Coordinate with NEAR relayer
- Handle cross-chain message routing
- Manage Ethereum contract interactions

**Configuration**:
```typescript
interface EthereumRelayerConfig {
  provider: ethers.providers.Provider;
  signer: ethers.Signer;
  nearAccount: NearAccount;
  factoryAddress: string;
  bridgeAddress: string;
  resolverAddress: string;
  pollIntervalMs?: number;
  storageDir?: string;
}
```

### 2. Services (`src/services/`)

#### DynamicAuctionService (`src/services/DynamicAuctionService.ts`)
**Purpose**: Implements 1inch Fusion+ style auction pricing for optimal cross-chain rates.

**Features**:
- Time-based auction curves
- Market volatility configurations
- Cross-chain exchange rate calculations
- Dynamic fee structures
- Safety deposit calculations

**Usage**:
```typescript
const auctionService = new DynamicAuctionService();
const pricing = await auctionService.calculateAuctionPricing({
  sourceChain: 'near',
  destChain: 'ethereum',
  amount: '1000000000000000000000000', // 1 NEAR
  timeRemaining: 180 // seconds
});
```

#### NearPartialFillService (`src/services/NearPartialFillService.ts`)
**Purpose**: Handles partial order fills and order splitting logic for NEAR Protocol.

**Key Features**:
- Order splitting algorithms
- Partial fill tracking
- Fill history management
- Order state management
- Refund processing

**Methods**:
- `processPartialFill()`: Process a partial fill operation
- `splitOrder()`: Split an order into smaller parts
- `processRefund()`: Handle order refunds
- `getOrderState()`: Retrieve current order state
- `isEligibleForPartialFill()`: Check partial fill eligibility

#### EthereumPartialFillService (`src/services/EthereumPartialFillService.ts`)
**Purpose**: Manages partial fills and order operations for Ethereum contracts.

**Key Features**:
- Ethereum contract interactions
- Partial fill coordination
- Gas optimization
- Event processing
- State synchronization

#### Event Listeners

##### NearEventListener (`src/services/NearEventListener.ts`)
**Purpose**: Monitors NEAR blockchain for relevant events.

**Monitored Events**:
- `SwapOrderCreated`: New order creation
- `SwapOrderCompleted`: Order completion
- `SwapOrderPartiallyFilled`: Partial fill events
- `SwapOrderRefunded`: Order refunds
- `TransactionProcessed`: Transaction confirmations

##### EthereumEventListener (`src/services/EthereumEventListener.ts`)
**Purpose**: Monitors Ethereum contracts for escrow and bridge events.

**Monitored Events**:
- `EscrowCreated`: New escrow creation
- `EscrowCompleted`: Escrow completion
- `OrderPartiallyFilled`: Partial fill events
- `OrderRefunded`: Refund events
- `MessageSent`: Cross-chain messages

#### Contract Services

##### NearContractService (`src/services/NearContractService.ts`)
**Purpose**: Provides interface for NEAR smart contract interactions.

**Key Methods**:
- `createOrder()`: Create new orders
- `fillOrder()`: Fill existing orders
- `cancelOrder()`: Cancel orders
- `getOrderDetails()`: Retrieve order information
- `processRefund()`: Handle refunds

##### EthereumContractService (`src/services/EthereumContractService.ts`)
**Purpose**: Manages Ethereum smart contract interactions.

**Key Methods**:
- `createEscrow()`: Create new escrows
- `completeEscrow()`: Complete escrow operations
- `refundEscrow()`: Process refunds
- `getEscrowDetails()`: Retrieve escrow information

#### Utility Services

##### StorageService (`src/services/StorageService.ts`)
**Purpose**: Provides persistent storage for relayer state and transaction history.

**Features**:
- JSON-based storage
- Atomic operations
- Data integrity checks
- Backup and recovery
- Performance optimization

##### ValidationService (`src/services/ValidationService.ts`)
**Purpose**: Comprehensive validation for all relayer operations.

**Validation Types**:
- Order validation
- Account validation
- Amount validation
- Timelock validation
- Cross-chain consistency checks

### 3. Utilities (`src/utils/`)

#### Logger (`src/utils/logger.ts`)
**Purpose**: Structured logging with multiple output formats and levels.

**Features**:
- Multiple log levels (error, warn, info, debug)
- File rotation
- JSON and console output
- Performance metrics
- Error tracking

#### Error Handling (`src/utils/errors.ts`)
**Purpose**: Comprehensive error handling and classification.

**Error Types**:
- `RelayerError`: Base relayer error
- `ValidationError`: Input validation errors
- `NetworkError`: Blockchain network errors
- `ContractError`: Smart contract interaction errors
- `ConfigurationError`: Configuration-related errors

#### Configuration (`src/utils/configInit.ts`)
**Purpose**: Environment-based configuration management.

**Features**:
- Environment variable validation
- Type-safe configuration
- Default value handling
- Configuration validation
- Hot reloading support

### 4. Types (`src/types/`)

#### Interfaces (`src/types/interfaces.ts`)
**Purpose**: Comprehensive type definitions for all relayer components.

**Key Interfaces**:
- `NearAccount`: NEAR account representation
- `CrossChainMessage`: Cross-chain communication
- `PartialFillParams`: Partial fill parameters
- `OrderState`: Order state tracking
- `AuctionParams`: Auction pricing parameters

#### Global Types (`src/types/global.d.ts`)
**Purpose**: Global type declarations and module augmentations.

## Configuration

### Environment Variables
```bash
# NEAR Configuration
NEAR_NETWORK_ID=testnet
NEAR_NODE_URL=https://rpc.testnet.near.org
NEAR_RELAYER_ACCOUNT_ID=relayer.testnet
NEAR_RELAYER_PRIVATE_KEY=ed25519:...
# NEAR escrow contract handling swap orders
NEAR_ESCROW_CONTRACT_ID=escrow.yourproject.testnet

# (Legacy override support via ConfigurationService; prefer NEAR_RELAYER_* above)
# NEAR_ACCOUNT_ID=
# NEAR_PRIVATE_KEY=

# Ethereum Configuration
ETHEREUM_RPC_URL=https://sepolia.infura.io/v3/...
ETHEREUM_CHAIN_ID=11155111
ETHEREUM_PRIVATE_KEY=0x...
# Deprecated but temporarily supported. Prefer ETHEREUM_PRIVATE_KEY
# DEPLOYER_PRIVATE_KEY=

# Deployed contract addresses
ETHEREUM_ESCROW_FACTORY_ADDRESS=0x...
ETHEREUM_BRIDGE_ADDRESS=0x...
# Optional: defaults to ETHEREUM_ESCROW_FACTORY_ADDRESS if not set
RESOLVER_ADDRESS=0x...

# (Legacy keys still parsed by ConfigurationService; prefer the above)
# ETHEREUM_ESCROW_CONTRACT=
# ETHEREUM_BRIDGE_CONTRACT=

# Relayer Runtime
RELAYER_POLL_INTERVAL=5000
# Legacy name used in config loader (won't affect src/index.ts runtime polling)
# POLLING_INTERVAL=5000
# Storage directory for persistent data
STORAGE_DIR=./storage
# Logging
LOG_LEVEL=info
# Enable file logs (rotating files) unless set to 'false'
ENABLE_FILE_LOGS=true
# Process control
RELAYER_AUTO_START=true
NODE_ENV=development
PORT=3000

# Note on metrics exposure:
# - There is NO METRICS_PORT environment variable.
# - Metrics are controlled via config file (see `config/config.<env>.json`):
#     relayer.enableMetrics (boolean) and relayer.metricsPort (number).
# - Defaults when no config file is found: metrics are enabled and served on the
#   main PORT.
# - When a config file is present:
#     * If enableMetrics=true and metricsPort !== PORT, a dedicated metrics server
#       runs on metricsPort.
#     * If enableMetrics=true and metricsPort === PORT, /metrics is served on the
#       main PORT.
#     * If enableMetrics=false, metrics are disabled.
# See `relayer/src/server.ts` for the authoritative behavior.

# Price Oracle (optional overrides)
# Expressed as: 1 <FROM> = <rate> <TO>
EXCHANGE_RATE_NEAR_TO_ETH=0.001006
# EXCHANGE_RATE_ETH_TO_NEAR=1000

# Dynamic Auction (optional)
AUCTION_DURATION=180
AUCTION_INITIAL_RATE_BUMP=60000
AUCTION_POINTS=[{"delay":0,"coefficient":60000},{"delay":60,"coefficient":30000},{"delay":180,"coefficient":0}]
AUCTION_GAS_BUMP_ESTIMATE=100000
AUCTION_GAS_PRICE_ESTIMATE=15
AUCTION_MIN_FILL_PERCENTAGE=0.1
AUCTION_MAX_RATE_BUMP=80000
```

#### Legacy Environment Keys and Migration

- Use these new keys; legacy keys remain temporarily supported by `ConfigurationService`:
  - `DEPLOYER_PRIVATE_KEY` → `ETHEREUM_PRIVATE_KEY`
  - `ETHEREUM_ESCROW_CONTRACT` → `ETHEREUM_ESCROW_FACTORY_ADDRESS`
  - `ETHEREUM_BRIDGE_CONTRACT` → `ETHEREUM_BRIDGE_ADDRESS`
  - `POLLING_INTERVAL` → `RELAYER_POLL_INTERVAL`
  - `NEAR_ACCOUNT_ID` / `NEAR_PRIVATE_KEY` → `NEAR_RELAYER_ACCOUNT_ID` / `NEAR_RELAYER_PRIVATE_KEY`
- Notes:
  - `RESOLVER_ADDRESS` defaults to `ETHEREUM_ESCROW_FACTORY_ADDRESS` if unset.
  - `AUCTION_POINTS` must be valid JSON; if your env parser strips characters, wrap the JSON in single quotes.
  - Booleans are strings: set `ENABLE_FILE_LOGS` to `true` or `false`.

See [Monitoring](#monitoring) for `/health` and `/metrics` endpoints to verify configuration at runtime.

### Configuration Files
- `config/config.test.json`: Test environment configuration
- `.env`: Environment variables
- `tsconfig.json`: TypeScript configuration
- `package.json`: Dependencies and scripts

## Deployment

### Docker Deployment
```bash
# Build Docker image
docker build -t cross-chain-relayer .

# Run with Docker Compose
docker-compose up -d
```

### Manual Deployment
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start relayer
npm start
```

### Production Considerations
- Use environment-specific configuration
- Enable monitoring and alerting
- Configure log rotation
- Set up health checks
- Implement graceful shutdown

## Testing

### Test Structure
```
tests/
├── unit/                 # Unit tests for individual components
├── integration/          # Integration tests for component interactions
├── e2e/                 # End-to-end tests for full workflows
├── mocks/               # Mock implementations for testing
└── fixtures/            # Test data and fixtures
```

### Running Tests
```bash
# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e

# Run with coverage
npm run test:coverage
```

### Test Configuration
- Jest configuration in `jest.config.cjs`
- TypeScript support with `ts-jest`
- Mock implementations for external dependencies
- Comprehensive test utilities

## Monitoring

### Health Checks
The relayer exposes health check endpoints:
- `GET /health`: Overall system health
- `GET /metrics`: Prometheus metrics
- `GET /status`: Detailed status information

### Metrics
- Transaction processing rates
- Error rates and types
- Response times
- Resource utilization
- Cross-chain coordination metrics

### Logging
- Structured JSON logging
- Multiple log levels
- File rotation
- Error tracking
- Performance monitoring

## API Reference

### REST Endpoints
```
GET  /health              # Health check
GET  /metrics             # Prometheus metrics
GET  /status              # System status
POST /orders              # Create new order
GET  /orders/:id          # Get order details
POST /orders/:id/fill     # Fill order
POST /orders/:id/cancel   # Cancel order
```

### WebSocket Events
```
order.created             # New order created
order.filled              # Order filled
order.partially_filled    # Order partially filled
order.cancelled           # Order cancelled
order.refunded            # Order refunded
```

## Troubleshooting

### Common Issues

#### Connection Issues
**Problem**: Unable to connect to NEAR or Ethereum networks
**Solution**: 
- Verify RPC URLs are correct
- Check network connectivity
- Validate API keys and credentials

#### Transaction Failures
**Problem**: Transactions failing or reverting
**Solution**:
- Check gas settings
- Verify contract addresses
- Validate transaction parameters
- Review contract state

#### Partial Fill Issues
**Problem**: Partial fills not processing correctly
**Solution**:
- Verify order eligibility
- Check fill amounts and limits
- Review order state consistency
- Validate cross-chain coordination

#### Environment Misconfiguration
**Problem**: Relayer fails to start or behaves unexpectedly due to missing/invalid env vars
**Solution**:
- Ensure `.env` is present at `relayer/.env` and loaded (we use `dotenv`).
- Verify required keys: `ETHEREUM_RPC_URL`, `ETHEREUM_CHAIN_ID`, `ETHEREUM_PRIVATE_KEY`, `ETHEREUM_ESCROW_FACTORY_ADDRESS`, `NEAR_NODE_URL`, `NEAR_RELAYER_ACCOUNT_ID`, `NEAR_RELAYER_PRIVATE_KEY`, `NEAR_ESCROW_CONTRACT_ID`.
- Check types:
  - Numbers: `RELAYER_POLL_INTERVAL`, `ETHEREUM_CHAIN_ID`, `AUCTION_DURATION`, `AUCTION_INITIAL_RATE_BUMP`, `AUCTION_GAS_*`.
  - JSON: `AUCTION_POINTS` must be valid JSON array.
  - Booleans: `ENABLE_FILE_LOGS`, `RELAYER_AUTO_START` should be `true` or `false`.
- Legacy keys are parsed but prefer new keys (see Legacy section above).
- Run with `LOG_LEVEL=debug` and inspect startup logs for config validation errors from `ConfigurationService`.

### Debug Mode
Enable debug logging:
```bash
LOG_LEVEL=debug npm start
```

### Performance Optimization
- Adjust poll intervals based on network conditions
- Optimize database queries
- Configure appropriate batch sizes
- Monitor resource usage

## Development

### Getting Started
1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables
4. Run tests: `npm test`
5. Start development server: `npm run dev`

### Code Style
- TypeScript with strict mode
- ESLint configuration
- Prettier formatting
- Comprehensive type definitions

### Contributing
1. Follow existing code patterns
2. Add tests for new features
3. Update documentation
4. Ensure type safety
5. Run full test suite before submitting

## Security Considerations

### Private Key Management
- Use environment variables for sensitive data
- Implement key rotation
- Use hardware security modules in production
- Never commit private keys to version control

### Network Security
- Use HTTPS for all external communications
- Implement rate limiting
- Validate all inputs
- Use secure random number generation

### Smart Contract Security
- Validate all contract interactions
- Implement proper error handling
- Use safe math operations
- Monitor for unusual activity

## Performance

### Optimization Strategies
- Connection pooling for blockchain RPC calls
- Efficient event filtering and processing
- Batch operations where possible
- Caching for frequently accessed data

### Monitoring
- Track transaction processing times
- Monitor memory and CPU usage
- Alert on error rate thresholds
- Performance regression testing

## Maintenance

### Regular Tasks
- Update dependencies
- Review and rotate logs
- Monitor system health
- Update documentation
- Security audits

### Backup and Recovery
- Regular database backups
- Configuration backups
- Disaster recovery procedures
- Testing recovery processes

---

For additional support or questions, please refer to the project repository or contact the development team.
