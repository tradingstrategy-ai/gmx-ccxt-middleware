# GMX CCXT Middleware Server

[![Acceptance smoke](https://github.com/tradingstrategy-ai/gmx-ccxt-middleware/actions/workflows/acceptance-smoke.yml/badge.svg)](https://github.com/tradingstrategy-ai/gmx-ccxt-middleware/actions/workflows/acceptance-smoke.yml)

## Introduction

`gmx-ccxt-middleware` provides an HTTP server interface for GMX, a decentralised perpetual futures exchange that does not ship with a native HTTP API.

This repository combines three pieces:

- the existing Python GMX CCXT-compatible implementation from `web3-ethereum-defi`
- a FastAPI server that exposes that Python exchange over HTTP
- a new `gmx` exchange in the `ccxt` TypeScript source tree that forwards CCXT calls to the GMX CCXT Middleware Server

The result is a server-owned deployment model where RPC settings, wallet address, and private keys stay on the Python side, while the CCXT adapter can be compiled from TypeScript to JavaScript, Python, PHP, and the rest of the CCXT target languages.

If you are familiar with the `gmx-ccxt-freqtrade` tutorial repository, this project sits one layer lower in the stack: instead of wiring GMX directly into a Python trading bot, it turns the existing Python GMX adapter into a reusable HTTP service and a remote CCXT exchange.

The server image is published to GitHub Container Registry:

- `ghcr.io/tradingstrategy-ai/gmx-ccxt-middleware:latest`
- `ghcr.io/tradingstrategy-ai/gmx-ccxt-middleware:vN`
- `ghcr.io/tradingstrategy-ai/gmx-ccxt-middleware:main`

For configuration, development, architecture, API details, and tests, see [configuration.md](docs/config.md), [development.md](docs/development.md), [architecture.md](docs/architecture.md), [api.md](docs/api.md), and [tests.md](docs/tests.md).

## Benefits

- GMX becomes accessible through a normal HTTP service even though the exchange itself is on-chain and RPC-driven
- Private keys stay on the server side instead of being distributed to every CCXT client
- The project reuses the mature Python GMX adapter instead of re-implementing GMX logic in each language
- The `ccxt/ts/src/gmx.ts` adapter follows CCXT conventions and can be transpiled through the normal CCXT build flow
- The GMX CCXT Middleware Server is easier to operate in controlled environments, including local forks, bots, and internal services
- Testing is cleaner because read-heavy flows can run against Anvil forks, while live smoke checks remain opt-in

![Main architecture](docs/images/architecture.svg)

For the full breakdown, sequence diagrams, and external integration notes, see [architecture.md](docs/architecture.md).

## Run with Docker

Pull the published image from [GitHub Container Registry](https://docs.github.com/packages/working-with-a-github-packages-registry/working-with-the-container-registry), then run it directly with Docker.

Before the first pull, create a GitHub personal access token with package read access and log Docker into `ghcr.io`; see the [GHCR login guide](https://tradingstrategy.ai/docs/deployment/docker-images.html#login-to-ghcr).

```bash
# Reads hot wallet private key from GMX_PRIVATE_KEY env
docker run \
  --tty \
  --platform linux/amd64 \
  --publish 127.0.0.1:8000:8000 \
  --env GMX_PRIVATE_KEY="$GMX_PRIVATE_KEY" \
  --env GMX_SERVER_AUTH_TOKEN="change-me" \
  ghcr.io/tradingstrategy-ai/gmx-ccxt-middleware:latest
```

## JavaScript Example: Open and close GMX position

After GMX CCXT Middleware Server is running, you can interact with GMX like with any other CCXT supported exchange.

Warning: the example below places a real GMX trade with the configured wallet. It first checks that the wallet has enough ETH for gas and enough USDC collateral, then opens and closes a small ETH long so the wallet is returned to flat exposure afterwards.

The example code is [docs/example.js](docs/example.js).

Run it with the command below. Run in another terminal so you can watch the server:

```bash
GMX_SERVER_URL="http://127.0.0.1:8000" GMX_SERVER_TOKEN="change-me" node docs/example.js
```

You should see output like:

```

Wallet Context
  Server: http://127.0.0.1:8000
  Trade mode: open_and_close
  Chain: arbitrum (42161)
  Wallet: 0xdcc6D3...5622c6
  Expected wallet: not set
  Gas balance: 0.022994 ETH

Wallet Balances
  ETH: 0.022994 ETH free
  USDC: $36.25 free
  Minimum required: 0.002 ETH gas, $3.50 collateral

Positions Before Open
  Positions: none

Top Markets By Open Interest
  1. ETH/USDC:USDC | OI $59,041,196.81
  2. BTC/USDC:USDC | OI $21,781,466.11
  3. XRP/USDC:USDC | OI $3,827,729.41
  4. HYPE/USDC:USDC | OI $1,389,335.64
  5. SUI/USDC:USDC | OI $889,638.38

Open Order
  Symbol: ETH/USDC:USDC
  Side: buy
  Status: closed
  Size: $5.00
  Filled: 0.00232766
  Average price: $2,148.078865
  Fee: 0.002 USDC + 0.000141 ETH execution
  Created at: 2026-03-20T21:54:09.332000Z
  Submit tx: 0xbd51abbc04...a7639c96c9
  Execution tx: 0xa88f362f85...9a705a648c

Positions After Open
  1. ETH/USDC:USDC long | size $5.00 | entry $2,148.681108 | mark $2,148.6183 | PnL $0.00 (0%) | lev 2.0016x

Close Order
  Symbol: ETH/USDC:USDC
  Side: sell
  Status: closed
  Size: $5.00
  Filled: 0.00232708
  Average price: $2,148.6183
  Fee: 0.003 USDC + 0.000141 ETH execution
  Created at: 2026-03-20T21:54:16.592000Z
  Submit tx: 0x9f926cd67c...0276fdaa73
  Execution tx: 0x3cf2bb33a1...6c16442cb2

Positions After Close
  1. ETH/USDC:USDC long | size $5.00 | entry $2,148.681108 | mark $2,148.652726 | PnL $0.00 (0%) | lev 2.0016x
Example trade flow completed.
➜  gmx-ccxt-server git:(main) ✗
➜  gmx-ccxt-server git:(main) ✗ GMX_SERVER_URL="http://127.0.0.1:8000" GMX_SERVER_TOKEN="change-me" node docs/example.js
Warning: this script places a real GMX trade through the configured server wallet.

Wallet Context
  Server: http://127.0.0.1:8000
  Trade mode: open_and_close
  Chain: arbitrum (42161)
  Wallet: 0xdcc6D3...5622c6
  Expected wallet: not set
  Gas balance: 0.022723 ETH

Wallet Balances
  ETH: 0.022723 ETH free
  USDC: $36.25 free
  Minimum required: 0.002 ETH gas, $3.50 collateral

Positions Before Open
  Positions: none

Top Markets By Open Interest
  1. ETH/USDC:USDC | OI $59,042,436.00
  2. BTC/USDC:USDC | OI $21,821,067.99
  3. XRP/USDC:USDC | OI $3,827,729.41
  4. HYPE/USDC:USDC | OI $1,389,335.64
  5. SUI/USDC:USDC | OI $889,638.38
```

## Ethereum balances to understand

On Arbitrum and Arbitrum Sepolia, the wallet needs native ETH for gas. This is the chain currency used to pay transaction fees, and it is not an ERC-20 token.

`WETH` is wrapped ETH: an ERC-20 token that is designed to track ETH one-for-one, but it is still a token balance, not gas balance. Holding `WETH` does not by itself let the wallet pay gas fees.

In [GMX trading docs](https://docs.gmx.io/docs/trading/), classic trades on Arbitrum still pay gas in native `ETH`. In the [GMX](https://docs.gmx.io/docs/providing-liquidity/), the ETH/USD market is described as `WETH-USDC`, with `WETH` backing long positions.

That means a GMX wallet view can legitimately show both concepts at once: native `ETH` for gas, and `WETH` as the ERC-20 asset used by GMX markets, collateral flows, or token balances. GMX also normalises `WETH` to `ETH` in some token displays, so an `ETH` symbol in GMX metadata does not always mean spendable native gas in the wallet.

You may also see an `ETH` symbol in token lists or exchange balances. In GMX-related token metadata, that can refer to a market or token entry rather than the wallet's native gas balance. For that reason, the GMX CCXT Middleware Server exposes native gas separately in `fetchStatus().info.gasTokenBalance` and `fetchStatus().info.gasTokenBalanceWei`.

## Arbitrum Sepolia testnet

Arbitrum Sepolia is Arbirum testnet where you do not need to use real money for testing. Arbitrum Sepolia has GMX testnet deployment.

For local smoke testing on Arbitrum Sepolia you usually need three things:

- Sepolia ETH on Arbitrum for gas
- GMX test stablecoin collateral
- optional test WETH if you want to inspect balances or experiment with token-level flows directly

For Sepolia ETH, use the [LearnWeb3 Arbitrum Sepolia faucet](https://learnweb3.io/faucets/arbitrum_sepolia/).

For GMX test tokens, the Sepolia deployment uses mintable token contracts, so you can mint test balances to your own wallet directly from Arbiscan by calling `mint(account, amount)` on the relevant token contract:

- `USDC.SG`: [`0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773`](https://sepolia.arbiscan.io/address/0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773#writeContract)
- `USDC`: [`0x3321Fd36aEaB0d5CdfD26f4A3A93E2D2aAcCB99f`](https://sepolia.arbiscan.io/address/0x3321Fd36aEaB0d5CdfD26f4A3A93E2D2aAcCB99f#writeContract)
- `WETH`: [`0x980B62Da83eFf3D4576C647993b0c1D7faf17c73`](https://sepolia.arbiscan.io/address/0x980B62Da83eFf3D4576C647993b0c1D7faf17c73#writeContract)

Example: to mint `999` units of `USDC.SG`, call `mint(your_address, 999000000)`, because the token uses `6` decimals.

Pay close attention to the collateral symbol used by the market. On Arbitrum Sepolia, GMX commonly uses `USDC.SG` rather than plain `USDC`, so using the wrong stablecoin variant can cause order validation to fail. If a market is quoted like `ETH/USDC.SG:USDC.SG`, fund the wallet with `USDC.SG` and use `USDC.SG` as the collateral symbol in your order parameters.

These Sepolia funding notes are based on the upstream GMX tutorial material in [`README-GMX-Lagoon.md`](web3-ethereum-defi/eth_defi/gmx/README-GMX-Lagoon.md) and [`lagoon-multichain.rst`](web3-ethereum-defi/docs/source/tutorials/lagoon-multichain.rst).

## API

For endpoint details and a basic health-check example, see [api.md](docs/api.md).
