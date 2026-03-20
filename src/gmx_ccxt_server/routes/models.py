"""Pydantic models shared by bridge route handlers."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CallRequest(BaseModel):
    """Request body for the bridge RPC endpoint.

    The payload shape is intentionally tiny and language-neutral so the
    generated CCXT adapter can send the same envelope from JavaScript today
    and other runtimes later.

    This model is not trying to mirror the full CCXT request/response surface.
    Instead it is a thin transport wrapper around one exchange method call:

    - `id` lets the caller correlate the response with the outbound request
    - `method` names the whitelisted exchange function to invoke
    - `args` carries positional arguments in call order
    - `kwargs` carries optional named arguments and CCXT `params`

    We forbid extra keys so malformed client payloads fail early and
    predictably instead of being silently ignored by the bridge.
    """

    model_config = ConfigDict(extra="forbid")

    id: str | int | None = Field(
        default=None,
        description=(
            "Opaque client-supplied correlation id copied back to the response. "
            "Useful when a remote adapter wants to match replies to requests, "
            "but optional for simple fire-and-wait usage."
        ),
    )
    method: str = Field(
        description=(
            "Name of the exchange method to call, such as `fetch_ticker`, "
            "`fetch_balance`, or `create_order`. The bridge still validates "
            "this against its server-side allow-list before dispatch."
        ),
    )
    args: list[Any] = Field(
        default_factory=list,
        description=(
            "Positional arguments passed to the target method in order. For "
            "example, `fetch_ticker('ETH/USDC:USDC')` would send the symbol in "
            "this list."
        ),
    )
    kwargs: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Named arguments passed to the target method. This is where CCXT "
            "option bags and `params` objects usually land, such as leverage, "
            "slippage, `reduceOnly`, or GMX-specific order settings."
        ),
    )
