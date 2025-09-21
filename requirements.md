## Notes
- Goal: Build a novel extension for 1inch Fusion+ enabling atomic swaps between Ethereum and NEAR.
- The solution requires a decentralized solver integrating 1inch Fusion+ with NEAR's Shade Agent Framework.
- Solver must listen for quote requests, produce valid 1inch Fusion meta-orders using NEAR Chain Signatures, and demonstrate bidirectional swaps.
- Must preserve hashlock and timelock functionality for non-EVM (NEAR) implementation.
- Onchain execution of token transfers (testnet) must be demonstrated.
- The NEAR-side agent/solver must:
  - Use Near intents
  - Integrate with the defined meta-order/message formats for cross-chain swaps
  - Be compatible with 1inch Fusion+ meta-orders and NEAR Chain Signatures
  - Modular architecture
  - Great UI - Frontend 
  - Partial fills
  - Relayer and resolver
- Demo must include live onchain execution of swaps on testnet
- Key NEAR tech: Chain Abstraction, Shade Agents, Chain Signatures, NEAR Intents.

Hashed Timelock Contracts
- Smart contracts that hold funds
- Require some secret 's' to unlock the funds
- Will expire after a set amount of time

Your primary goal
- Manage the hashed timelock contracts and communication between an EVM chain and your non-EVM chain (all CLI/testnet is ok!)
- Properly handle hashlock logic
- Properly handle contract expiration/reverts
- Swaps must be bi-directional

Do not post any orders to our REST APIs
- Your resolver will not work with our official backend system


Documentation required for NEAR side of the project:
https://docs.near.org/chain-abstraction/intents/overview
https://docs.near-intents.org/near-intents


1inch Fusion+ Documentation
https://portal.1inch.dev/documentation/apis/swap/fusion-plus/introduction
https://portal.1inch.dev/documentation/becoming-a-resolver/fusion-plus-test-examples

Cross-chain Resolver Example
- Typescript
- Simulates a Fusion+ swap between Ethereum and BNB
- Has all information needed for the EVM side of your project
https://github.com/1inch/cross-chain-resolver-example







