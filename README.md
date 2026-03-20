# GMX CCXT Middleware

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

For configuration, development, architecture, and tests, see [configuration.md](docs/config.md), [development.md](docs/development.md), [architecture.md](docs/architecture.md), and [tests.md](docs/tests.md).

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

Pull the published image from GitHub Container Registry, then run it directly with Docker.

```bash
docker pull ghcr.io/tradingstrategy-ai/gmx-ccxt-middleware:latest

docker run --detach --rm \
  --name gmx-ccxt-middleware \
  --publish 127.0.0.1:8000:8000 \
  --env GMX_PRIVATE_KEY="0xyourmainnetprivatekey" \
  --env GMX_SERVER_AUTH_TOKEN="change-me" \
  ghcr.io/tradingstrategy-ai/gmx-ccxt-middleware:latest
```

`GMX_RPC_URL` is optional there and defaults to the public Arbitrum RPC. `GMX_EXECUTION_BUFFER` is also optional and defaults to the safe built-in value `2.2`. The published Docker setup binds to `0.0.0.0:8000` inside the container and is published on `127.0.0.1:8000` by default in the example above.

The `latest` tag is updated automatically whenever a new numbered release tag such as `v1`, `v2`, or `v3` is published.

The GMX CCXT Middleware Server exposes:

- `GET /ping` in [ping.py](src/gmx_ccxt_server/routes/ping.py)
- `GET /describe` in [describe.py](src/gmx_ccxt_server/routes/describe.py)
- `POST /call` in [call.py](src/gmx_ccxt_server/routes/call.py)

Example health check:

```bash
curl \
  -H "Authorization: Bearer ${GMX_SERVER_AUTH_TOKEN}" \
  http://127.0.0.1:8000/ping
```

## JavaScript Example

Warning: the example below places a real GMX trade with the configured wallet. It first checks that the wallet has enough ETH for gas and enough USDC collateral, then opens and closes a small ETH long so the wallet is returned to flat exposure afterwards.

The full runnable file is [docs/example.js](docs/example.js). Run it with:

```bash
GMX_SERVER_URL="http://127.0.0.1:8000" \
GMX_SERVER_TOKEN="${GMX_SERVER_AUTH_TOKEN}" \
node docs/example.js
```

The example uses an `adapterPath` lookup instead of importing `ccxt` from npm. That is intentional: this repository carries a custom generated `gmx` adapter in `ccxt/js/src/gmx.js`, and the example loads that exact local build so it matches the GMX CCXT Middleware Server implementation in this repo. Once the adapter is merged and published through upstream CCXT, this can become a normal package import.

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
