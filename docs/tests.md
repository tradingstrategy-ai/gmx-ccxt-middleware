# Test plan

## Purpose

This document defines the testing plan for the GMX bridge server and the remote CCXT `gmx` adapter in this repository.

The plan is based on the existing GMX test inventory in `web3-ethereum-defi/tests/gmx` and `web3-ethereum-defi/tests/gmx/ccxt`, which already covers a large amount of GMX functionality in Python. Our goal here is to mirror that coverage for the JavaScript client side of the bridge, while keeping the environments realistic for GMX:

- `live`: read-only public and account-read tests against live Arbitrum GMX infrastructure
- `fork`: Anvil fork tests for transaction construction, request serialisation, order payloads, and non-executed lifecycle checks
- `testnet`: Arbitrum Sepolia tests for real signed trading flows and post-trade reads

## Environment model

### Live

- Network: Arbitrum One
- Purpose: read-only coverage for market data, funding, open interest, currencies, markets, and safe account reads
- Bridge mode: view-only or wallet-address-only
- No order creation or cancellation

### Fork

- Network: Anvil fork of Arbitrum One
- Fork block: `44000000`
- Purpose: request/response contract tests, market loading, account reads, transaction construction, order payload validation, and pending-order fetch/cancel flows where available
- Bridge mode: wallet address only, private key wallet, Lagoon wallet
- No requirement for full GMX keeper-driven execution on fork

### Testnet

- Network: Arbitrum Sepolia
- Purpose: real end-to-end signed trading tests
- Bridge mode: funded private key wallet and funded Lagoon wallet
- Used for create/cancel/fetch order lifecycle, leverage and margin updates, and trade history
- EOA-backed Sepolia tests use `GMX_PRIVATE_KEY` as the signing key environment variable; a separate wallet address env is optional

## Environment variables

The JavaScript test suite is environment-gated. Some variables are required for the whole suite, while others only enable extra coverage.

The bridge itself is now environment-only as well. Test helpers start it by exporting `GMX_*` variables instead of writing temporary config files.

### Core RPC variables

These are the primary variables needed to run the non-Lagoon test suite:

- `JSON_RPC_ARBITRUM`
  Required for Arbitrum One live tests and Anvil fork tests.
- `JSON_RPC_ARBITRUM_SEPOLIA`
  Required for Arbitrum Sepolia smoke, trading, and margin tests.

### EOA account variables

These enable account-read and EOA-backed trading coverage:

- `GMX_PRIVATE_KEY`
  Primary signing key for Arbitrum Sepolia EOA test cases.
- `GMX_WALLET_ADDRESS`
  Optional explicit wallet address for live account-read tests or any case where the target address should be pinned.
  The live account-read tests default to `0xdcc6D3A3C006bb4a10B448b1Ee750966395622c6` when this variable is omitted.

The default live-account wallet address was chosen by deriving the EOA address from the current `GMX_PRIVATE_KEY` used in the local test environment. At the time of writing, `Account.from_key(GMX_PRIVATE_KEY)` resolves to `0xdcc6D3A3C006bb4a10B448b1Ee750966395622c6`. This default is only used in the live account-read test file to avoid extra local setup. Sepolia trading and margin tests do not use a default wallet address, because those tests are keyed off the signing wallet itself and therefore require `GMX_PRIVATE_KEY` by definition.

### Lagoon variables

These only affect Lagoon-specific tests:

- `GMX_LAGOON_SAFE_ADDRESS`
  Enables Lagoon fork read-path tests.
- `GMX_LAGOON_ASSET_MANAGER_PRIVATE_KEY`
  Enables Lagoon fork tests that require an asset-manager signer.
- `GMX_LAGOON_TESTNET_VAULT_ADDRESS`
  Enables Lagoon Sepolia read/trade tests.
- `GMX_LAGOON_TESTNET_TRADING_STRATEGY_MODULE_ADDRESS`
  Enables Lagoon Sepolia read/trade tests.
- `GMX_LAGOON_TESTNET_ASSET_MANAGER_PRIVATE_KEY`
  Enables Lagoon Sepolia read/trade tests.
- `GMX_LAGOON_TESTNET_FORWARD_ETH`
  Optional flag for Lagoon Sepolia setup.
- `GMX_LAGOON_TESTNET_ALLOW_TRADES`
  Optional safety gate. Must be set to `true` before Lagoon trade-lifecycle tests will execute.

### Current suite mapping

- Public live market-data tests:
  `JSON_RPC_ARBITRUM`
- Live account-read tests:
  `JSON_RPC_ARBITRUM` plus either `GMX_WALLET_ADDRESS` or `GMX_PRIVATE_KEY`
- Fork bridge/error/trading tests:
  `JSON_RPC_ARBITRUM`
- Sepolia smoke tests:
  `JSON_RPC_ARBITRUM_SEPOLIA`
- Sepolia EOA trading and leverage tests:
  `JSON_RPC_ARBITRUM_SEPOLIA` plus `GMX_PRIVATE_KEY`
- Lagoon fork tests:
  `JSON_RPC_ARBITRUM` plus `GMX_LAGOON_SAFE_ADDRESS` and `GMX_LAGOON_ASSET_MANAGER_PRIVATE_KEY`
- Lagoon Sepolia read-path tests:
  `JSON_RPC_ARBITRUM_SEPOLIA` plus `GMX_LAGOON_TESTNET_VAULT_ADDRESS`, `GMX_LAGOON_TESTNET_TRADING_STRATEGY_MODULE_ADDRESS`, and `GMX_LAGOON_TESTNET_ASSET_MANAGER_PRIVATE_KEY`
- Lagoon Sepolia trade-lifecycle tests:
  the same Lagoon Sepolia variables plus `GMX_LAGOON_TESTNET_ALLOW_TRADES=true`

### Minimal practical setups

- Read-only live + fork coverage:
  `JSON_RPC_ARBITRUM`
- Full non-Lagoon coverage used in this repo today:
  `JSON_RPC_ARBITRUM`, `JSON_RPC_ARBITRUM_SEPOLIA`, `GMX_PRIVATE_KEY`
- Add live account-read targeting without signing:
  `GMX_WALLET_ADDRESS`
- Add Lagoon coverage:
  the relevant `GMX_LAGOON_*` variables listed above

## Wallet setup matrix

We want all JavaScript integration tests to work across the following wallet configurations where relevant:

- `view-only`: bridge has RPC only, no signing key
- `wallet-address-only`: bridge has wallet address for account reads, but no signing key
- `private-key wallet`: bridge has EOA private key and signs trades
- `Lagoon wallet`: bridge is configured to trade through a Lagoon wallet setup

For Arbitrum Sepolia EOA tests, the primary signing env is:

- `GMX_PRIVATE_KEY`

Optional companion envs:

- `GMX_WALLET_ADDRESS` when the test needs to target a specific address explicitly

Recommended fixture families:

- `liveViewOnlyBridge`
- `liveWalletAddressBridge`
- `forkPrivateKeyBridge`
- `forkLagoonBridge`
- `testnetPrivateKeyBridge`
- `testnetLagoonBridge`

## Module layout

Tests should be grouped by CCXT functionality first, then by environment. Suggested JavaScript modules:

- `tests/js/bridge-contract.test.mjs`
- `tests/js/gmx-market-data.live.test.mjs`
- `tests/js/gmx-market-data.fork.test.mjs`
- `tests/js/gmx-account.live.test.mjs`
- `tests/js/gmx-account.fork.test.mjs`
- `tests/js/gmx-trading.fork.test.mjs`
- `tests/js/gmx-trading.testnet.test.mjs`
- `tests/js/gmx-margin.testnet.test.mjs`
- `tests/js/gmx-lagoon.fork.test.mjs`
- `tests/js/gmx-lagoon.testnet.test.mjs`
- `tests/js/gmx-errors.test.mjs`

## Coverage goals

The target is to cover as much of the implemented CCXT surface in `ccxt/ts/src/gmx.ts` as practical:

- `fetchMarkets`
- `fetchCurrencies`
- `fetchTicker`
- `fetchTickers`
- `fetchOHLCV`
- `fetchTrades`
- `fetchTime`
- `fetchStatus`
- `fetchOpenInterest`
- `fetchOpenInterestHistory`
- `fetchOpenInterests`
- `fetchFundingRate`
- `fetchFundingRateHistory`
- `fetchFundingHistory`
- `fetchAPY`
- `fetchBalance`
- `fetchOpenOrders`
- `fetchMyTrades`
- `fetchPositions`
- `fetchMarketLeverageTiers`
- `fetchLeverageTiers`
- `setLeverage`
- `fetchLeverage`
- `addMargin`
- `reduceMargin`
- `createOrder`
- `createMarketBuyOrder`
- `createMarketSellOrder`
- `createLimitOrder`
- `cancelOrder`
- `cancelOrders`
- `fetchOrder`
- `fetchOrders`
- negative parity for `fetchOrderBook` and `fetchClosedOrders`

## Existing upstream references

The following Python test groups are the main input for this plan:

- Market and endpoint coverage:
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_gmx_endpoints.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_gmx_markets.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_price_sanity.py`
- Account and balances:
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_gmx_balance.py`
  - `web3-ethereum-defi/tests/gmx/test_open_positions.py`
  - `web3-ethereum-defi/tests/gmx/test_gmx_valuation.py`
- Trading and order lifecycle:
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_trading.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_cancel_order.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_sltp.py`
  - `web3-ethereum-defi/tests/gmx/test_swap_order.py`
  - `web3-ethereum-defi/tests/gmx/test_cancel_order.py`
  - `web3-ethereum-defi/tests/gmx/test_sltp_order.py`
- Fees, safety, and validation:
  - `web3-ethereum-defi/tests/gmx/ccxt/test_fee_reporting.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_extract_fee_from_trade_action.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_order_verification.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_cancel_helpers.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_datastore_market_disabled.py`
- Configuration and wallet setups:
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_gmx_initialization.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_gmx_features.py`
  - `web3-ethereum-defi/tests/gmx/ccxt/test_ccxt_gmx_inheritance.py`
  - `web3-ethereum-defi/tests/gmx/lagoon/test_gmx_lagoon_integration.py`
  - `web3-ethereum-defi/tests/gmx/lagoon/test_gmx_lagoon_wallet.py`

## GitHub CI

The repository includes a GitHub Actions pipeline in `.github/workflows/integration.yml`.

It is split into:

- a default build-and-test job that installs dependencies, builds the CCXT adapter, runs Python tests, and runs the JS suite
- an optional fork integration job that runs only when `JSON_RPC_ARBITRUM` is configured as a repository secret
- an optional live smoke job that runs only when `JSON_RPC_ARBITRUM` and/or `JSON_RPC_ARBITRUM_SEPOLIA` secrets are configured

This keeps the default CI deterministic while still supporting richer GMX integration coverage in environments where RPC secrets are available.

## Test matrix

| Functionality category | Test type | Test module | Test case name | Description of functionality tested |
| --- | --- | --- | --- | --- |
| Bridge contract | fork | `tests/js/bridge-contract.test.mjs` | `test_bridge_ping_returns_runtime_metadata` | Verify `GET /ping` returns liveness and non-secret config summary. |
| Bridge contract | fork | `tests/js/bridge-contract.test.mjs` | `test_bridge_describe_returns_exchange_metadata` | Verify `GET /describe` returns bridge metadata plus GMX `describe()` payload. |
| Bridge contract | fork | `tests/js/bridge-contract.test.mjs` | `test_bridge_call_serialises_args_and_result` | Verify the JS adapter sends a valid `/call` payload and receives JSON-safe values back. |
| Bridge contract | fork | `tests/js/bridge-contract.test.mjs` | `test_bridge_rejects_missing_or_invalid_bearer_token` | Verify bridge auth works and maps to CCXT `AuthenticationError`. |
| Initialisation | fork | `tests/js/bridge-contract.test.mjs` | `test_js_adapter_requires_bridge_url` | Verify constructor validation when `bridgeUrl` is missing. |
| Initialisation | fork | `tests/js/bridge-contract.test.mjs` | `test_js_adapter_accepts_bridge_url_token_and_timeout` | Verify basic adapter constructor options and successful bootstrap. |
| Market metadata | live | `tests/js/gmx-market-data.live.test.mjs` | `test_load_markets_live` | Load markets from live GMX through the bridge and verify the symbol map is populated. |
| Market metadata | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_markets_live_returns_ccxt_market_shapes` | Verify `fetchMarkets()` returns a valid CCXT market array with ids, symbols, limits, and precision. |
| Market metadata | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_currencies_live` | Verify `fetchCurrencies()` exposes the expected settlement and collateral tokens. |
| Market metadata | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_market_leverage_tiers_live` | Verify `fetchMarketLeverageTiers()` for a core market such as `ETH/USDC:USDC`. |
| Market metadata | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_leverage_tiers_live` | Verify multi-market leverage tier fetch returns keyed results. |
| Market metadata | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_apy_live` | Verify `fetchAPY()` works for all markets and for a single symbol. |
| Market data | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_ticker_live` | Verify `fetchTicker()` returns a valid ticker for a canonical GMX market. |
| Market data | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_tickers_live` | Verify `fetchTickers()` returns multiple symbols and symbol-indexed results. |
| Market data | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_ohlcv_live` | Verify `fetchOHLCV()` returns recent candles for supported timeframes. |
| Market data | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_trades_live` | Verify `fetchTrades()` returns recent public trade data. |
| Market data | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_time_and_status_live` | Verify `fetchTime()` and `fetchStatus()` return sensible values. |
| Funding and OI | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_funding_rate_live` | Verify `fetchFundingRate()` returns symbol-level funding data. |
| Funding and OI | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_funding_rate_history_live` | Verify `fetchFundingRateHistory()` returns historical points. |
| Funding and OI | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_funding_history_live` | Verify `fetchFundingHistory()` works for a symbol and paginates cleanly. |
| Funding and OI | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_open_interest_live` | Verify `fetchOpenInterest()` for a canonical perp market. |
| Funding and OI | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_open_interest_history_live` | Verify `fetchOpenInterestHistory()` returns historical data in CCXT shape. |
| Funding and OI | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_open_interests_live` | Verify `fetchOpenInterests()` for multiple symbols. |
| Price sanity | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_ticker_with_price_sanity_enabled` | Mirror Python price sanity coverage and verify sane prices under default config. |
| Price sanity | live | `tests/js/gmx-market-data.live.test.mjs` | `test_fetch_ticker_with_price_sanity_disabled` | Verify optional sanity-check bypass behaviour. |
| Account reads | live | `tests/js/gmx-account.live.test.mjs` | `test_fetch_balance_live_wallet_address_mode` | Verify `fetchBalance()` in wallet-address mode returns a valid CCXT balance structure. |
| Account reads | live | `tests/js/gmx-account.live.test.mjs` | `test_fetch_positions_live_wallet_address_mode` | Verify `fetchPositions()` returns positions or a valid empty list for a target wallet. |
| Account reads | live | `tests/js/gmx-account.live.test.mjs` | `test_fetch_open_orders_live_wallet_address_mode` | Verify `fetchOpenOrders()` returns open orders for a known wallet or a valid empty result. |
| Account reads | live | `tests/js/gmx-account.live.test.mjs` | `test_fetch_my_trades_live_wallet_address_mode` | Verify `fetchMyTrades()` shape for a known wallet. |
| Adapter error parity | live | `tests/js/gmx-errors.test.mjs` | `test_fetch_order_book_raises_not_supported` | Verify unsupported `fetchOrderBook()` maps to CCXT `NotSupported`. |
| Adapter error parity | live | `tests/js/gmx-errors.test.mjs` | `test_fetch_closed_orders_raises_not_supported` | Verify unsupported `fetchClosedOrders()` maps to CCXT `NotSupported`. |
| Transaction construction | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_create_market_buy_order_builds_valid_request` | Verify `createMarketBuyOrder()` builds a valid order request and returns structured pending order metadata. |
| Transaction construction | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_create_market_sell_order_builds_valid_request` | Verify `createMarketSellOrder()` request construction and payload serialisation. |
| Transaction construction | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_create_limit_order_builds_valid_request` | Verify `createLimitOrder()` request shape, trigger fields, and symbol handling. |
| Transaction construction | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_create_order_supports_size_usd_and_base_amount_modes` | Mirror Python SL/TP sizing tests for `sizeUsd` versus base amount inputs. |
| Transaction construction | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_order_request_contains_expected_execution_fee_and_slippage_fields` | Verify execution fee, slippage, and order params are forwarded correctly to the bridge. |
| Transaction construction | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_invalid_symbol_or_zero_amount_raises_invalid_order` | Mirror Python negative order validation cases. |
| Pending lifecycle | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_fetch_orders_after_pending_order_creation` | If pending orders can be created without keeper execution, verify `fetchOrders()` sees them. |
| Pending lifecycle | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_fetch_open_orders_pending_only_filter` | Verify `fetchOpenOrders()` with pending-only params mirrors Python cancel-order tests. |
| Pending lifecycle | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_fetch_order_by_id_after_creation` | Verify `fetchOrder()` works for a created pending order. |
| Pending lifecycle | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_cancel_order_pending_order` | Verify `cancelOrder()` for a pending order on fork if fixture setup allows it. |
| Pending lifecycle | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_cancel_orders_batch_pending_orders` | Verify `cancelOrders()` for multiple pending orders if fixture setup allows it. |
| Account reads | fork | `tests/js/gmx-account.fork.test.mjs` | `test_fetch_balance_private_key_wallet` | Verify `fetchBalance()` via a funded fork EOA bridge instance. |
| Account reads | fork | `tests/js/gmx-account.fork.test.mjs` | `test_fetch_positions_private_key_wallet` | Verify `fetchPositions()` on a funded fork EOA bridge instance. |
| Margin and leverage | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_set_leverage_builds_valid_request` | Verify `setLeverage()` request construction, params, and validation. |
| Margin and leverage | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_fetch_leverage_reads_current_value` | Verify `fetchLeverage()` returns CCXT-compatible leverage info. |
| Margin and leverage | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_add_margin_builds_valid_request` | Verify `addMargin()` request construction on fork without requiring full execution. |
| Margin and leverage | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_reduce_margin_builds_valid_request` | Verify `reduceMargin()` request construction on fork without requiring full execution. |
| Fee reporting | fork | `tests/js/gmx-trading.fork.test.mjs` | `test_order_fee_fields_are_present_in_pending_order_result` | Mirror Python fee reporting and confirm fee fields are surfaced in CCXT order results. |
| Trading lifecycle | testnet | `tests/js/gmx-trading.testnet.test.mjs` | `test_create_market_buy_order_testnet` | Create a real market buy order on Arbitrum Sepolia using a funded private key bridge. |
| Trading lifecycle | testnet | `tests/js/gmx-trading.testnet.test.mjs` | `test_create_limit_order_testnet` | Create a real limit order on Arbitrum Sepolia. |
| Trading lifecycle | testnet | `tests/js/gmx-trading.testnet.test.mjs` | `test_fetch_order_after_create_testnet` | Verify `fetchOrder()` after creating a testnet order. |
| Trading lifecycle | testnet | `tests/js/gmx-trading.testnet.test.mjs` | `test_fetch_open_orders_after_create_testnet` | Verify `fetchOpenOrders()` reflects the created testnet order. |
| Trading lifecycle | testnet | `tests/js/gmx-trading.testnet.test.mjs` | `test_cancel_order_testnet` | Verify cancelling a created testnet order. |
| Trading lifecycle | testnet | `tests/js/gmx-trading.testnet.test.mjs` | `test_cancel_orders_batch_testnet` | Verify cancelling multiple testnet orders. |
| Trading lifecycle | testnet | `tests/js/gmx-trading.testnet.test.mjs` | `test_fetch_orders_and_my_trades_after_testnet_activity` | Verify order history and trade history after testnet activity. |
| Margin and leverage | testnet | `tests/js/gmx-margin.testnet.test.mjs` | `test_set_leverage_testnet` | Verify real leverage update on testnet. |
| Margin and leverage | testnet | `tests/js/gmx-margin.testnet.test.mjs` | `test_add_margin_testnet` | Verify adding collateral on testnet. |
| Margin and leverage | testnet | `tests/js/gmx-margin.testnet.test.mjs` | `test_reduce_margin_testnet` | Verify reducing collateral on testnet. |
| Lagoon wallet | fork | `tests/js/gmx-lagoon.fork.test.mjs` | `test_lagoon_wallet_fetch_balance_and_positions` | Verify Lagoon wallet read paths on fork through the bridge. |
| Lagoon wallet | fork | `tests/js/gmx-lagoon.fork.test.mjs` | `test_lagoon_wallet_builds_order_requests` | Verify order requests can be constructed for a Lagoon-configured bridge on fork. |
| Lagoon wallet | testnet | `tests/js/gmx-lagoon.testnet.test.mjs` | `test_lagoon_wallet_create_and_cancel_order` | Verify a real Lagoon wallet order lifecycle on testnet. |
| Lagoon wallet | testnet | `tests/js/gmx-lagoon.testnet.test.mjs` | `test_lagoon_wallet_fetch_orders_positions_and_trades` | Verify post-trade reads for Lagoon wallet operation on testnet. |

## Acceptance notes

- `live` tests must never place trades
- `fork` tests must not require successful GMX keeper execution
- `testnet` is the place for real trade lifecycle coverage
- unsupported CCXT methods must be tested explicitly so the remote adapter stays parity-compatible with the Python implementation
- every new bridge-exposed CCXT method should add at least one JavaScript client test entry to this document
