# Instructions to work with this repository

## Project overview

This repository exposes the Python GMX CCXT-compatible exchange from the `web3-ethereum-defi` submodule over HTTP and adds a remote `gmx` exchange to the `ccxt` submodule.

The main moving parts are:

- `src/gmx_ccxt_server/`: FastAPI bridge, config loading, runtime, serialisation
- `docker-compose.yaml`: default runtime entrypoint for the published GHCR image
- `tests/python/`: Python unit tests for the bridge runtime and HTTP contract
- `tests/js/`: JavaScript integration and smoke tests against the transpiled CCXT adapter
- `ccxt/`: upstream CCXT checkout and generated outputs
- `web3-ethereum-defi/`: upstream Python GMX implementation

## Working conventions

- Use British English in prose and documentation
- When running Python from this repository, prefer `poetry run python`
- Keep secrets and machine-specific RPC settings outside committed files
- Prefer targeted tests over running everything blindly

## Generated code rules

The `ccxt` submodule contains generated files. For adapter changes:

1. Edit the TypeScript source in `ccxt/ts/src/gmx.ts`
2. Rebuild generated outputs with `make ccxt-build`
3. Do not hand-edit generated files such as:
   - `ccxt/js/src/gmx.js`
   - `ccxt/python/ccxt/gmx.py`
   - `ccxt/php/gmx.php`

If the bridge contract changes, update the TypeScript adapter and regenerate the CCXT outputs in the same change.

## Install and build

Install dependencies:

```shell
make install
```

Build the CCXT adapter outputs:

```shell
make ccxt-build
```

## Running the bridge

Export bridge environment variables first:

```shell
export GMX_PRIVATE_KEY="0xyourprivatekey"
export GMX_AUTH_TOKEN="change-me"
export GMX_SERVER_ADDRESS="127.0.0.1:8000"
```

Start the server:

```shell
make server
```

You can also run it directly:

```shell
poetry run python -m gmx_ccxt_server
```

## Test setup

The repository uses `.local-test.env` as a small shell entrypoint for local secrets. Source it before any RPC-backed tests:

```shell
source .local-test.env
```

Useful environment variables for this project:

- `JSON_RPC_ARBITRUM`
- `JSON_RPC_ARBITRUM_SEPOLIA`
- `GMX_PRIVATE_KEY`
- `GMX_WALLET_ADDRESS`
- `GMX_RPC_URL`
- `GMX_SERVER_ADDRESS`
- `GMX_AUTH_TOKEN`

Not every workflow needs every variable. Read-only smoke tests can run without private key material.

## Running tests

Run the Python bridge tests:

```shell
poetry run pytest tests/python/test_runtime.py
```

Run the JavaScript suite against the transpiled adapter:

```shell
make test-js
```

Run fork-based integration tests:

```shell
source .local-test.env
make test-fork
```

Run live smoke tests:

```shell
source .local-test.env
make test-smoke-live
```

## GMX and Anvil caveat

GMX order execution depends on keeper and oracle mechanics. Anvil is suitable for read-heavy coverage and some pending-order lifecycle checks, but it is not the default place to require successful end-to-end GMX trade execution.

Do not treat failed live execution on a plain fork as an automatic bridge or adapter regression unless the test specifically sets up the extra execution machinery required by GMX.
