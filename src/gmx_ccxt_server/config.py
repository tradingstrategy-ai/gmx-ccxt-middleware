from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ServerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host: str = "127.0.0.1"
    port: int = 8000
    auth_token: str | None = None
    log_level: str = "info"

    @field_validator("auth_token", mode="before")
    @classmethod
    def normalize_token(cls, value: Any) -> str | None:
        if value in (None, ""):
            return None
        return str(value)


class GmxSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rpc_url: str
    private_key: str | None = None
    wallet_address: str | None = None
    chain_id: int | None = None
    subsquid_endpoint: str | None = None
    execution_buffer: float = 2.2
    default_slippage: float = 0.003
    verbose: bool = False
    preload_markets: bool = False
    options: dict[str, Any] = Field(default_factory=dict)

    @field_validator("private_key", "wallet_address", "subsquid_endpoint", mode="before")
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
            "options": self.options,
        }
        if self.private_key:
            payload["privateKey"] = self.private_key
        if self.chain_id is not None:
            payload["chainId"] = self.chain_id
        if self.subsquid_endpoint:
            payload["subsquidEndpoint"] = self.subsquid_endpoint
        return payload


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server: ServerSettings = Field(default_factory=ServerSettings)
    gmx: GmxSettings


def load_config(path: str | Path) -> AppConfig:
    with Path(path).expanduser().open("rb") as handle:
        raw = tomllib.load(handle)
    return AppConfig.model_validate(raw)
