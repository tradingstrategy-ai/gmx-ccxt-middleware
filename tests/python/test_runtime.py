"""Bridge runtime tests covering auth, method dispatch, and JSON-safe serialisation."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import asyncio
import sys
import types

import pytest
from fastapi.testclient import TestClient

from gmx_ccxt_server.app import create_app
from gmx_ccxt_server.config import AppConfig, DEFAULT_GMX_RPC_URL, GmxSettings, ServerSettings, load_config_from_env
from gmx_ccxt_server.runtime import BridgeRuntime, MethodNotAllowedError


class FakeExchange:
    def __init__(self):
        self.wallet = None
        self.config = None

    def describe(self):
        return {"id": "gmx", "name": "GMX"}

    def fetch_ticker(self, symbol: str):
        return {
            "symbol": symbol,
            "price": Decimal("1234.50"),
            "timestamp": datetime(2025, 1, 1, tzinfo=timezone.utc),
            "blob": b"\x01\x02",
        }


@pytest.fixture()
def runtime() -> BridgeRuntime:
    config = AppConfig(
        server=ServerSettings(auth_token="secret-token"),
        gmx=GmxSettings(rpc_url="http://localhost:8545"),
    )
    return BridgeRuntime(config, FakeExchange())


def test_runtime_rejects_unknown_methods(runtime: BridgeRuntime):
    with pytest.raises(MethodNotAllowedError):
        asyncio.run(runtime.call("not_supported"))


def test_app_serializes_results(runtime: BridgeRuntime):
    app = create_app(runtime)
    client = TestClient(app)
    response = client.post(
        "/call",
        headers={"Authorization": "Bearer secret-token"},
        json={"id": "1", "method": "fetch_ticker", "args": ["ETH/USDC:USDC"]},
    )
    payload = response.json()
    assert payload["ok"] is True
    assert payload["result"]["price"] == "1234.50"
    assert payload["result"]["blob"] == "0x0102"
    assert payload["result"]["timestamp"] == "2025-01-01T00:00:00+00:00"


def test_app_requires_auth(runtime: BridgeRuntime):
    app = create_app(runtime)
    client = TestClient(app)
    response = client.get("/ping")
    assert response.status_code == 401


def test_load_config_from_env_parses_scalar_settings():
    config = load_config_from_env(
        {
            "GMX_RPC_URL": "https://arb1.arbitrum.io/rpc",
            "GMX_SERVER_ADDRESS": "127.0.0.1:18123",
            "GMX_AUTH_TOKEN": "bridge-token",
            "GMX_CHAIN_ID": "42161",
            "GMX_EXECUTION_BUFFER": "3.5",
            "GMX_DEFAULT_SLIPPAGE": "0.01",
            "GMX_VERBOSE": "true",
            "GMX_PRELOAD_MARKETS": "true",
            "GMX_REST_API_MODE": "false",
            "GMX_GRAPHQL_ONLY": "true",
            "GMX_DISABLE_MARKET_CACHE": "true",
            "GMX_VAULT_ADDRESS": "0xvault",
        }
    )

    assert config.server.address == "127.0.0.1:18123"
    assert config.server.port == 18123
    assert config.server.auth_token == "bridge-token"
    assert config.gmx.chain_id == 42161
    assert config.gmx.execution_buffer == 3.5
    assert config.gmx.default_slippage == 0.01
    assert config.gmx.verbose is True
    assert config.gmx.preload_markets is True
    payload = config.gmx.to_exchange_parameters()
    assert payload["options"]["rest_api_mode"] is False
    assert payload["options"]["graphql_only"] is True
    assert payload["options"]["disable_market_cache"] is True
    assert payload["options"]["vaultAddress"] == "0xvault"


def test_load_config_from_env_uses_default_rpc_url():
    config = load_config_from_env({})

    assert config.gmx.rpc_url == DEFAULT_GMX_RPC_URL


def test_runtime_create_exchange_ignores_explicit_wallet_when_private_key_present(monkeypatch: pytest.MonkeyPatch):
    class FakeGMXWalletConfig:
        def __init__(self):
            self._user_wallet_address = None

    class FakeGMX:
        def __init__(self, params):
            self.params = params
            self.wallet_address = None
            self.config = FakeGMXWalletConfig()

    fake_module = types.ModuleType("exchange")
    fake_module.GMX = FakeGMX
    monkeypatch.setitem(sys.modules, "eth_defi.gmx.ccxt.exchange", fake_module)

    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(
            rpc_url="http://localhost:8545",
            private_key="0xprivate",
            wallet_address="0xread-only",
        ),
    )

    exchange = BridgeRuntime._create_exchange(config)

    assert exchange.params["privateKey"] == "0xprivate"
    assert exchange.wallet_address is None
    assert exchange.config._user_wallet_address is None


def test_runtime_create_exchange_uses_wallet_address_in_read_only_mode(monkeypatch: pytest.MonkeyPatch):
    class FakeGMXWalletConfig:
        def __init__(self):
            self._user_wallet_address = None

    class FakeGMX:
        def __init__(self, params):
            self.params = params
            self.wallet_address = None
            self.config = FakeGMXWalletConfig()

    fake_module = types.ModuleType("exchange")
    fake_module.GMX = FakeGMX
    monkeypatch.setitem(sys.modules, "eth_defi.gmx.ccxt.exchange", fake_module)

    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(
            rpc_url="http://localhost:8545",
            wallet_address="0xread-only",
        ),
    )

    exchange = BridgeRuntime._create_exchange(config)

    assert exchange.wallet_address == "0xread-only"
    assert exchange.config._user_wallet_address == "0xread-only"
