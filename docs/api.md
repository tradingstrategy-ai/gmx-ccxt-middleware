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
