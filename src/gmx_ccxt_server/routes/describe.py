"""`GET /describe` endpoint.

This route exposes bridge metadata together with the underlying Python GMX
exchange `describe()` result. It is mainly a diagnostics and capability
inspection endpoint for clients and tests.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from gmx_ccxt_server.routes.auth import require_auth
from gmx_ccxt_server.serialization import serialize_for_json

router = APIRouter()


@router.get("/describe")
async def describe(
    request: Request,
    _: None = Depends(require_auth),
) -> dict[str, Any]:
    """Return bridge metadata and the JSON-safe GMX exchange description.

    The runtime already knows how to fetch and compose the description payload.
    The route's job is to authenticate the caller and normalize the response.
    """

    runtime = request.app.state.runtime
    return serialize_for_json(await runtime.describe_payload())
