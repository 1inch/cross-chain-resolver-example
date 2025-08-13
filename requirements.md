Phase 1

Build a novel extension for 1inch Cross-chain Swap (Fusion+) that enables swaps between Ethereum and Near.

Requirements:
- Preserve hashlock and timelock functionality for the non-EVM implementation
- Swap functionality should be bidirectional (swaps should be possible to and from Ethereum)
- Onchain (mainnet or testnet) execution of token transfers should be presented during the final demo

Stretch goals (not hard requirements):
- UI
- Enable partial fills
- Relayer and resolver

Phase 2

Build a decentralized solver that integrates with 1inch Fusion+ for cross-chain swaps using NEAR's Shade Agent Framework and Trusted Execution Environment.

Your solver must listen for quote requests, produce valid 1inch Fusion meta-orders using NEAR's Chain Signatures, include comprehensive documentation with setup instructions, and demonstrate end-to-end functionality. Bonus points for modular architecture that extends to other protocols.

