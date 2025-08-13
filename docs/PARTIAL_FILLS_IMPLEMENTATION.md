# Cross-Chain Partial Fills Implementation

## Overview

This document provides comprehensive documentation for the cross-chain partial fills and refunds implementation in the cross-chain resolver system. The implementation supports atomic partial order fulfillment across NEAR and Ethereum chains with robust error handling and cross-chain coordination.

## Architecture

### Core Components

#### 1. Partial Fill Services

**NearPartialFillService** (`/relayer/src/services/NearPartialFillService.ts`)
- Handles partial fills on NEAR blockchain
- Supports order splitting and refund processing
- Integrates with NEAR smart contracts
- Provides order state management

**EthereumPartialFillService** (`/relayer/src/services/EthereumPartialFillService.ts`)
- Manages partial fills on Ethereum
- Handles gas estimation and transaction optimization
- Supports ERC-20 token partial fills
- Provides comprehensive error handling

#### 2. Cross-Chain Relayers

**NearRelayer** (`/relayer/src/relay/NearRelayer.ts`)
- Enhanced with partial fill coordination
- Implements cross-chain message passing
- Manages order status tracking
- Handles NEAR→ETH partial fill workflows

**EthereumRelayer** (`/relayer/src/relay/EthereumRelayer.ts`)
- Integrated with partial fill services
- Supports ETH→NEAR coordination
- Implements event-driven partial fill processing
- Manages cross-chain state synchronization

#### 3. Smart Contract Updates

**Resolver Contract** (`/contracts/src/Resolver.sol`)
- Extended with partial fill functionality
- Supports order splitting and tracking
- Implements refund mechanisms
- Emits detailed events for cross-chain coordination

### Key Features

#### Partial Fill Support
- **Order Splitting**: Large orders can be split into smaller, manageable portions
- **Fill Tracking**: Comprehensive tracking of filled amounts and remaining balances
- **Minimum Fill Amounts**: Configurable minimum fill percentages to prevent dust orders
- **Maximum Fill Limits**: Protection against excessive order fragmentation

#### Cross-Chain Coordination
- **Message Passing**: Secure communication between NEAR and Ethereum relayers
- **State Synchronization**: Consistent order state across both chains
- **Event-Driven Architecture**: Real-time coordination through blockchain events
- **Atomic Operations**: Ensures consistency even in failure scenarios

#### Refund Processing
- **Automatic Refunds**: Unfilled portions can be automatically refunded
- **Manual Refunds**: Support for manual refund processing
- **Cross-Chain Refunds**: Coordinated refund processing across chains
- **Reason Tracking**: Detailed logging of refund reasons

## Implementation Details

### Data Structures

#### OrderState Interface
```typescript
interface OrderState {
  filledAmount: string;
  remainingAmount: string;
  fillCount: number;
  isFullyFilled: boolean;
  isCancelled: boolean;
  lastFillTimestamp: number;
  childOrders: string[];
}
```

#### PartialFillParams Interface
```typescript
interface PartialFillParams {
  orderId: string;
  fillAmount: string;
  recipient: string;
  token: string;
  minFillPercent?: number;
  maxFills?: number;
}
```

### Cross-Chain Message Format
```typescript
interface CrossChainMessage {
  type: 'PARTIAL_FILL_NOTIFICATION' | 'REFUND_NOTIFICATION' | 'PARTIAL_FILL_CONFIRMATION';
  orderHash: string;
  fillAmount?: string;
  remainingAmount?: string;
  refundAmount?: string;
  secretHash: string;
  timestamp: number;
  reason?: string;
}
```

### Event Emissions

#### Partial Fill Events
- `OrderPartiallyFilled(orderHash, fillAmount, remainingAmount, secretHash)`
- `OrderSplit(parentOrderHash, childOrderHashes, amounts)`
- `OrderRefunded(orderHash, refundAmount, recipient, secretHash, reason)`

#### Cross-Chain Events
- `CrossChainPartialFillInitiated(orderHash, targetChain, fillAmount)`
- `CrossChainRefundProcessed(orderHash, targetChain, refundAmount)`

## Usage Examples

### Processing a Partial Fill

```typescript
// NEAR side
const nearRelayer = new NearRelayer(config);
await nearRelayer.processPartialFill(
  'order_123',
  '0.5', // Fill 0.5 NEAR
  'recipient.near',
  'near'
);

// Ethereum side
const ethRelayer = new EthereumRelayer(config);
await ethRelayer.processPartialFill(
  '0x...', // Order hash
  ethers.utils.parseEther('0.3'), // Fill 0.3 ETH
  '0x...', // Recipient address
  '0x0' // ETH address
);
```

### Order Splitting

```typescript
const splitResult = await nearRelayer.splitOrder(
  'large_order_456',
  ['1.0', '2.0', '1.5'] // Split into 3 orders
);
console.log('Split order IDs:', splitResult.orderIds);
```

### Refund Processing

```typescript
await nearRelayer.processRefund(
  'order_789',
  'user.near',
  'Order timeout'
);
```

## Testing

### Test Coverage

The implementation includes comprehensive test coverage:

#### Unit Tests
- **Service Tests**: Individual service functionality
- **Relayer Tests**: Relayer integration with services
- **Contract Tests**: Smart contract partial fill logic

#### Integration Tests
- **Cross-Chain Coordination**: End-to-end partial fill workflows
- **Event Handling**: Event emission and processing
- **State Management**: Order state consistency

#### Edge Case Tests
- **Boundary Conditions**: Minimum/maximum fill amounts
- **Network Failures**: Resilience to network issues
- **Concurrency**: Multiple simultaneous partial fills
- **State Inconsistencies**: Recovery from inconsistent states

#### End-to-End Tests
- **Complete Workflows**: Full partial fill and refund cycles
- **Cross-Chain Scenarios**: NEAR↔ETH coordination
- **Performance Tests**: High-frequency operations

### Running Tests

```bash
# Run all partial fill tests
npm run test:partial-fills

# Run specific test suites
npm test tests/integration/PartialFillIntegration.test.ts
npm test tests/edge-cases/PartialFillEdgeCases.test.ts
npm test tests/e2e/CrossChainPartialFillE2E.test.ts

# Run contract tests (Foundry)
cd contracts && forge test --match-path "**/ResolverPartialFill.t.sol"

# Run comprehensive test suite
node scripts/run-partial-fill-tests.ts
```

## Configuration

### NEAR Configuration
```typescript
const nearConfig = {
  nearAccount: nearAccount,
  ethereum: {
    rpcUrl: 'https://sepolia.infura.io/v3/...',
    privateKey: process.env.ETH_PRIVATE_KEY
  },
  ethereumEscrowFactoryAddress: '0x...',
  escrowContractId: 'escrow.contract.near',
  pollIntervalMs: 5000
};
```

### Ethereum Configuration
```typescript
const ethConfig = {
  ethereum: {
    rpcUrl: 'https://sepolia.infura.io/v3/...',
    privateKey: process.env.ETH_PRIVATE_KEY,
    resolverAddress: '0x...',
    resolverAbi: [...] // Contract ABI
  },
  near: {
    networkId: 'testnet',
    nodeUrl: 'https://rpc.testnet.near.org',
    accountId: 'relayer.testnet',
    privateKey: process.env.NEAR_PRIVATE_KEY
  }
};
```

## Security Considerations

### Access Control
- **Owner-Only Functions**: Critical functions protected by `onlyOwner` modifier
- **Reentrancy Protection**: All state-changing functions use `nonReentrant`
- **Input Validation**: Comprehensive validation of all parameters

### Cross-Chain Security
- **Secret Hash Verification**: Secure linking of cross-chain operations
- **Message Authentication**: Cryptographic verification of cross-chain messages
- **State Consistency**: Atomic operations to prevent inconsistent states

### Economic Security
- **Minimum Fill Amounts**: Prevention of dust attacks
- **Gas Optimization**: Efficient gas usage for partial fills
- **Fee Structures**: Appropriate fee mechanisms for partial operations

## Performance Optimizations

### Gas Optimization
- **Batch Operations**: Multiple partial fills in single transaction
- **Storage Efficiency**: Optimized storage layout for order data
- **Event Optimization**: Minimal event data for cost efficiency

### Scalability
- **Asynchronous Processing**: Non-blocking cross-chain coordination
- **Parallel Fills**: Support for concurrent partial fills
- **Caching**: Intelligent caching of order states

## Error Handling

### Common Error Scenarios
1. **Insufficient Remaining Amount**: Order cannot fulfill requested amount
2. **Network Failures**: Cross-chain communication issues
3. **Contract Reverts**: Smart contract execution failures
4. **State Inconsistencies**: Mismatched order states across chains

### Recovery Mechanisms
- **Retry Logic**: Automatic retry for transient failures
- **State Reconciliation**: Periodic state synchronization
- **Manual Intervention**: Admin functions for edge cases
- **Rollback Procedures**: Safe rollback for failed operations

## Monitoring and Logging

### Key Metrics
- **Fill Success Rate**: Percentage of successful partial fills
- **Cross-Chain Latency**: Time for cross-chain coordination
- **Gas Usage**: Average gas consumption per operation
- **Error Rates**: Frequency of different error types

### Logging
- **Structured Logging**: JSON-formatted logs for analysis
- **Correlation IDs**: Tracking across distributed components
- **Performance Metrics**: Detailed timing information
- **Error Context**: Comprehensive error information

## Future Enhancements

### Planned Features
1. **Advanced Order Types**: Support for more complex order structures
2. **Dynamic Fee Adjustment**: Market-based fee mechanisms
3. **MEV Protection**: Protection against maximum extractable value attacks
4. **Cross-Chain Bridges**: Integration with additional bridge protocols

### Scalability Improvements
1. **Layer 2 Integration**: Support for Ethereum Layer 2 solutions
2. **Batch Processing**: Enhanced batch operation capabilities
3. **State Channels**: Off-chain state management for high-frequency operations
4. **Sharding Support**: Preparation for blockchain sharding

## Conclusion

The cross-chain partial fills implementation provides a robust, secure, and efficient solution for atomic partial order fulfillment across NEAR and Ethereum blockchains. The comprehensive test suite ensures reliability, while the modular architecture allows for future enhancements and scalability improvements.

The implementation successfully addresses the key requirements:
- ✅ Atomic partial order fulfillment
- ✅ Cross-chain coordination and consistency
- ✅ Comprehensive refund mechanisms
- ✅ Robust error handling and recovery
- ✅ Extensive test coverage
- ✅ Production-ready security measures

For technical support or questions about the implementation, please refer to the test files and code comments for detailed examples and usage patterns.
