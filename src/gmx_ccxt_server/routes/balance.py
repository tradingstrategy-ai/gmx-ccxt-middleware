"""`GET /balance` endpoint.

This route provides a tiny convenience view over `fetch_balance()` for the
most operationally important wallet checks: native ETH for gas and USDC for
GMX collateral.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ..serialization import serialize_for_json
from .auth import require_auth

router = APIRouter()


@router.get("/balance")
async def balance(
    request: Request,
    _: None = Depends(require_auth),
) -> dict[str, Any]:
    """Return the configured wallet address plus ETH and USDC balances."""

    runtime = request.app.state.runtime
    return serialize_for_json(await runtime.balance_payload())
