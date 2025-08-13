# Cross-Chain Contracts Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Contracts](#core-contracts)
4. [Interfaces](#interfaces)
5. [Adapters](#adapters)
6. [Testing Framework](#testing-framework)
7. [Deployment](#deployment)
8. [Security](#security)
9. [Gas Optimization](#gas-optimization)
10. [Troubleshooting](#troubleshooting)

## Overview

The contracts directory contains a comprehensive suite of Solidity smart contracts that enable secure cross-chain asset transfers between NEAR Protocol and Ethereum. The system implements atomic cross-chain swaps with partial fill support, dynamic pricing, and robust security mechanisms.

### Key Features
- **Atomic Cross-Chain Swaps**: Hash time-locked contracts (HTLCs) for secure transfers
- **Partial Fill Support**: Advanced order splitting and partial fulfillment capabilities
- **Dynamic Pricing**: Integration with auction-based pricing mechanisms
- **Multi-Token Support**: Support for ETH and ERC-20 tokens
- **Security First**: Comprehensive security measures and emergency controls
- **Gas Optimized**: Efficient contract design for minimal gas consumption

## Architecture

### System Overview
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   NEAR Chain    │    │   Bridge Layer  │    │ Ethereum Chain  │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ NEAR Escrow │◄┼────┼►│ NearBridge  │ │    │ │  Resolver   │ │
│ │  Contract   │ │    │ │  Contract   │ │    │ │  Contract   │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│                 │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│                 │    │ │   Message   │◄┼────┼►│   Escrow    │ │
│                 │    │ │   Relayer   │ │    │ │  Factory    │ │
│                 │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Contract Hierarchy
```
Resolver.sol (Main Controller)
├── NearBridge.sol (Cross-chain Communication)
├── TestEscrowFactory.sol (Escrow Management)
├── adapters/
│   ├── TokenAdapter.sol (Token Handling)
│   ├── EthAdapter.sol (ETH Handling)
│   └── ERC20Adapter.sol (ERC-20 Handling)
├── interfaces/
│   └── IBaseEscrow.sol (Core Interfaces)
└── types/ (Type Definitions)
```

## Core Contracts

### Resolver.sol
**Purpose**: Main controller contract that orchestrates cross-chain operations and manages the overall system state.

**Key Features**:
- Cross-chain order coordination
- Partial fill management
- Fee calculation and distribution
- Emergency controls and pausing
- Access control and governance

**Core Functions**:
```solidity
contract Resolver {
    // Order Management
    function createOrder(OrderParams calldata params) external payable returns (bytes32);
    function fillOrder(bytes32 orderHash, uint256 fillAmount) external;
    function cancelOrder(bytes32 orderHash) external;
    
    // Partial Fill Support
    function processPartialFill(bytes32 orderHash, uint256 fillAmount) external;
    function refundUnfilledAmount(bytes32 orderHash) external;
    
    // Cross-chain Coordination
    function processCrossChainMessage(bytes calldata message) external;
    function sendCrossChainMessage(bytes calldata message) external;
    
    // Emergency Controls
    function pause() external onlyOwner;
    function unpause() external onlyOwner;
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner;
}
```

**State Management**:
```solidity
struct Order {
    bytes32 orderHash;
    address maker;
    address taker;
    address token;
    uint256 amount;
    uint256 filledAmount;
    uint256 remainingAmount;
    uint256 fee;
    uint256 deadline;
    OrderStatus status;
    bytes32 secretHash;
}

enum OrderStatus {
    Created,
    PartiallyFilled,
    Filled,
    Cancelled,
    Refunded
}
```

**Events**:
```solidity
event OrderCreated(bytes32 indexed orderHash, address indexed maker, uint256 amount);
event OrderFilled(bytes32 indexed orderHash, address indexed taker, uint256 fillAmount);
event OrderPartiallyFilled(bytes32 indexed orderHash, uint256 fillAmount, uint256 remainingAmount);
event OrderCancelled(bytes32 indexed orderHash, string reason);
event OrderRefunded(bytes32 indexed orderHash, uint256 refundAmount);
event CrossChainMessageSent(bytes32 indexed messageHash, bytes message);
event CrossChainMessageReceived(bytes32 indexed messageHash, bytes message);
```

### NearBridge.sol
**Purpose**: Handles cross-chain communication between Ethereum and NEAR Protocol, managing message passing and state synchronization.

**Key Features**:
- Cross-chain message verification
- NEAR light client integration
- Merkle proof validation
- Message relay coordination
- State synchronization

**Core Functions**:
```solidity
contract NearBridge {
    // Message Handling
    function sendMessage(bytes calldata message, uint256 nearGas) external payable;
    function receiveMessage(bytes calldata message, bytes calldata proof) external;
    
    // Light Client Integration
    function updateNearBlockHeader(bytes calldata header, bytes calldata proof) external;
    function verifyNearTransaction(bytes calldata txHash, bytes calldata proof) external view returns (bool);
    
    // State Synchronization
    function syncOrderState(bytes32 orderHash, OrderState calldata state) external;
    function getOrderState(bytes32 orderHash) external view returns (OrderState memory);
    
    // Validator Management
    function addValidator(address validator) external onlyOwner;
    function removeValidator(address validator) external onlyOwner;
    function updateValidatorThreshold(uint256 threshold) external onlyOwner;
}
```

**Message Structure**:
```solidity
struct CrossChainMessage {
    bytes32 messageId;
    address sender;
    bytes32 recipient;
    bytes payload;
    uint256 timestamp;
    uint256 blockHeight;
    bytes signature;
}
```

**Security Features**:
- Multi-signature validation
- Replay attack protection
- Message ordering guarantees
- Emergency pause mechanisms

### TestEscrowFactory.sol
**Purpose**: Factory contract for creating and managing escrow contracts for cross-chain transfers.

**Key Features**:
- Escrow contract deployment
- Template management
- Access control
- Fee management
- Upgrade mechanisms

**Core Functions**:
```solidity
contract TestEscrowFactory {
    // Escrow Management
    function createEscrow(EscrowParams calldata params) external payable returns (address);
    function getEscrow(bytes32 orderHash) external view returns (address);
    function isValidEscrow(address escrow) external view returns (bool);
    
    // Template Management
    function updateEscrowTemplate(address newTemplate) external onlyOwner;
    function getEscrowTemplate() external view returns (address);
    
    // Fee Management
    function setCreationFee(uint256 fee) external onlyOwner;
    function withdrawFees() external onlyOwner;
}
```

**Escrow Parameters**:
```solidity
struct EscrowParams {
    bytes32 orderHash;
    address maker;
    address taker;
    address token;
    uint256 amount;
    uint256 fee;
    uint256 timelock;
    bytes32 secretHash;
}
```

### FeeToken.sol
**Purpose**: Utility contract for managing fee tokens and fee distribution across the system.

**Key Features**:
- Fee token management
- Distribution mechanisms
- Staking integration
- Governance token functionality

**Core Functions**:
```solidity
contract FeeToken is ERC20 {
    // Fee Management
    function distributeFees(address[] calldata recipients, uint256[] calldata amounts) external;
    function calculateFee(uint256 amount, uint256 feeRate) external pure returns (uint256);
    
    // Staking Integration
    function stake(uint256 amount) external;
    function unstake(uint256 amount) external;
    function getStakedAmount(address user) external view returns (uint256);
}
```

## Interfaces

### IBaseEscrow.sol
**Purpose**: Core interface defining the escrow contract structure and functionality.

**Interface Definition**:
```solidity
interface IBaseEscrow {
    struct Immutables {
        bytes32 orderHash;
        bytes32 hashlock;
        address maker;
        address taker;
        address token;
        uint256 amount;
        uint256 safetyDeposit;
        Timelocks timelocks;
    }
    
    struct Timelocks {
        uint256 srcCancellation;
        uint256 dstCancellation;
    }
    
    // Core Functions
    function complete(bytes32 secret) external;
    function cancel() external;
    function refund() external;
    
    // State Queries
    function getState() external view returns (EscrowState);
    function isCompleted() external view returns (bool);
    function isCancelled() external view returns (bool);
    
    // Events
    event EscrowCompleted(bytes32 secret);
    event EscrowCancelled(string reason);
    event EscrowRefunded(uint256 amount);
}
```

## Adapters

### TokenAdapter.sol
**Purpose**: Abstract base contract for handling different token types in escrow operations.

**Key Features**:
- Token type abstraction
- Transfer mechanisms
- Balance management
- Fee calculation

**Core Functions**:
```solidity
abstract contract TokenAdapter {
    // Transfer Functions
    function transferFrom(address from, address to, uint256 amount) external virtual;
    function transfer(address to, uint256 amount) external virtual;
    
    // Balance Functions
    function balanceOf(address account) external view virtual returns (uint256);
    function allowance(address owner, address spender) external view virtual returns (uint256);
    
    // Fee Functions
    function calculateTransferFee(uint256 amount) external view virtual returns (uint256);
}
```

### EthAdapter.sol
**Purpose**: Handles native ETH transfers and escrow operations.

**Implementation**:
```solidity
contract EthAdapter is TokenAdapter {
    function transferFrom(address from, address to, uint256 amount) external override {
        require(msg.value == amount, "Incorrect ETH amount");
        payable(to).transfer(amount);
    }
    
    function balanceOf(address account) external view override returns (uint256) {
        return account.balance;
    }
}
```

### ERC20Adapter.sol
**Purpose**: Handles ERC-20 token transfers and escrow operations.

**Implementation**:
```solidity
contract ERC20Adapter is TokenAdapter {
    IERC20 public immutable token;
    
    constructor(address _token) {
        token = IERC20(_token);
    }
    
    function transferFrom(address from, address to, uint256 amount) external override {
        token.safeTransferFrom(from, to, amount);
    }
    
    function balanceOf(address account) external view override returns (uint256) {
        return token.balanceOf(account);
    }
}
```

## Testing Framework

### Test Structure
The testing framework uses Foundry for comprehensive contract testing with the following structure:

```
test/
├── unit/                     # Unit tests for individual contracts
├── integration/              # Integration tests for contract interactions
├── e2e/                     # End-to-end tests for complete workflows
├── mocks/                   # Mock contracts for testing
└── fixtures/                # Test data and fixtures
```

### Key Test Files

#### Resolver.t.sol.backup
**Purpose**: Comprehensive testing of the Resolver contract functionality.

**Test Categories**:
- Order creation and management
- Partial fill operations
- Cross-chain coordination
- Emergency controls
- Access control

#### NearBridge.test.sol
**Purpose**: Testing of cross-chain communication functionality.

**Test Scenarios**:
- Message sending and receiving
- Light client updates
- Proof verification
- Validator management

#### TestEscrowFactory.t.sol
**Purpose**: Testing of escrow factory operations.

**Test Coverage**:
- Escrow creation
- Template management
- Fee handling
- Access control

#### ResolverPartialFill.t.sol
**Purpose**: Specialized testing for partial fill functionality.

**Test Scenarios**:
- Single partial fills
- Multiple partial fills
- Partial fill with refunds
- Cross-chain coordination
- Edge cases and error handling

### Test Utilities

#### Mock Contracts
```solidity
contract MockNearBridge {
    mapping(bytes32 => bool) public processedMessages;
    
    function sendMessage(bytes calldata message, uint256 nearGas) external payable {
        bytes32 messageHash = keccak256(message);
        processedMessages[messageHash] = true;
        emit MessageSent(messageHash, message);
    }
}
```

#### Test Helpers
```solidity
library TestHelpers {
    function createOrder(address maker, uint256 amount) internal pure returns (OrderParams memory) {
        return OrderParams({
            maker: maker,
            token: address(0),
            amount: amount,
            fee: amount / 100,
            deadline: block.timestamp + 1 hours,
            secretHash: keccak256("secret")
        });
    }
    
    function generateSecret() internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(block.timestamp, block.difficulty));
    }
}
```

### Running Tests

#### Foundry Commands
```bash
# Run all tests
forge test

# Run specific test file
forge test --match-path test/Resolver.t.sol

# Run tests with gas reporting
forge test --gas-report

# Run tests with coverage
forge coverage

# Run tests with verbosity
forge test -vvv
```

#### Test Configuration
```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
cache_path = "cache"
optimizer = true
optimizer_runs = 200
via_ir = false
```

## Deployment

### Deployment Scripts

#### Deploy.s.sol
```solidity
contract DeployScript is Script {
    function run() external {
        vm.startBroadcast();
        
        // Deploy core contracts
        Resolver resolver = new Resolver();
        NearBridge bridge = new NearBridge();
        TestEscrowFactory factory = new TestEscrowFactory();
        
        // Configure contracts
        resolver.setBridge(address(bridge));
        resolver.setFactory(address(factory));
        
        vm.stopBroadcast();
    }
}
```

#### Deployment Commands
```bash
# Deploy to local network
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Deploy to testnet
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --verify

# Deploy to mainnet
forge script script/Deploy.s.sol --rpc-url $MAINNET_RPC_URL --broadcast --verify
```

### Contract Verification
```bash
# Verify on Etherscan
forge verify-contract <contract-address> src/Resolver.sol:Resolver --etherscan-api-key $ETHERSCAN_API_KEY
```

## Security

### Security Features

#### Access Control
```solidity
contract Resolver is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    
    modifier onlyRelayer() {
        require(hasRole(RELAYER_ROLE, msg.sender), "Not authorized relayer");
        _;
    }
}
```

#### Emergency Controls
```solidity
contract Resolver is Pausable {
    function pause() external onlyOwner {
        _pause();
    }
    
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner whenPaused {
        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }
}
```

#### Reentrancy Protection
```solidity
contract Resolver is ReentrancyGuard {
    function fillOrder(bytes32 orderHash, uint256 fillAmount) external nonReentrant {
        // Order filling logic
    }
}
```

### Security Best Practices

#### Input Validation
```solidity
function createOrder(OrderParams calldata params) external payable {
    require(params.amount > 0, "Amount must be positive");
    require(params.deadline > block.timestamp, "Deadline must be in future");
    require(params.maker != address(0), "Invalid maker address");
    // Additional validation...
}
```

#### Safe Math Operations
```solidity
using SafeMath for uint256;

function calculateFee(uint256 amount, uint256 feeRate) internal pure returns (uint256) {
    return amount.mul(feeRate).div(10000);
}
```

#### Event Logging
```solidity
event SecurityEvent(
    address indexed actor,
    string action,
    bytes32 indexed orderHash,
    uint256 timestamp
);

function logSecurityEvent(string memory action, bytes32 orderHash) internal {
    emit SecurityEvent(msg.sender, action, orderHash, block.timestamp);
}
```

## Gas Optimization

### Optimization Strategies

#### Storage Optimization
```solidity
// Pack structs to minimize storage slots
struct Order {
    address maker;      // 20 bytes
    uint96 amount;      // 12 bytes (fits in same slot)
    address taker;      // 20 bytes
    uint96 filledAmount; // 12 bytes (fits in same slot)
    uint256 deadline;   // 32 bytes (new slot)
    bytes32 secretHash; // 32 bytes (new slot)
}
```

#### Function Optimization
```solidity
// Use calldata for read-only parameters
function processOrder(OrderParams calldata params) external {
    // Function logic
}

// Use unchecked for safe operations
function safeAdd(uint256 a, uint256 b) internal pure returns (uint256) {
    unchecked {
        return a + b; // Safe when overflow is impossible
    }
}
```

#### Event Optimization
```solidity
// Use indexed parameters for filtering
event OrderCreated(
    bytes32 indexed orderHash,
    address indexed maker,
    uint256 amount  // Not indexed to save gas
);
```

### Gas Reporting
```bash
# Generate gas report
forge test --gas-report

# Optimize specific functions
forge test --gas-report --match-test testCreateOrder
```

## Troubleshooting

### Common Issues

#### Transaction Reverts
**Symptoms**: Transactions failing with revert messages
**Solutions**:
- Check function requirements and validations
- Verify contract state and permissions
- Ensure sufficient gas limits
- Validate input parameters

#### Gas Estimation Failures
**Symptoms**: `UNPREDICTABLE_GAS_LIMIT` errors
**Solutions**:
- Check contract state consistency
- Verify function parameters
- Ensure contract is not paused
- Check for reentrancy issues

#### Cross-Chain Message Failures
**Symptoms**: Messages not being processed across chains
**Solutions**:
- Verify bridge contract configuration
- Check validator signatures
- Ensure proper message formatting
- Validate proof submissions

### Debugging Tools

#### Foundry Debugging
```bash
# Debug specific transaction
forge debug <transaction-hash> --rpc-url $RPC_URL

# Trace contract calls
forge trace <transaction-hash> --rpc-url $RPC_URL
```

#### Event Analysis
```solidity
// Add debug events for troubleshooting
event Debug(string message, uint256 value);

function debugFunction(uint256 value) internal {
    emit Debug("Function called", value);
}
```

### Performance Monitoring

#### Gas Usage Tracking
```solidity
contract GasTracker {
    mapping(bytes4 => uint256) public gasUsage;
    
    modifier trackGas() {
        uint256 gasStart = gasleft();
        _;
        uint256 gasUsed = gasStart - gasleft();
        gasUsage[msg.sig] = gasUsed;
    }
}
```

#### State Monitoring
```solidity
contract StateMonitor {
    event StateChange(
        bytes32 indexed orderHash,
        OrderStatus oldStatus,
        OrderStatus newStatus,
        uint256 timestamp
    );
    
    function updateOrderStatus(bytes32 orderHash, OrderStatus newStatus) internal {
        OrderStatus oldStatus = orders[orderHash].status;
        orders[orderHash].status = newStatus;
        emit StateChange(orderHash, oldStatus, newStatus, block.timestamp);
    }
}
```

## Development Workflow

### Contract Development Process
1. **Design**: Define contract interfaces and architecture
2. **Implementation**: Develop contracts with security in mind
3. **Testing**: Create comprehensive test suites
4. **Optimization**: Optimize for gas efficiency
5. **Security Review**: Conduct security audits
6. **Deployment**: Deploy to testnet and mainnet

### Code Quality Standards
- Use latest Solidity version
- Follow security best practices
- Implement comprehensive error handling
- Add detailed documentation
- Maintain high test coverage

### Continuous Integration
```yaml
# .github/workflows/contracts.yml
name: Contracts CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      - name: Run tests
        run: forge test
      - name: Check gas usage
        run: forge test --gas-report
```

---

For additional support or questions about the contracts, please refer to the project repository or contact the development team.
