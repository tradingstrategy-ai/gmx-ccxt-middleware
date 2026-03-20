# Development

## Clone and install

Clone the repository with submodules:

```bash
git clone --recurse-submodules git@github.com:tradingstrategy-ai/gmx-ccxt-middleware.git
cd gmx-ccxt-middleware
```

Install Python and Node dependencies:

```bash
make install
```

Build the generated CCXT outputs after adapter changes:

```bash
make ccxt-build
```

## Run the bridge locally

The bridge now starts from environment variables only.

```bash
export GMX_PRIVATE_KEY="0xyourprivatekey"
export GMX_AUTH_TOKEN="change-me"
export GMX_SERVER_ADDRESS="127.0.0.1:8000"

make server
```

If `GMX_RPC_URL` is omitted, the bridge defaults to the public Arbitrum RPC endpoint.

You can also run it directly:

```bash
poetry run python -m gmx_ccxt_server
```

Useful optional bridge variables:

- `GMX_WALLET_ADDRESS`
- `GMX_CHAIN_ID`
- `GMX_SUBSQUID_ENDPOINT`
- `GMX_EXECUTION_BUFFER` optional, defaults to `2.2`
- `GMX_DEFAULT_SLIPPAGE`
- `GMX_VERBOSE`
- `GMX_PRELOAD_MARKETS`
- `GMX_REST_API_MODE`
- `GMX_GRAPHQL_ONLY`
- `GMX_DISABLE_MARKET_CACHE`
- `GMX_VAULT_ADDRESS`

## Build the Docker image locally

Build a local image:

```bash
docker build -t gmx-ccxt-middleware:local .
```

Run that local image directly:

```bash
docker run --rm \
  -p 8000:8000 \
  -e GMX_SERVER_ADDRESS=0.0.0.0:8000 \
  -e GMX_PRIVATE_KEY="0xyourprivatekey" \
  -e GMX_AUTH_TOKEN="change-me" \
  gmx-ccxt-middleware:local
```

If you want Docker Compose to use a locally built image instead of GHCR:

```bash
docker build -t gmx-ccxt-middleware:local .
docker compose down
docker compose up -d --pull never
```

Then set the image line in `docker-compose.yaml` temporarily to `gmx-ccxt-middleware:local`, or use a local override file.

## Tests

Run the Python bridge tests:

```bash
poetry run pytest tests/python/test_runtime.py
```

Run the generated-adapter JavaScript suite:

```bash
make test-js
```

RPC-backed suites use `.local-test.env`:

```bash
source .local-test.env
make test-fork
make test-live
make test-testnet
```

For environment requirements and coverage goals, see [docs/tests.md](tests.md).
