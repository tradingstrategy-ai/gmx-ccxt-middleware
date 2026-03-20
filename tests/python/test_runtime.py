"""Bridge runtime tests covering auth, method dispatch, and JSON-safe serialisation."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import asyncio

import pytest
from fastapi.testclient import TestClient

from gmx_ccxt_server.app import create_app
from gmx_ccxt_server.config import AppConfig, GmxSettings, ServerSettings
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
    response = client.get("/healthz")
    assert response.status_code == 401
