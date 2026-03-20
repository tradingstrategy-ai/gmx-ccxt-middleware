from __future__ import annotations

import asyncio
from functools import partial
from typing import Any

from fastapi.concurrency import run_in_threadpool

from .config import AppConfig, load_config_from_env
from .serialization import serialize_for_json

ALLOWED_METHODS: frozenset[str] = frozenset(
    {
        "describe",
        "load_markets",
        "fetch_markets",
        "fetch_market_leverage_tiers",
        "fetch_leverage_tiers",
        "fetch_ohlcv",
        "fetch_ticker",
        "fetch_tickers",
        "fetch_trades",
        "fetch_currencies",
        "fetch_time",
        "fetch_status",
        "fetch_open_interest",
        "fetch_open_interest_history",
        "fetch_open_interests",
        "fetch_funding_rate",
        "fetch_funding_rate_history",
        "fetch_funding_history",
        "fetch_apy",
        "fetch_balance",
        "fetch_open_orders",
        "fetch_my_trades",
        "fetch_positions",
        "set_leverage",
        "fetch_leverage",
        "add_margin",
        "reduce_margin",
        "create_order",
        "create_market_buy_order",
        "create_market_sell_order",
        "create_limit_order",
        "cancel_order",
        "cancel_orders",
        "fetch_order",
        "fetch_order_book",
        "fetch_closed_orders",
        "fetch_orders",
    }
)


class MethodNotAllowedError(ValueError):
    """Raised when the bridge receives a non-whitelisted exchange method."""


class BridgeRuntime:
    def __init__(self, config: AppConfig, exchange: Any):
        self.config = config
        self.exchange = exchange
        self._lock = asyncio.Lock()

    @classmethod
    async def from_env(cls) -> "BridgeRuntime":
        config = load_config_from_env()
        exchange = await run_in_threadpool(cls._create_exchange, config)
        runtime = cls(config, exchange)
        if config.gmx.preload_markets:
            await runtime.call("load_markets")
        return runtime

    @staticmethod
    def _create_exchange(config: AppConfig) -> Any:
        from eth_defi.gmx.ccxt.exchange import GMX

        exchange = GMX(config.gmx.to_exchange_parameters())
        if config.gmx.wallet_address and not config.gmx.private_key:
            exchange.wallet_address = config.gmx.wallet_address
            if getattr(exchange, "config", None) is not None and hasattr(exchange.config, "_user_wallet_address"):
                exchange.config._user_wallet_address = config.gmx.wallet_address
        return exchange

    async def call(self, method: str, args: list[Any] | None = None, kwargs: dict[str, Any] | None = None) -> Any:
        if method not in ALLOWED_METHODS:
            raise MethodNotAllowedError(f"Method '{method}' is not allowed by the bridge")
        callable_obj = getattr(self.exchange, method, None)
        if not callable(callable_obj):
            raise AttributeError(f"Exchange method '{method}' does not exist")
        args = args or []
        kwargs = kwargs or {}
        async with self._lock:
            return await run_in_threadpool(partial(callable_obj, *args, **kwargs))

    async def health_payload(self) -> dict[str, Any]:
        chain = None
        if getattr(self.exchange, "config", None) is not None and hasattr(self.exchange.config, "get_chain"):
            chain = await run_in_threadpool(self.exchange.config.get_chain)
        return {
            "status": "ok",
            "exchange": "gmx",
            "chain": chain,
            "walletConfigured": bool(getattr(self.exchange, "wallet", None) or self.config.gmx.wallet_address),
            "walletAddress": self.config.gmx.wallet_address or getattr(getattr(self.exchange, "wallet", None), "address", None),
            "preloadMarkets": self.config.gmx.preload_markets,
            "allowedMethods": len(ALLOWED_METHODS),
        }

    async def describe_payload(self) -> dict[str, Any]:
        description = await self.call("describe")
        return {
            "bridge": {
                "exchange": "gmx",
                "allowedMethods": sorted(ALLOWED_METHODS),
            },
            "exchange": serialize_for_json(description),
        }
