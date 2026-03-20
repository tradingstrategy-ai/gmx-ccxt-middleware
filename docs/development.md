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

## Run the GMX CCXT Middleware Server locally

The GMX CCXT Middleware Server now starts from environment variables only.

```bash
export GMX_PRIVATE_KEY="0xyourprivatekey"
export GMX_SERVER_AUTH_TOKEN="change-me"
export GMX_SERVER_ADDRESS="127.0.0.1:8000"

make server
```

If `GMX_RPC_URL` is omitted, the GMX CCXT Middleware Server defaults to the public Arbitrum RPC endpoint.

You can also run it directly:

```bash
poetry run python -m gmx_ccxt_server
```

Useful optional GMX CCXT Middleware Server variables:

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
  -e GMX_PRIVATE_KEY="0xyourprivatekey" \
  -e GMX_SERVER_AUTH_TOKEN="change-me" \
  gmx-ccxt-middleware:local
```

If you want Docker Compose to use a locally built image instead of GHCR:

```bash
docker build -t gmx-ccxt-middleware:local .
docker compose down
docker compose up -d --pull never
```

Then set the image line in `docker-compose.yaml` temporarily to `gmx-ccxt-middleware:local`, or use a local override file.

The checked-in `docker-compose.yaml` uses `ghcr.io/tradingstrategy-ai/gmx-ccxt-middleware:latest`. The `latest` tag is reserved for the most recent numbered release tag.

## Tests

Run the Python GMX CCXT Middleware Server tests:

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

## Release process

Versioned builds are created from Git tags in the form `v1`, `v2`, `v3`, and so on. The Docker workflow already publishes on `v*` tag pushes, so the normal release flow is to mint the next numeric tag and push it.

Use the release helper:

```bash
scripts/release.sh
```

The script will:

1. fetch tags from `origin`
2. find the highest existing numeric `vN` tag
3. create the next annotated tag on the current `HEAD`
4. push the tag to GitHub
5. create a GitHub release with generated notes if `gh` is installed and authenticated

Before running it:

- make sure your working tree is clean
- make sure you are on the commit you want to release
- make sure `origin` points at the GitHub repository you want to publish from

Useful options:

- `scripts/release.sh --yes` skips the confirmation prompt
- `scripts/release.sh --yes --push-only` pushes the tag but skips GitHub release creation

After the tag is pushed, GitHub Actions will build and publish the versioned artefact for that tag.

When the tag matches the release pattern (`v1`, `v2`, `v3`, ...), the Docker publish workflow also moves the container `latest` tag to that same release.
