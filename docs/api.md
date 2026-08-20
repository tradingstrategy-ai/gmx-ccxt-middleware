# API

The GMX CCXT Middleware Server exposes:

- `GET /ping` in [ping.py](../src/gmx_ccxt_server/routes/ping.py)
- `GET /describe` in [describe.py](../src/gmx_ccxt_server/routes/describe.py)
- `POST /call` in [call.py](../src/gmx_ccxt_server/routes/call.py)

Example health check:

```bash
curl \
  -H "Authorization: Bearer ${GMX_SERVER_AUTH_TOKEN}" \
  http://127.0.0.1:8000/ping
```

## `POST /call`

`/call` dispatches a single CCXT method call to the underlying GMX exchange instance. The
request body is a JSON envelope:

```json
{
  "id": 1,
  "method": "load_markets",
  "args": [],
  "kwargs": {}
}
```

- `method` uses the CCXT **snake_case** method name (`load_markets`, `fetch_ticker`,
  `fetch_balance`, `fetch_positions`, ...), not the camelCase name used by the JS adapter.
- `args` is a positional-argument list, matching the Python method signature.
- Any extra keyword arguments that CCXT itself accepts as a trailing options object must be
  nested under a `params` key inside `kwargs`, not passed as top-level `kwargs` entries — this
  is the convention the generated JS adapter (`ccxt/js/src/gmx.js`) relies on when it forwards
  calls to this server.

Example: fetch a ticker.

```bash
curl \
  -H "Authorization: Bearer ${GMX_SERVER_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"id": 1, "method": "fetch_ticker", "args": ["ETH/USDC:USDC"], "kwargs": {}}' \
  http://127.0.0.1:8000/call
```

Example: fetch positions with extra options, showing the `params` nesting rule.

```bash
curl \
  -H "Authorization: Bearer ${GMX_SERVER_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"id": 1, "method": "fetch_positions", "args": [["ETH/USDC:USDC"]], "kwargs": {"params": {"open_positions_source": "rpc"}}}' \
  http://127.0.0.1:8000/call
```
