# GMX CCXT Middleware

GMX CCXT Middleware runs the Python GMX CCXT implementation behind a FastAPI bridge so CCXT clients in other languages can trade on GMX through a simple HTTP endpoint.

The server image is published to GitHub Container Registry:

- `ghcr.io/tradingstrategy-ai/gmx-ccxt-middleware:main`

For architecture, testing, and contributor workflows, see [docs/architecture.md](docs/architecture.md), [docs/tests.md](docs/tests.md), and [docs/development.md](docs/development.md).

## Run with Docker

Set the environment variables you need, then start the published container with Docker Compose.

```bash
export GMX_PRIVATE_KEY="0xyourmainnetprivatekey"
export GMX_AUTH_TOKEN="change-me"

docker compose pull
docker compose up -d
```

The bundled [docker-compose.yaml](docker-compose.yaml) already lists every supported runtime environment variable with a short comment explaining what it does. `GMX_RPC_URL` is optional there and defaults to the public Arbitrum RPC. `GMX_EXECUTION_BUFFER` is also optional and defaults to the safe built-in value `2.2`. The published Docker setup listens on `127.0.0.1:8000` by default.

The bridge exposes:

- `GET /ping` in [ping.py](src/gmx_ccxt_server/routes/ping.py)
- `GET /describe` in [describe.py](src/gmx_ccxt_server/routes/describe.py)
- `POST /call` in [call.py](src/gmx_ccxt_server/routes/call.py)

Example health check:

```bash
curl \
  -H "Authorization: Bearer ${GMX_AUTH_TOKEN}" \
  http://127.0.0.1:8000/ping
```

## JavaScript Example

Warning: the example below places real Arbitrum mainnet trades. It opens and closes a live ETH long using USDC collateral with a hardcoded 5 USD-sized position.

The full runnable file is [docs/example.js](docs/example.js). Run it with:

```bash
BRIDGE_URL="http://127.0.0.1:8000" \
BRIDGE_TOKEN="${GMX_AUTH_TOKEN}" \
node docs/example.js
```

The example uses an `adapterPath` lookup instead of importing `ccxt` from npm. That is intentional: this repository carries a custom generated `gmx` adapter in `ccxt/js/src/gmx.js`, and the example loads that exact local build so it matches the bridge implementation in this repo. Once the adapter is merged and published through upstream CCXT, this can become a normal package import.

Example code:

```js
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:8000';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const SYMBOL = 'ETH/USDC:USDC';
const POSITION_SIZE_USD = 5.0;

async function main() {
  const adapterPath = path.resolve(__dirname, '../ccxt/js/src/gmx.js');
  const { default: GmxExchange } = await import(pathToFileURL(adapterPath).href);

  const exchange = new GmxExchange({
    bridgeUrl: BRIDGE_URL,
    token: BRIDGE_TOKEN,
    timeout: 180000,
  });

  const markets = await exchange.loadMarkets();
  // `loadMarkets()` returns a symbol-keyed map, but its insertion order is not a useful ranking.
  // Fetch open interest explicitly and sort descending so "top 5 markets" has a clear meaning.
  const openInterests = await exchange.fetchOpenInterests(Object.keys(markets));
  const topMarkets = Object.keys(markets)
    .map((symbol) => ({
      symbol,
      openInterestValue: Number(openInterests?.[symbol]?.openInterestValue ?? 0),
    }))
    .sort((left, right) => right.openInterestValue - left.openInterestValue)
    .slice(0, 5);
  console.log('Top 5 markets by open interest (USD):', topMarkets);

  const openOrder = await exchange.createMarketBuyOrder(SYMBOL, 0, {
    size_usd: POSITION_SIZE_USD,
    leverage: 2.0,
    collateral_symbol: 'USDC',
    wait_for_execution: true,
    slippage_percent: 0.005,
  });

  console.log('Opened long:', openOrder);

  const positionsAfterOpen = await exchange.fetchPositions([SYMBOL]);
  console.log('Positions after open:', positionsAfterOpen);

  const closeOrder = await exchange.createOrder(SYMBOL, 'market', 'sell', 0, undefined, {
    size_usd: POSITION_SIZE_USD,
    collateral_symbol: 'USDC',
    reduceOnly: true,
    wait_for_execution: true,
    slippage_percent: 0.005,
  });

  console.log('Closed long:', closeOrder);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```
