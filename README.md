# GMX CCXT Server

[![CI](https://github.com/OWNER/gmx-ccxt-server/actions/workflows/integration.yml/badge.svg)](https://github.com/OWNER/gmx-ccxt-server/actions/workflows/integration.yml)

## Introduction

`gmx-ccxt-server` provides a REST bridge for GMX, a decentralised perpetual futures exchange that does not ship with a native HTTP API.

This repository combines three pieces:

- the existing Python GMX CCXT-compatible implementation from `web3-ethereum-defi`
- a FastAPI server that exposes that Python exchange over HTTP
- a new `gmx` exchange in the `ccxt` TypeScript source tree that forwards CCXT calls to the bridge

The result is a server-owned deployment model where RPC settings, wallet address, and private keys stay on the Python side, while the CCXT adapter can be compiled from TypeScript to JavaScript, Python, PHP, and the rest of the CCXT target languages.

If you are familiar with the `gmx-ccxt-freqtrade` tutorial repository, this project sits one layer lower in the stack: instead of wiring GMX directly into a Python trading bot, it turns the existing Python GMX adapter into a reusable HTTP service and a remote CCXT exchange.

## Benefits

- GMX becomes accessible through a normal HTTP service even though the exchange itself is onchain and RPC-driven
- Private keys stay on the server side instead of being distributed to every CCXT client
- The project reuses the mature Python GMX adapter instead of re-implementing GMX logic in each language
- The new `ccxt/ts/src/gmx.ts` adapter follows CCXT conventions and can be transpiled through the normal CCXT build flow
- The bridge is easier to operate in controlled environments, including local forks, bots, and internal services
- Testing is cleaner because read-heavy flows can run against Anvil forks, while live smoke checks remain opt-in

## Requirements

To work with this repository you need:

- Python 3.11+
- Node.js 20+
- Poetry 2.x
- `git` with submodule support
- Anvil for fork-based integration tests
- An Arbitrum RPC endpoint for fork and live read-only testing

Optional but useful:

- an Arbitrum Sepolia RPC endpoint for live smoke tests
- a funded wallet and private key if you want to exercise account-specific or write-oriented flows

Important test limitation:

- GMX order execution depends on keeper and oracle mechanics
- Anvil is useful for read paths and some pending-order coverage, but full GMX trade execution is intentionally not a default automated test requirement in this repo

## Install

### 1. Clone the repository

```bash
git clone --recurse-submodules <your-repo-url>
cd gmx-ccxt-server
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

### 2. Install Python and Node dependencies

```bash
make install
```

This does two things:

- installs the root Poetry environment, including the local `web3-ethereum-defi` path dependency
- installs the `ccxt` submodule Node dependencies

### Optional: enable Mermaid support in Codex

This repository includes a project-scoped Codex MCP configuration in `.codex/config.toml` for Mermaid Chart's hosted MCP server.

Codex documents project-scoped MCP config via `.codex/config.toml` for trusted projects. Start Codex from this repository to use it:

```bash
codex
```

Core Mermaid rendering and validation tools work without authentication.

If you also want Codex to access your Mermaid Chart projects and saved diagrams, export a Mermaid Chart token before launching Codex:

```bash
export MERMAID_CHART_TOKEN='<your-mermaid-chart-token>'
codex
```

If your Codex install does not yet pick up project-scoped MCP config, copy the same `mcp_servers.mermaid` block into `~/.codex/config.toml`.

Note: the repo's `.mcp.json` is useful for other MCP-aware tools, but Codex reads `.codex/config.toml` or `~/.codex/config.toml`.

### 3. Create a local bridge config

Start from the example file:

```bash
cp config/gmx-bridge.example.toml config/gmx-bridge.local.toml
```

Fill in the values you need:

- `server.host` and `server.port`
- `gmx.rpc_url`
- optional `gmx.private_key`
- optional `gmx.wallet_address`
- optional `server.auth_token`

### 4. Build the CCXT adapter outputs

```bash
make ccxt-build
```

This runs the relevant CCXT export, implicit API generation, TypeScript build, and REST transpilation steps so the new `gmx` exchange is available in generated outputs such as:

- `ccxt/js/src/gmx.js`
- `ccxt/python/ccxt/gmx.py`
- `ccxt/php/gmx.php`

## Use

### Start the bridge server

```bash
make server CONFIG=config/gmx-bridge.local.toml
```

The server exposes:

- `GET /healthz`
- `GET /describe`
- `POST /call`

### Request format

The bridge uses a single RPC-style endpoint:

```json
{
  "id": "optional-request-id",
  "method": "fetch_ticker",
  "args": ["ETH/USDC:USDC"],
  "kwargs": { "params": {} }
}
```

### JavaScript usage

After `make ccxt-build`, you can use the generated JavaScript adapter like this:

```js
import gmx from './ccxt/js/src/gmx.js';

const exchange = new gmx({
    bridgeUrl: 'http://127.0.0.1:8000',
    token: 'optional-bearer-token',
});

const markets = await exchange.loadMarkets();
const ticker = await exchange.fetchTicker('ETH/USDC:USDC');

console.log(Object.keys(markets).length, ticker.last);
```

### Operational model

- the Python bridge owns the RPC connection and optional signing key
- the CCXT adapter only needs `bridgeUrl` and optional `token`
- account-specific reads such as balances and positions require `wallet_address` or a configured signing wallet on the server side

## How To Run Tests

### Python bridge unit tests

```bash
poetry run pytest tests/python/test_runtime.py
```

These validate:

- auth handling
- whitelisted RPC dispatch
- JSON-safe result serialization

### JavaScript test suite

```bash
make test-js
```

This runs the JavaScript tests against the transpiled adapter. Network-dependent suites skip automatically if the required environment is missing.

### Fork-oriented integration tests

Requirements:

- `anvil` installed
- `JSON_RPC_ARBITRUM` set

Run:

```bash
make test-fork
```

These tests:

- start an Anvil fork
- pin the fork to block `44000000`, defined in `tests/js/helpers/bridge-test-helpers.mjs`
- start the FastAPI bridge against that fork
- import the transpiled JS adapter
- verify read-heavy GMX flows through the remote CCXT adapter

By design, they do not treat successful GMX trade execution on Anvil as a required pass condition.

### Live smoke tests

Optional environment variables:

- `JSON_RPC_ARBITRUM`
- `JSON_RPC_ARBITRUM_SEPOLIA`

Run:

```bash
make test-smoke-live
```

These are read-only smoke tests for live networks and are safe to keep opt-in.

## GitHub CI

The repository includes a GitHub Actions pipeline in `.github/workflows/integration.yml`.

It is split into:

- a default build-and-test job that installs dependencies, builds the CCXT adapter, runs Python tests, and runs the JS suite
- an optional fork integration job that runs only when `JSON_RPC_ARBITRUM` is configured as a repository secret
- an optional live smoke job that runs only when `JSON_RPC_ARBITRUM` and/or `JSON_RPC_ARBITRUM_SEPOLIA` secrets are configured

This keeps the default CI deterministic while still supporting richer GMX integration coverage in environments where RPC secrets are available.
