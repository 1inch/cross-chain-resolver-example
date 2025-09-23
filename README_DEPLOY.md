# EVM Deploy & Verify (Sepolia)

This repo uses Foundry for EVM contracts with a mixed dependency layout. We configured Foundry to resolve dependencies from both `lib/` (default `forge install`) and `contracts/lib/` (vendored subtree). See `foundry.toml`:

```
[profile.default]
libs = ['lib', 'contracts/lib']
```

## Prerequisites

- forge installed
- Etherscan API key if you plan to verify (`ETHERSCAN_API_KEY`)
- RPC URL and deployer private key (`ETH_RPC_URL`, `PRIVATE_KEY`)
- Ensure submodules are checked out if you rely on vendored libs:
    - `git submodule update --init --recursive`

## Deploy on Sepolia

1. Deploy LimitOrderProtocol

```
export ETH_RPC_URL=https://sepolia.infura.io/v3/<key>
export PRIVATE_KEY=0x<deployer_pk>
export SEPOLIA_WETH=0x<sepolia_weth>
./scripts/deploy-lop-sepolia.sh
```

Copy the printed LOP address into `SEPOLIA_LOP`.

2. Deploy EscrowFactory

```
export SEPOLIA_LOP=0x<from_step_1>
export SEPOLIA_FEE_TOKEN=0x<erc20>
export SEPOLIA_ACCESS_TOKEN=0x<erc20>
export SEPOLIA_OWNER=0x<your_EOA>
export SEPOLIA_RESCUE_DELAY_SRC=3600
export SEPOLIA_RESCUE_DELAY_DST=3600
./scripts/deploy-factory-sepolia.sh
```

Copy the printed Factory address into `SEPOLIA_FACTORY`.

3. Deploy Resolver

```
export SEPOLIA_FACTORY=0x<from_step_2>
export SEPOLIA_LOP=0x<from_step_1>
export SEPOLIA_OWNER=0x<your_EOA>
./scripts/deploy-resolver-sepolia.sh
```

Copy the printed Resolver address to `.env` as `RESOLVER_ADDRESS`.

## Verify on Etherscan

- LimitOrderProtocol

```
LOP_ADDR=0x... SEPOLIA_WETH=0x... ETHERSCAN_API_KEY=<key> \
./scripts/verify-lop-sepolia.sh
```

- EscrowFactory

```
FACTORY_ADDR=0x... SEPOLIA_LOP=0x... SEPOLIA_FEE_TOKEN=0x... SEPOLIA_ACCESS_TOKEN=0x... \
SEPOLIA_OWNER=0x... SEPOLIA_RESCUE_DELAY_SRC=3600 SEPOLIA_RESCUE_DELAY_DST=3600 \
ETHERSCAN_API_KEY=<key> ./scripts/verify-factory-sepolia.sh
```

- Resolver

```
RESOLVER_ADDR=0x... SEPOLIA_FACTORY=0x... SEPOLIA_LOP=0x... SEPOLIA_OWNER=0x... \
ETHERSCAN_API_KEY=<key> ./scripts/verify-resolver-sepolia.sh
```

## Notes

- If you use `forge install`, dependencies will be placed in `lib/` and Foundry will resolve them because `foundry.toml` includes `lib`.
- If you vendor dependencies as a subtree under `contracts/lib/`, ensure submodules are initialized; Foundry will find them because `foundry.toml` includes `contracts/lib`.
- If your IDE shows “Source ... not found: File import callback not supported”, it’s a static-analysis limitation. `forge build` and `forge script` will succeed as long as dependencies are present in one of the listed `libs` directories.
