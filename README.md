# cross-chain-resolver-example

## Installation

Install example deps

```shell
pnpm install
```

Install [foundry](https://book.getfoundry.sh/getting-started/installation)

```shell
curl -L https://foundry.paradigm.xyz | bash
```

Initialize contract submodules

```shell
git submodule update --init --recursive
```

## Running

To run tests you need to provide fork urls for Ethereum and Bsc

```shell
SRC_CHAIN_RPC=ETH_FORK_URL DST_CHAIN_RPC=BNB_FORK_URL pnpm test
```

### Public rpc

| Chain    | Url                          |
|----------|------------------------------|
| Ethereum | https://eth.merkle.io        |
| BSC      | wss://bsc-rpc.publicnode.com |

## Environment

Copy `.env.example` to `.env` or export the variables in your shell before running tests:

```shell
cp .env.example .env
# then edit values as needed
```

Required variables:

- `SRC_CHAIN_RPC`: HTTPS/WS RPC for Ethereum mainnet fork
- `DST_CHAIN_RPC`: HTTPS/WS RPC for BSC mainnet fork
- `SRC_CHAIN_CREATE_FORK`: `true`/`false` to run a local fork via Anvil
- `DST_CHAIN_CREATE_FORK`: `true`/`false` to run a local fork via Anvil

## Troubleshooting

- BSC RPC over WSS may fail to fork in some environments. If you see forking errors, try switching to an HTTPS endpoint, e.g. `https://bsc-dataseed.binance.org`.
- Contracts are built with Foundry and artifacts are emitted to `dist/contracts` (configured in `foundry.toml`). Tests expect artifacts at that path.
- Node.js 22 is required (see `package.json` `engines` and Volta pin). Use Volta or nvm to match the version.


## Test accounts

### Available Accounts

```
(0) 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" Owner of EscrowFactory
(1) 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" User
(2) 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" Resolver
```
