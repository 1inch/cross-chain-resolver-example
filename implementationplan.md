# 1inch Fusion+ x NEAR Protocol Cross-Chain Swap (Hackathon Implementation)

## Important Hackathon Constraints
- **No Production API Access**: We will not use the official 1inch REST APIs
- **Local Development Focus**: All testing will be done locally using the provided contracts
- **Not Broadcast to Live Network**: Orders will not be broadcast to the live resolver set
- **Use Provided Contracts**: Build on top of the existing contracts in `cross-chain-resolver-example/contracts`

## Development Approach
1. Use the provided `Resolver` and `TestEscrowFactory` contracts as the foundation
2. Extend the existing escrow system to support NEAR protocol
3. Implement a local relayer for cross-chain communication
4. Test using forked networks and local nodes

## Phase 1: Research & Design (1 days)

### 1.1 System Architecture Design
- Design high-level architecture diagram
  - 1inch Fusion+ components
  - NEAR Shade Agent components
  - Cross-chain communication layer
  - Data flow for both directions (ETH→NEAR, NEAR→ETH)

### 1.2 Protocol Integration Design
- Define message formats
  - Order creation
  - Order fulfillment
  - Error handling
- Design hashlock & timelock mechanisms
  - EVM (1inch) implementation
  - NEAR implementation
  - Cross-chain verification

### 1.3 Security Design
- Threat modeling
- Security considerations for TEE
- Key management for Chain Signatures

## Phase 2: NEAR Side Implementation (2 days)

### 2.1 Shade Agent Development
- Set up Shade Agent project
  - Initialize TEE environment
  - Configure build pipeline
- Implement core agent logic
  - Event listening
  - Order processing
  - State management

### 2.2 NEAR Smart Contracts
- Escrow contract
  - Asset custody
  - Hashlock verification
  - Timelock enforcement
- Bridge contract
  - Cross-chain message verification
  - Asset locking/unlocking

### 2.3 Chain Signatures Integration
- Implement signing logic
- Key management in TEE
- Transaction construction

## Phase 3: Ethereum Side Implementation (2 days)

### 3.1 Local Fusion+ Integration
- Study and extend the provided `Resolver` contract
- Implement local order management
  - Order validation
  - Cross-chain verification using the existing escrow system
- Local event monitoring
  - Order creation
  - Fulfillment tracking

### 3.2 Smart Contract Development
- Bridge contract
  - Asset custody
  - Message verification
  - Dispute resolution
- Adapter contracts
  - Token standards support
  - Fee handling

## Phase 4: Cross-Chain Communication (1 days)

### 4.1 Local Message Relaying
- Implement local relayer service
  - Simple message queue for local testing
  - Basic retry mechanism
  - Local signature verification
  - Nonce management for local testing

### 4.2 State Synchronization
- Implement state sync mechanism
- Handle chain reorganizations
- Implement finality checks

## Phase 5: Testing & Security (1 days)

### 5.1 Unit Testing
- Smart contract tests
- Agent logic tests
- Integration tests

### 5.2 Security Audits
- Code review
- Formal verification (where applicable)
- Penetration testing

### 5.3 Local Network Testing
- Deploy to local forked networks
- End-to-end testing with local nodes
- Basic load testing with local simulation
- Dry run testnet deployment

## Phase 6: Testnet Deployment (1 days)

### 6.1 Testnet Setup
- Deploy contracts to testnets
  - Ethereum: Goerli/Sepolia
  - NEAR: Testnet
- Fund test wallets with test tokens
- Configure cross-chain communication

### 6.2 On-chain Demo Preparation
- Prepare test scenarios for both directions:
  - ETH/ERC20 → NEAR
  - NEAR → ETH/ERC20
- Create verification scripts
  - Check contract states
  - Verify token balances
  - Monitor cross-chain events
- Prepare block explorer links for demo

## Phase 7: Demo & Documentation (1 days)

### 7.1 Live Demo Preparation
- Script demo flow with testnet deployment
- Prepare verification steps
  - Transaction hashes
  - Contract states
  - Cross-chain verification
- Create backup recording

### 7.2 Documentation
- Architecture documentation
- API documentation
- User guides
- Deployment guide

## Phase 8: Stretch Goals

### 7.1 UI Development
- Basic swap interface
- Transaction monitoring
- History and status

### 7.2 Partial Fills
- Order splitting
- Partial fulfillment logic
- Refund handling

### 8.1 UI Development
- Basic swap interface
- Transaction monitoring
- History and status

### 8.2 Partial Fills
- Order splitting
- Partial fulfillment logic
- Refund handling

### 8.3 Relayer Enhancement
- Improve relayer reliability
- Add comprehensive logging
- Monitoring and alerting

## Technical Stack

### NEAR Side
- **Language**: Rust
- **Frameworks**: NEAR SDK, Shade Agent Framework
- **TEE**: Intel SGX
- **Key Management**: NEAR Chain Signatures

### Ethereum Side
- **Language**: Solidity, TypeScript
- **Frameworks**: Hardhat, ethers.js
- **Libraries**: 1inch Fusion+ SDK
- **Base Contracts**: Extend from provided `Resolver` and `TestEscrowFactory`

### Infrastructure
- **Relayer**: Node.js/Typescript
- **Monitoring**: Prometheus, Grafana
- **CI/CD**: GitHub Actions
- **Testnet Faucets**:
  - Ethereum: Goerli/Sepolia faucets
  - NEAR: Testnet wallet
- **Block Explorers**:
  - Etherscan/Blockscout
  - NEAR Explorer

## Next Steps
1. Begin with Phase 1.1 (System Architecture Design)
2. Set up development environments
3. Start implementing core components in parallel