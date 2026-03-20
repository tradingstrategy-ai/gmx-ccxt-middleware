from __future__ import annotations

import asyncio
import logging
from functools import partial
from importlib import import_module
from typing import Any

from eth_account import Account
from fastapi.concurrency import run_in_threadpool

from gmx_ccxt_server.config import AppConfig, load_config_from_env
from gmx_ccxt_server.serialization import serialize_for_json

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

SIGNING_REQUIRED_METHODS: frozenset[str] = frozenset(
    {
        "set_leverage",
        "add_margin",
        "reduce_margin",
        "create_order",
        "create_market_buy_order",
        "create_market_sell_order",
        "create_limit_order",
        "cancel_order",
        "cancel_orders",
    }
)

ACCOUNT_READ_METHODS: frozenset[str] = frozenset(
    {
        "fetch_balance",
        "fetch_open_orders",
        "fetch_my_trades",
        "fetch_positions",
        "fetch_order",
        "fetch_closed_orders",
        "fetch_orders",
    }
)

READ_ONLY_METHODS: frozenset[str] = frozenset(ALLOWED_METHODS.difference(SIGNING_REQUIRED_METHODS))

CHAIN_TO_GAS_TOKEN_SYMBOL: dict[str, str] = {
    "arbitrum": "ETH",
    "arbitrum_sepolia": "ETH",
    "avalanche": "AVAX",
    "avalanche_fuji": "AVAX",
}

logger = logging.getLogger(__name__)


class MethodNotAllowedError(ValueError):
    """Raised when the bridge receives a non-whitelisted exchange method."""


class PermissionDeniedError(ValueError):
    """Raised when a method is unavailable in the current wallet mode."""

    ccxt_error = "PermissionDenied"


class InsufficientFundsError(ValueError):
    """Raised when the configured signing wallet lacks gas balance."""

    ccxt_error = "InsufficientFunds"


class BridgeRuntime:
    """Async facade around the synchronous upstream Python GMX exchange.

    The FastAPI app is async, but the underlying GMX CCXT implementation is
    largely synchronous and performs blocking JSON-RPC, HTTP, and contract
    reads. To keep the event loop responsive, this runtime pushes those calls
    through :func:`fastapi.concurrency.run_in_threadpool` instead of executing
    them directly on the loop thread.

    The class therefore acts as a small coordination layer:

    - it exposes async methods to the FastAPI routes
    - it serialises access to the singleton exchange with ``asyncio.Lock``
    - it offloads blocking exchange and Web3 work to the thread pool

    This is intentionally a compatibility bridge, not a pure async rewrite of
    the upstream GMX client.
    """

    def __init__(self, config: AppConfig, exchange: Any):
        """Store the singleton GMX exchange instance and its loaded config.

        :param config:
            Parsed application configuration for the running process.
        :param exchange:
            Initialised Python GMX exchange instance exposed through the bridge.
        """

        self.config = config
        self.exchange = exchange
        self._lock = asyncio.Lock()

    @classmethod
    async def from_env(cls) -> BridgeRuntime:
        """Build a runtime directly from process environment variables."""

        config = load_config_from_env()
        return await cls.from_config(config)

    @classmethod
    async def from_config(cls, config: AppConfig) -> BridgeRuntime:
        """Create and warm the runtime from an already parsed config object.

        :param config:
            Parsed server and GMX settings.
        :return:
            Ready-to-serve runtime instance.

        The exchange constructor is also run in the thread pool because the
        upstream initialisation path may touch blocking RPC and config logic.
        """

        cls._validate_private_key(config)
        exchange = await run_in_threadpool(cls._create_exchange, config)
        runtime = cls(config, exchange)
        await runtime.log_hot_wallet_balance()
        await runtime.warn_if_zero_gas_balance()
        if config.gmx.preload_markets:
            await runtime.call("load_markets")
        return runtime

    @staticmethod
    def _validate_private_key(config: AppConfig) -> None:
        """Validate the configured private key before booting a signing runtime.

        :param config:
            Parsed application configuration.
        :raises ValueError:
            Raised if ``GMX_PRIVATE_KEY`` is present but malformed.
        """

        private_key = config.gmx.private_key
        if not private_key:
            return
        try:
            Account.from_key(private_key)
        except Exception as exc:  # pragma: no cover - exact upstream exception type may vary
            msg = (
                "GMX_PRIVATE_KEY is configured but is not a valid Ethereum private key. "
                "Fix GMX_PRIVATE_KEY or unset it to run the server in read-only mode."
            )
            raise ValueError(msg) from exc

    @staticmethod
    def _create_exchange(config: AppConfig) -> Any:
        """Instantiate the upstream Python GMX exchange for this runtime.

        In read-only mode we also attach the configured wallet address so
        account-scoped reads can target a specific address without signing.

        :param config:
            Parsed application configuration.
        :return:
            Initialised upstream GMX exchange instance.
        """

        exchange_class = import_module("eth_defi.gmx.ccxt.exchange").GMX
        exchange = exchange_class(config.gmx.to_exchange_parameters())
        if config.gmx.wallet_address and not config.gmx.private_key:
            exchange.wallet_address = config.gmx.wallet_address
            if getattr(exchange, "config", None) is not None and hasattr(exchange.config, "_user_wallet_address"):
                exchange.config._user_wallet_address = config.gmx.wallet_address
        return exchange

    async def call(self, method: str, args: list[Any] | None = None, kwargs: dict[str, Any] | None = None) -> Any:
        """Dispatch a whitelisted GMX method through the singleton exchange.

        This is the central bridge execution path. It enforces method
        whitelisting, read-only restrictions, gas checks for signing calls, and
        serialised access to the shared exchange instance. The actual exchange
        call is executed in the thread pool because the upstream CCXT/GMX
        methods are synchronous and may block on network I/O.

        :param method:
            Whitelisted snake_case exchange method name.
        :param args:
            Positional arguments passed to the exchange method.
        :param kwargs:
            Keyword arguments passed to the exchange method.
        :return:
            Raw exchange result, with ``fetch_status`` augmented for bridge
            diagnostics.
        """

        if method not in ALLOWED_METHODS:
            raise MethodNotAllowedError(f"Method '{method}' is not allowed by the bridge")
        self._ensure_method_allowed_for_mode(method)
        if method in SIGNING_REQUIRED_METHODS:
            await self._ensure_signing_wallet_has_gas(method)
        callable_obj = getattr(self.exchange, method, None)
        if not callable(callable_obj):
            raise AttributeError(f"Exchange method '{method}' does not exist")
        args = args or []
        kwargs = kwargs or {}
        async with self._lock:
            result = await run_in_threadpool(partial(callable_obj, *args, **kwargs))
        if method == "fetch_status":
            return await self._augment_fetch_status_result(result)
        return result

    def _is_read_only_mode(self) -> bool:
        """Return ``True`` when the server has no signing private key configured."""

        return not bool(self.config.gmx.private_key)

    def _signing_wallet_address(self) -> str | None:
        """Read the active signing wallet address from the upstream exchange."""

        return getattr(getattr(self.exchange, "wallet", None), "address", None)

    def _wallet_address(self) -> str | None:
        """Resolve the effective account address for the current runtime mode.

        In read-only mode this comes from ``GMX_WALLET_ADDRESS``. In signing
        mode it comes from the instantiated wallet attached to the exchange.
        """

        if self._is_read_only_mode():
            return self.config.gmx.wallet_address
        return self._signing_wallet_address()

    async def _chain_name(self) -> str | None:
        """Resolve the connected chain name from the upstream GMX config.

        ``config.get_chain()`` is routed through the thread pool for
        consistency with the rest of the synchronous upstream surface.
        """

        config = getattr(self.exchange, "config", None)
        if config is None or not hasattr(config, "get_chain"):
            return None
        return await run_in_threadpool(config.get_chain)

    async def _chain_id(self) -> int | None:
        """Resolve the connected EVM chain id from the upstream Web3 client.

        Even this small Web3 property access is treated as blocking because it
        may perform provider work depending on the upstream configuration.
        """

        web3 = getattr(self.exchange, "web3", None)
        if web3 is None:
            return None
        return await run_in_threadpool(lambda: web3.eth.chain_id)

    def _ensure_method_allowed_for_mode(self, method: str) -> None:
        """Reject methods that are incompatible with the current wallet mode.

        :param method:
            Exchange method about to be dispatched.
        :raises PermissionDeniedError:
            Raised when a signing method is called in read-only mode, or when
            an account-scoped read lacks any configured wallet context.
        """

        if self._is_read_only_mode():
            if method in SIGNING_REQUIRED_METHODS:
                msg = (
                    f"Method '{method}' is not available because the GMX CCXT Middleware Server is running in read-only mode. "
                    "GMX_PRIVATE_KEY is not configured, so signing-only calls are disabled. "
                    "Configure GMX_PRIVATE_KEY with a valid Ethereum private key and restart the server to enable trading and margin-management methods."
                )
                raise PermissionDeniedError(msg)
            if method in ACCOUNT_READ_METHODS and not self._wallet_address():
                msg = (
                    f"Method '{method}' needs an account context, but the GMX CCXT Middleware Server is running in read-only mode without GMX_WALLET_ADDRESS. "
                    "Configure GMX_WALLET_ADDRESS for account reads or GMX_PRIVATE_KEY for signing access, then restart the server."
                )
                raise PermissionDeniedError(msg)

    async def _gas_balance_wei(self) -> int | None:
        """Fetch the native gas balance for the resolved runtime wallet, if any.

        :return:
            Wallet balance in wei, or ``None`` when no runtime wallet or Web3
            provider is available.

        ``fetch_status`` should reflect the current account context even in
        read-only mode, so this helper uses the resolved wallet address rather
        than limiting itself to signing wallets. Startup warnings and signing
        call checks still decide separately whether gas is required.

        The balance lookup is pushed to the thread pool because it ultimately
        performs a synchronous Web3 RPC call.
        """

        wallet_address = self._wallet_address()
        web3 = getattr(self.exchange, "web3", None)
        if not wallet_address or web3 is None:
            return None
        return await run_in_threadpool(web3.eth.get_balance, wallet_address)

    async def _gas_status_info(self) -> dict[str, Any]:
        """Build native gas token diagnostics for status-style payloads."""

        chain_name, balance_wei = await asyncio.gather(self._chain_name(), self._gas_balance_wei())
        gas_token_symbol = CHAIN_TO_GAS_TOKEN_SYMBOL.get(chain_name or "")
        gas_token_balance = None
        if balance_wei is not None:
            gas_token_balance = balance_wei / 10**18
        return {
            "gasTokenSymbol": gas_token_symbol,
            "gasTokenBalance": gas_token_balance,
            "gasTokenBalanceWei": str(balance_wei) if balance_wei is not None else None,
        }

    async def log_hot_wallet_balance(self) -> None:
        """Log the configured signing wallet native gas balance at startup."""

        if self._is_read_only_mode():
            return

        wallet_address = self._signing_wallet_address()
        if not wallet_address:
            return

        chain_name, balance_wei = await asyncio.gather(self._chain_name(), self._gas_balance_wei())
        if balance_wei is None:
            return

        gas_token_symbol = CHAIN_TO_GAS_TOKEN_SYMBOL.get(chain_name or "") or "native gas token"
        logger.info(
            "Hot wallet %s balance: %.6f %s (%s wei)",
            wallet_address,
            balance_wei / 10**18,
            gas_token_symbol,
            balance_wei,
        )

    async def _ensure_signing_wallet_has_gas(self, method: str) -> None:
        """Fail early when a signing call is attempted with zero native gas.

        :param method:
            Signing-capable exchange method about to run.
        :raises InsufficientFundsError:
            Raised when the signing wallet balance is zero.
        """

        balance_wei = await self._gas_balance_wei()
        if balance_wei == 0:
            wallet_address = self._wallet_address()
            msg = (
                f"Method '{method}' requires native gas, but the configured signing wallet {wallet_address} has zero gas balance. "
                "Fund the account on the configured network and retry."
            )
            raise InsufficientFundsError(msg)

    async def warn_if_zero_gas_balance(self) -> None:
        """Log a startup warning when the signing wallet has no native gas."""

        balance_wei = await self._gas_balance_wei()
        if balance_wei == 0:
            logger.warning(
                "Configured signing wallet %s has zero native gas balance. Trading calls will fail until the account is funded.",
                self._wallet_address(),
            )

    async def _augment_fetch_status_result(self, result: Any) -> Any:
        """Merge bridge-specific diagnostics into ``fetch_status`` output.

        :param result:
            Raw upstream ``fetch_status`` payload.
        :return:
            Status payload with ``info.walletAddress`` appended when possible.
        """

        if not isinstance(result, dict):
            return result
        chain_name, chain_id, gas_status_info = await asyncio.gather(
            self._chain_name(),
            self._chain_id(),
            self._gas_status_info(),
        )
        info = result.get("info")
        if not isinstance(info, dict):
            info = {}
        return {
            **result,
            "info": {
                **info,
                "walletAddress": self._wallet_address(),
                "chain": chain_name,
                "chainId": chain_id,
                **gas_status_info,
            },
        }

    async def health_payload(self) -> dict[str, Any]:
        """Build the lightweight runtime metadata returned by ``GET /ping``."""

        chain_name, chain_id = await asyncio.gather(self._chain_name(), self._chain_id())
        return {
            "status": "ok",
            "exchange": "gmx",
            "chain": chain_name,
            "chainId": chain_id,
            "readOnlyMode": self._is_read_only_mode(),
            "walletConfigured": bool(getattr(self.exchange, "wallet", None) or self.config.gmx.wallet_address),
            "walletAddress": self._wallet_address(),
            "preloadMarkets": self.config.gmx.preload_markets,
            "allowedMethods": len(ALLOWED_METHODS),
        }

    async def describe_payload(self) -> dict[str, Any]:
        """Build the bridge metadata envelope returned by ``GET /describe``."""

        description = await self.call("describe")
        return {
            "bridge": {
                "exchange": "gmx",
                "allowedMethods": sorted(ALLOWED_METHODS),
                "readOnlyMethods": sorted(READ_ONLY_METHODS),
            },
            "exchange": serialize_for_json(description),
        }
