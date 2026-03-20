from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


DEFAULT_GMX_RPC_URL = "https://arb1.arbitrum.io/rpc"
DEFAULT_EXECUTION_BUFFER = 2.2
DEFAULT_SLIPPAGE = 0.003


class ServerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    address: str = "127.0.0.1:8000"
    auth_token: str | None = None
    log_level: str = "info"

    @field_validator("address", mode="before")
    @classmethod
    def normalize_address(cls, value: Any) -> str:
        if value in (None, ""):
            return "127.0.0.1:8000"
        address = str(value).strip()
        if ":" not in address:
            raise ValueError("GMX_SERVER_ADDRESS must be in 'host:port' format")
        host, port_text = address.rsplit(":", 1)
        if not host:
            raise ValueError("GMX_SERVER_ADDRESS host must not be empty")
        try:
            port = int(port_text)
        except ValueError as exc:
            raise ValueError("GMX_SERVER_ADDRESS port must be an integer") from exc
        if not (1 <= port <= 65535):
            raise ValueError("GMX_SERVER_ADDRESS port must be between 1 and 65535")
        return f"{host}:{port}"

    @field_validator("auth_token", mode="before")
    @classmethod
    def normalize_token(cls, value: Any) -> str | None:
        if value in (None, ""):
            return None
        return str(value)

    @property
    def host(self) -> str:
        return self.address.rsplit(":", 1)[0]

    @property
    def port(self) -> int:
        return int(self.address.rsplit(":", 1)[1])


class GmxSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rpc_url: str
    private_key: str | None = None
    wallet_address: str | None = None
    chain_id: int | None = None
    subsquid_endpoint: str | None = None
    execution_buffer: float = DEFAULT_EXECUTION_BUFFER
    default_slippage: float = DEFAULT_SLIPPAGE
    verbose: bool = False
    preload_markets: bool = False
    rest_api_mode: bool = True
    graphql_only: bool = False
    disable_market_cache: bool = False
    vault_address: str | None = None

    @field_validator("private_key", "wallet_address", "subsquid_endpoint", "vault_address", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value: Any) -> str | None:
        if value in (None, ""):
            return None
        return str(value)

    def to_exchange_parameters(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "rpcUrl": self.rpc_url,
            "executionBuffer": self.execution_buffer,
            "defaultSlippage": self.default_slippage,
            "verbose": self.verbose,
            "options": {
                "rest_api_mode": self.rest_api_mode,
                "graphql_only": self.graphql_only,
                "disable_market_cache": self.disable_market_cache,
            },
        }
        if self.private_key:
            payload["privateKey"] = self.private_key
        if self.chain_id is not None:
            payload["chainId"] = self.chain_id
        if self.subsquid_endpoint:
            payload["subsquidEndpoint"] = self.subsquid_endpoint
        if self.vault_address:
            payload["options"]["vaultAddress"] = self.vault_address
        return payload


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server: ServerSettings = Field(default_factory=ServerSettings)
    gmx: GmxSettings


def _optional_env(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key)
    if value is None:
        return None
    value = value.strip()
    return value or None


def load_config_from_env(env: Mapping[str, str] | None = None) -> AppConfig:
    env = env or os.environ
    server = ServerSettings(
        address=env.get("GMX_SERVER_ADDRESS", "127.0.0.1:8000"),
        auth_token=_optional_env(env, "GMX_AUTH_TOKEN"),
        log_level=env.get("GMX_LOG_LEVEL", "info"),
    )
    gmx = GmxSettings(
        rpc_url=_optional_env(env, "GMX_RPC_URL") or DEFAULT_GMX_RPC_URL,
        private_key=_optional_env(env, "GMX_PRIVATE_KEY"),
        wallet_address=_optional_env(env, "GMX_WALLET_ADDRESS"),
        chain_id=_optional_env(env, "GMX_CHAIN_ID"),
        subsquid_endpoint=_optional_env(env, "GMX_SUBSQUID_ENDPOINT"),
        execution_buffer=env.get("GMX_EXECUTION_BUFFER", DEFAULT_EXECUTION_BUFFER),
        default_slippage=env.get("GMX_DEFAULT_SLIPPAGE", DEFAULT_SLIPPAGE),
        verbose=env.get("GMX_VERBOSE", False),
        preload_markets=env.get("GMX_PRELOAD_MARKETS", False),
        rest_api_mode=env.get("GMX_REST_API_MODE", True),
        graphql_only=env.get("GMX_GRAPHQL_ONLY", False),
        disable_market_cache=env.get("GMX_DISABLE_MARKET_CACHE", False),
        vault_address=_optional_env(env, "GMX_VAULT_ADDRESS"),
    )
    return AppConfig(server=server, gmx=gmx)
