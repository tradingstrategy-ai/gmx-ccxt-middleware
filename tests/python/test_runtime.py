"""Bridge runtime tests covering auth, method dispatch, and JSON-safe serialisation."""

from __future__ import annotations

import asyncio
import logging
import sys
import types
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from rich.logging import RichHandler

from gmx_ccxt_server.app import create_app
from gmx_ccxt_server.config import DEFAULT_GMX_RPC_URL, AppConfig, GmxSettings, ServerSettings, load_config_from_env
from gmx_ccxt_server.logging_utils import configure_logging
from gmx_ccxt_server.runtime import BridgeRuntime, MethodNotAllowedError

HTTP_UNAUTHORIZED = 401
TEST_SERVER_PORT = 18_123
ARBITRUM_CHAIN_ID = 42_161
TEST_EXECUTION_BUFFER = 3.5
TEST_DEFAULT_SLIPPAGE = 0.01
HTTP_OK = 200


class FakeExchange:
    def __init__(self):
        self.wallet = None
        self.config = types.SimpleNamespace(get_chain=lambda: "arbitrum")
        self.web3 = types.SimpleNamespace(
            eth=types.SimpleNamespace(
                chain_id=ARBITRUM_CHAIN_ID,
                get_balance=lambda _address: 2_500_000_000_000_000,
            )
        )

    @staticmethod
    def describe():
        return {"id": "gmx", "name": "GMX"}

    @staticmethod
    def fetch_ticker(symbol: str):
        return {
            "symbol": symbol,
            "price": Decimal("1234.50"),
            "timestamp": datetime(2025, 1, 1, tzinfo=timezone.utc),
            "blob": b"\x01\x02",
        }

    @staticmethod
    def fetch_status():
        return {
            "status": "ok",
            "updated": 1_742_718_400_000,
            "datetime": "2025-03-20T00:00:00+00:00",
            "eta": None,
            "url": None,
            "info": {"web3": "ok"},
        }

    @staticmethod
    def create_order(*_args, **_kwargs):
        return {"status": "should-not-run"}

    @staticmethod
    def fetch_balance():
        msg = "boom"
        raise ValueError(msg)


@pytest.fixture()
def runtime() -> BridgeRuntime:
    config = AppConfig(
        server=ServerSettings(auth_token="secret-token"),
        gmx=GmxSettings(rpc_url="http://localhost:8545", wallet_address="0xread-only"),
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
    assert response.status_code == HTTP_UNAUTHORIZED


def test_app_logs_requests_and_responses(runtime: BridgeRuntime, caplog: pytest.LogCaptureFixture):
    app = create_app(runtime)
    client = TestClient(app)

    with caplog.at_level("INFO", logger="gmx_ccxt_server.routes.call"):
        response = client.post(
            "/call",
            headers={"Authorization": "Bearer secret-token"},
            json={"id": "1", "method": "fetch_ticker", "args": ["ETH/USDC:USDC"]},
        )

    assert response.status_code == HTTP_OK
    assert "Bridge call request id=1 method=fetch_ticker" in caplog.text
    assert "args=['ETH/USDC:USDC']" in caplog.text
    assert "Bridge call response id=1 method=fetch_ticker ok=True" in caplog.text
    assert "symbol" in caplog.text


def test_app_logs_full_tracebacks(runtime: BridgeRuntime, caplog: pytest.LogCaptureFixture):
    app = create_app(runtime)
    client = TestClient(app)

    with caplog.at_level("INFO", logger="gmx_ccxt_server.routes.call"):
        response = client.post(
            "/call",
            headers={"Authorization": "Bearer secret-token"},
            json={"id": "2", "method": "fetch_balance"},
        )

    assert response.status_code == HTTP_OK
    assert response.json()["ok"] is False
    assert "Bridge call failed id=2 method=fetch_balance" in caplog.text
    assert "Traceback" in caplog.text
    assert "ValueError: boom" in caplog.text


def test_configure_logging_installs_rich_handler():
    configure_logging("info")

    assert any(isinstance(handler, RichHandler) for handler in logging.getLogger().handlers)


def test_load_config_from_env_parses_scalar_settings():
    config = load_config_from_env(
        {
            "GMX_RPC_URL": "https://arb1.arbitrum.io/rpc",
            "GMX_SERVER_ADDRESS": "127.0.0.1:18123",
            "GMX_SERVER_AUTH_TOKEN": "bridge-token",
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
    assert config.server.port == TEST_SERVER_PORT
    assert config.server.auth_token == "bridge-token"
    assert config.gmx.chain_id == ARBITRUM_CHAIN_ID
    assert config.gmx.execution_buffer == TEST_EXECUTION_BUFFER
    assert config.gmx.default_slippage == TEST_DEFAULT_SLIPPAGE
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


def test_runtime_fetch_status_adds_signing_wallet_address():
    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(
            rpc_url="http://localhost:8545",
            private_key="0xprivate",
            wallet_address="0xread-only",
        ),
    )
    exchange = FakeExchange()
    exchange.wallet = types.SimpleNamespace(address="0xsigning")
    runtime = BridgeRuntime(config, exchange)

    status = asyncio.run(runtime.call("fetch_status"))

    assert status["status"] == "ok"
    assert status["info"]["web3"] == "ok"
    assert status["info"]["chain"] == "arbitrum"
    assert status["info"]["chainId"] == ARBITRUM_CHAIN_ID
    assert status["info"]["gasTokenSymbol"] == "ETH"
    assert status["info"]["gasTokenBalance"] == pytest.approx(0.0025)
    assert status["info"]["gasTokenBalanceWei"] == "2500000000000000"
    assert status["info"]["walletAddress"] == "0xsigning"


def test_runtime_fetch_status_adds_read_only_wallet_address():
    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(rpc_url="http://localhost:8545", wallet_address="0xread-only"),
    )
    runtime = BridgeRuntime(config, FakeExchange())

    status = asyncio.run(runtime.call("fetch_status"))

    assert status["info"]["web3"] == "ok"
    assert status["info"]["chain"] == "arbitrum"
    assert status["info"]["chainId"] == ARBITRUM_CHAIN_ID
    assert status["info"]["gasTokenSymbol"] == "ETH"
    assert status["info"]["gasTokenBalance"] == pytest.approx(0.0025)
    assert status["info"]["gasTokenBalanceWei"] == "2500000000000000"
    assert status["info"]["walletAddress"] == "0xread-only"


def test_runtime_fetch_status_adds_null_wallet_address_when_unset():
    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(rpc_url="http://localhost:8545"),
    )
    runtime = BridgeRuntime(config, FakeExchange())

    status = asyncio.run(runtime.call("fetch_status"))

    assert status["info"]["web3"] == "ok"
    assert status["info"]["chain"] == "arbitrum"
    assert status["info"]["chainId"] == ARBITRUM_CHAIN_ID
    assert status["info"]["gasTokenSymbol"] == "ETH"
    assert status["info"]["gasTokenBalance"] is None
    assert status["info"]["gasTokenBalanceWei"] is None
    assert status["info"]["walletAddress"] is None


def test_runtime_read_only_mode_rejects_signing_methods_with_helpful_message():
    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(rpc_url="http://localhost:8545"),
    )
    runtime = BridgeRuntime(config, FakeExchange())

    with pytest.raises(Exception, match="read-only mode"):
        asyncio.run(runtime.call("create_order"))


def test_runtime_read_only_mode_requires_wallet_address_for_account_reads():
    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(rpc_url="http://localhost:8545"),
    )
    runtime = BridgeRuntime(config, FakeExchange())

    with pytest.raises(Exception, match="GMX_WALLET_ADDRESS"):
        asyncio.run(runtime.call("fetch_balance"))


def test_runtime_warns_when_signing_wallet_has_zero_gas_balance(caplog: pytest.LogCaptureFixture):
    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(rpc_url="http://localhost:8545", private_key="0xprivate"),
    )
    exchange = FakeExchange()
    exchange.wallet = types.SimpleNamespace(address="0xsigning")
    exchange.web3 = types.SimpleNamespace(eth=types.SimpleNamespace(get_balance=lambda _address: 0))
    runtime = BridgeRuntime(config, exchange)

    with caplog.at_level(logging.WARNING):
        asyncio.run(runtime.warn_if_zero_gas_balance())

    assert "zero native gas balance" in caplog.text
    assert "0xsigning" in caplog.text


def test_runtime_rejects_signing_methods_when_wallet_has_no_gas():
    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(rpc_url="http://localhost:8545", private_key="0xprivate"),
    )
    exchange = FakeExchange()
    exchange.wallet = types.SimpleNamespace(address="0xsigning")
    exchange.web3 = types.SimpleNamespace(eth=types.SimpleNamespace(get_balance=lambda _address: 0))
    runtime = BridgeRuntime(config, exchange)

    with pytest.raises(Exception, match="zero gas balance"):
        asyncio.run(runtime.call("create_order"))


def test_runtime_from_config_rejects_invalid_private_key():
    config = AppConfig(
        server=ServerSettings(),
        gmx=GmxSettings(rpc_url="http://localhost:8545", private_key="not-a-private-key"),
    )

    with pytest.raises(ValueError, match="not a valid Ethereum private key"):
        asyncio.run(BridgeRuntime.from_config(config))
