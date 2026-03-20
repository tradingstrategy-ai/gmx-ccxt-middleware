"""Pydantic models shared by bridge route handlers."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CallRequest(BaseModel):
    """Request body for the bridge RPC endpoint.

    The shape mirrors the language-neutral contract used by the TypeScript
    adapter. We forbid extra keys so client mistakes fail early and predictably.
    """

    model_config = ConfigDict(extra="forbid")

    id: str | int | None = None
    method: str
    args: list[Any] = Field(default_factory=list)
    kwargs: dict[str, Any] = Field(default_factory=dict)
