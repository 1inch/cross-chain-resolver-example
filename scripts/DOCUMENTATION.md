# Cross-Chain Scripts Documentation

## Table of Contents
1. [Overview](#overview)
2. [Script Categories](#script-categories)
3. [Deployment Scripts](#deployment-scripts)
4. [Testing Scripts](#testing-scripts)
5. [Enhanced Scripts](#enhanced-scripts)
6. [Debugging Scripts](#debugging-scripts)
7. [Configuration](#configuration)
8. [Usage Examples](#usage-examples)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

## Overview

The scripts directory contains a comprehensive collection of deployment, testing, and operational scripts for the cross-chain resolver system. These scripts facilitate end-to-end testing, deployment automation, monitoring, and debugging of cross-chain transactions between NEAR Protocol and Ethereum.

### Key Features
- **Automated Deployment**: Complete deployment automation for both NEAR and Ethereum contracts
- **End-to-End Testing**: Comprehensive testing scripts for cross-chain workflows
- **Enhanced Monitoring**: Production-ready monitoring and relayer management
- **Debug Utilities**: Advanced debugging tools for transaction analysis
- **Configuration Management**: Centralized configuration for all environments

## Script Categories

### 1. Deployment Scripts
- Contract deployment automation
- Network configuration
- Environment setup
- Infrastructure provisioning

### 2. Testing Scripts
- Cross-chain transfer testing
- Partial fill testing
- Integration testing
- Performance testing

### 3. Enhanced Scripts
- Production-ready implementations
- Advanced error handling
- Comprehensive monitoring
- Graceful shutdown mechanisms

### 4. Debugging Scripts
- Transaction analysis
- Order state debugging
- Event monitoring
- Performance profiling

## Deployment Scripts

### deploy-near-testnet.ts
**Purpose**: Comprehensive NEAR Protocol contract deployment and configuration.

**Features**:
- Automated contract compilation and deployment
- Account creation and funding
- Contract initialization
- Configuration validation
- Post-deployment testing

**Usage**:
```bash
npx ts-node src/deploy-near-testnet.ts
```

**Configuration**:
```typescript
interface DeploymentConfig {
  networkId: string;
  masterAccount: string;
  contractAccount: string;
  initialBalance: string;
  contractPath: string;
}
```

**Key Operations**:
1. **Account Setup**: Creates and funds deployment accounts
2. **Contract Compilation**: Builds WASM contracts with optimization
3. **Deployment**: Deploys contracts to NEAR testnet
4. **Initialization**: Sets up initial contract state
5. **Validation**: Verifies deployment success

### deploy-escrow.ts
**Purpose**: Ethereum escrow contract deployment and configuration.

**Features**:
- Foundry-based contract deployment
- Gas optimization
- Contract verification
- Factory pattern setup
- Access control configuration

**Usage**:
```bash
npx ts-node src/deploy-escrow.ts
```

**Deployment Process**:
1. **Environment Validation**: Checks RPC connectivity and account balance
2. **Contract Compilation**: Compiles Solidity contracts with Foundry
3. **Deployment**: Deploys factory and implementation contracts
4. **Configuration**: Sets up contract parameters and permissions
5. **Verification**: Validates contract deployment and functionality

### deploy-near-bridge.ts
**Purpose**: NEAR bridge contract deployment for cross-chain communication.

**Features**:
- Bridge contract deployment
- Cross-chain message routing setup
- Validator configuration
- Security parameter initialization

**Key Components**:
- Message relay infrastructure
- Validator set management
- Cross-chain proof verification
- Emergency pause mechanisms

### register-relayer.ts
**Purpose**: Relayer registration and authorization setup.

**Features**:
- Relayer account registration
- Permission configuration
- Stake management
- Monitoring setup

**Registration Process**:
1. **Account Verification**: Validates relayer account credentials
2. **Stake Deposit**: Handles required stake deposits
3. **Permission Setup**: Configures relayer permissions
4. **Monitoring**: Enables relayer monitoring and alerts

## Testing Scripts

### modern-near-to-eth-transfer.ts
**Purpose**: Comprehensive NEAR to Ethereum cross-chain transfer testing.

**Features**:
- Complete workflow simulation
- Dynamic auction pricing integration
- Partial fill support
- Error handling and recovery
- Performance monitoring

**Test Workflow**:
```typescript
class NearToEthTransfer {
  async executeTransfer(): Promise<void> {
    // 1. Initialize connections
    await this.initializeConnections();
    
    // 2. Create NEAR order
    const orderId = await this.createNearOrder();
    
    // 3. Apply dynamic pricing
    const pricing = await this.calculateAuctionPricing();
    
    // 4. Create Ethereum escrow
    const escrowAddress = await this.createEthereumEscrow();
    
    // 5. Monitor completion
    await this.monitorTransferCompletion();
  }
}
```

**Configuration Options**:
- Transfer amounts and tokens
- Auction parameters
- Timeout settings
- Monitoring intervals
- Error recovery strategies

### enhanced-eth-to-near-transfer.ts
**Purpose**: Production-ready Ethereum to NEAR transfer testing.

**Features**:
- Robust error handling
- Comprehensive logging
- Health checks
- Graceful shutdown
- Performance metrics

**Key Capabilities**:
- Multi-token support
- Partial fill testing
- Cross-chain coordination
- Event monitoring
- State validation

### test-partial-fills.ts
**Purpose**: Specialized testing for partial fill functionality.

**Features**:
- Order splitting scenarios
- Partial fulfillment testing
- Refund processing
- Cross-chain coordination
- Edge case handling

**Test Scenarios**:
1. **Single Partial Fill**: Test basic partial fill functionality
2. **Multiple Partial Fills**: Test order splitting across multiple fills
3. **Partial Fill with Refund**: Test refund processing for unfilled portions
4. **Cross-Chain Coordination**: Test partial fill coordination between chains
5. **Edge Cases**: Test boundary conditions and error scenarios

### run-partial-fill-tests.ts
**Purpose**: Automated test runner for partial fill scenarios.

**Features**:
- Automated test execution
- Result aggregation
- Performance benchmarking
- Error reporting
- Test isolation

**Test Execution**:
```bash
npx ts-node run-partial-fill-tests.ts
```

**Test Categories**:
- Unit tests for partial fill logic
- Integration tests for cross-chain coordination
- End-to-end tests for complete workflows
- Performance tests for optimization
- Stress tests for reliability

## Enhanced Scripts

### enhanced-monitor-relayer.ts
**Purpose**: Production-ready relayer monitoring and management.

**Features**:
- Real-time health monitoring
- Event processing
- Error recovery
- Performance metrics
- Graceful shutdown

**Architecture**:
```typescript
class RelayerMonitor {
  private healthChecker: HealthChecker;
  private eventProcessor: EventProcessor;
  private errorHandler: ErrorHandler;
  private metricsCollector: MetricsCollector;
  
  async start(): Promise<void> {
    await this.initializeComponents();
    await this.startMonitoring();
    this.setupGracefulShutdown();
  }
}
```

**Monitoring Capabilities**:
- **Health Checks**: Continuous system health monitoring
- **Event Processing**: Real-time blockchain event processing
- **Error Recovery**: Automatic error detection and recovery
- **Performance Metrics**: Comprehensive performance tracking
- **Alerting**: Configurable alert system for critical events

**Configuration**:
```typescript
interface MonitorConfig {
  healthCheck: {
    interval: number;
    timeout: number;
    retries: number;
  };
  eventProcessing: {
    batchSize: number;
    pollInterval: number;
    maxRetries: number;
  };
  metrics: {
    collection: boolean;
    exportInterval: number;
    endpoint: string;
  };
}
```

### Enhanced Script Features

#### Error Handling
```typescript
class EnhancedErrorHandler {
  async handleError(error: Error, context: ErrorContext): Promise<void> {
    // Log error with context
    this.logger.error('Operation failed', { error, context });
    
    // Attempt recovery
    if (this.isRecoverable(error)) {
      await this.attemptRecovery(error, context);
    }
    
    // Send alerts if critical
    if (this.isCritical(error)) {
      await this.sendAlert(error, context);
    }
  }
}
```

#### Health Monitoring
```typescript
class HealthChecker {
  async checkHealth(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkNearConnection(),
      this.checkEthereumConnection(),
      this.checkDatabaseConnection(),
      this.checkMemoryUsage(),
      this.checkDiskSpace()
    ]);
    
    return this.aggregateHealthStatus(checks);
  }
}
```

#### Performance Metrics
```typescript
class MetricsCollector {
  collectMetrics(): SystemMetrics {
    return {
      transactionThroughput: this.getTransactionThroughput(),
      errorRate: this.getErrorRate(),
      responseTime: this.getAverageResponseTime(),
      resourceUsage: this.getResourceUsage(),
      crossChainLatency: this.getCrossChainLatency()
    };
  }
}
```

## Debugging Scripts

### debug-order-137-transaction.ts
**Purpose**: Advanced transaction debugging and analysis.

**Features**:
- Transaction trace analysis
- Event log parsing
- State reconstruction
- Error diagnosis
- Performance profiling

**Debugging Capabilities**:
1. **Transaction Analysis**: Deep dive into transaction execution
2. **Event Parsing**: Comprehensive event log analysis
3. **State Tracking**: Order state reconstruction
4. **Error Diagnosis**: Root cause analysis for failures
5. **Performance Profiling**: Execution time and gas analysis

**Usage**:
```bash
npx ts-node src/debug-order-137-transaction.ts --order-id=137
```

**Debug Output**:
```typescript
interface DebugReport {
  orderId: string;
  transactionHash: string;
  blockNumber: number;
  gasUsed: number;
  events: EventLog[];
  stateChanges: StateChange[];
  errors: ErrorAnalysis[];
  performance: PerformanceMetrics;
}
```

## Configuration

### config.ts
**Purpose**: Centralized configuration management for all scripts.

**Configuration Structure**:
```typescript
interface ScriptConfig {
  networks: {
    near: NearNetworkConfig;
    ethereum: EthereumNetworkConfig;
  };
  contracts: {
    nearEscrow: string;
    ethereumFactory: string;
    bridge: string;
  };
  relayer: RelayerConfig;
  testing: TestConfig;
  monitoring: MonitoringConfig;
}
```

**Environment-Specific Configs**:
- **Development**: Local testing configuration
- **Testnet**: Public testnet configuration
- **Mainnet**: Production configuration
- **CI/CD**: Continuous integration configuration

### Environment Variables
```bash
# --- Ethereum (global for scripts) ---
PRIVATE_KEY=                         # required by most scripts
RPC_URL=https://sepolia.infura.io/v3/<KEY>
CHAIN_ID=11155111                    # default: 11155111 (Sepolia)
VERIFY_CONTRACT=false
EXPLORER_URL=https://sepolia.etherscan.io
API_KEY=                             # explorer API key (for verification)

# Optional deployment params
INITIAL_OWNER=                       # owner for escrow factory (defaults to deployer)
CREATE_SAMPLE_ESCROW=false           # set 'true' to create a sample escrow after deploy

# Aliases used by some test scripts (optional)
ETHEREUM_RPC_URL=                    # treated as RPC_URL if provided
SEPOLIA_RPC_URL=                     # treated as RPC_URL if provided
# Precedence note: If RPC_URL is unset, some scripts may fall back to
# ETHEREUM_RPC_URL or SEPOLIA_RPC_URL where applicable. Prefer setting RPC_URL
# for consistency unless a script explicitly documents otherwise.

# --- NEAR ---
NEAR_NETWORK_ID=testnet
NEAR_NODE_URL=https://rpc.testnet.near.org
NEAR_RPC_URL=https://rpc.testnet.near.org   # alias used by monitor script
NEAR_ACCOUNT_ID=your-account.testnet
NEAR_PRIVATE_KEY=ed25519:...

# --- Contracts ---
NEAR_ESCROW_CONTRACT=escrow-v2.fusionswap.testnet
NEAR_ESCROW_CONTRACT_ID=escrow-v2.fusionswap.testnet   # alias used by some tests
NEAR_BRIDGE=0x0000000000000000000000000000000000000000 # Ethereum bridge contract address

# --- Test Parameters ---
# NEAR → ETH
ETH_RECIPIENT=0x0000000000000000000000000000000000000000
NEAR_TRANSFER_AMOUNT=1

# ETH → NEAR
RECIPIENT=fusionswap.testnet
ETH_TRANSFER_AMOUNT=0.001

# Shared
TIMELOCK_DURATION=3600
LOG_LEVEL=info

# --- Monitoring (enhanced-monitor-relayer.ts) ---
POLL_INTERVAL=5000
MAX_RECONNECT_ATTEMPTS=5
HEALTH_CHECK_INTERVAL=30000
```

## Usage Examples

### Basic Cross-Chain Transfer
```bash
# Deploy contracts
npx ts-node src/deploy-near-testnet.ts
npx ts-node src/deploy-escrow.ts

# Register relayer
npx ts-node src/register-relayer.ts

# Test transfer
npx ts-node src/modern-near-to-eth-transfer.ts
```

### Partial Fill Testing
```bash
# Run comprehensive partial fill tests
npx ts-node run-partial-fill-tests.ts

# Test specific partial fill scenario
npx ts-node src/test-partial-fills.ts --scenario=multiple-fills
```

### Production Monitoring
```bash
# Start enhanced monitoring
npx ts-node src/enhanced-monitor-relayer.ts

# Monitor specific order
npx ts-node src/debug-order-137-transaction.ts --order-id=137
```

### Deployment Automation
```bash
# Full deployment pipeline
./deploy-bridge.sh

# Testnet demo
./run-testnet-demo.sh
```

## Best Practices

### Script Development
1. **Error Handling**: Implement comprehensive error handling
2. **Logging**: Use structured logging with appropriate levels
3. **Configuration**: Use environment-based configuration
4. **Testing**: Include unit and integration tests
5. **Documentation**: Maintain clear documentation

### Security
1. **Private Keys**: Never hardcode private keys
2. **Environment Variables**: Use secure environment variable management
3. **Input Validation**: Validate all inputs and parameters
4. **Access Control**: Implement proper access controls
5. **Audit Trails**: Maintain comprehensive audit trails

### Performance
1. **Async Operations**: Use async/await for I/O operations
2. **Connection Pooling**: Implement connection pooling for blockchain RPCs
3. **Batch Operations**: Use batch operations where possible
4. **Caching**: Implement appropriate caching strategies
5. **Monitoring**: Monitor performance metrics

### Maintenance
1. **Regular Updates**: Keep dependencies updated
2. **Health Checks**: Implement comprehensive health checks
3. **Backup Procedures**: Maintain backup and recovery procedures
4. **Documentation**: Keep documentation current
5. **Testing**: Regular testing of all scripts

## Troubleshooting

### Common Issues

#### Connection Problems
**Symptoms**: RPC connection failures, timeout errors
**Solutions**:
- Verify RPC URLs and API keys
- Check network connectivity
- Implement retry mechanisms
- Use connection pooling

#### Transaction Failures
**Symptoms**: Transaction reverts, gas estimation failures
**Solutions**:
- Verify contract addresses
- Check account balances
- Validate transaction parameters
- Review gas settings

#### Configuration Issues
**Symptoms**: Invalid configuration errors, missing environment variables
**Solutions**:
- Validate environment variables
- Check configuration file syntax
- Verify network-specific settings
- Use configuration validation

#### Performance Issues
**Symptoms**: Slow execution, timeout errors
**Solutions**:
- Optimize RPC calls
- Implement caching
- Use batch operations
- Monitor resource usage

### Debug Mode
Enable debug logging for detailed troubleshooting:
```bash
LOG_LEVEL=debug npx ts-node src/script-name.ts
```

### Error Analysis
Use the debug script for detailed error analysis:
```bash
npx ts-node src/debug-order-137-transaction.ts --order-id=<order-id>
```

## Development Workflow

### Script Development Process
1. **Planning**: Define script requirements and scope
2. **Implementation**: Develop script with proper error handling
3. **Testing**: Create comprehensive tests
4. **Documentation**: Document usage and configuration
5. **Integration**: Integrate with existing infrastructure

### Testing Strategy
1. **Unit Tests**: Test individual functions and components
2. **Integration Tests**: Test script interactions
3. **End-to-End Tests**: Test complete workflows
4. **Performance Tests**: Test under load conditions
5. **Security Tests**: Test security measures

### Deployment Process
1. **Development**: Develop and test locally
2. **Staging**: Test in staging environment
3. **Review**: Code review and approval
4. **Production**: Deploy to production
5. **Monitoring**: Monitor performance and health

## Security Considerations

### Private Key Management
- Use environment variables for private keys
- Implement key rotation procedures
- Use hardware security modules in production
- Never commit keys to version control

### Network Security
- Use HTTPS for all external communications
- Implement proper authentication
- Validate all inputs
- Use secure random number generation

### Access Control
- Implement role-based access control
- Use principle of least privilege
- Audit access regularly
- Monitor for unauthorized access

## Performance Optimization

### RPC Optimization
- Use connection pooling
- Implement request batching
- Cache frequently accessed data
- Monitor RPC performance

### Script Optimization
- Use async/await properly
- Implement proper error handling
- Optimize database queries
- Monitor resource usage

### Monitoring
- Track script execution times
- Monitor resource usage
- Alert on performance degradation
- Regular performance reviews

---

For additional support or questions about the scripts, please refer to the project repository or contact the development team.
