"""`GET /ping` endpoint.

This route is intentionally small and side-effect free. It exists to answer
two operational questions quickly:

1. Is the FastAPI process alive and reachable?
2. Did the bridge bootstrap the GMX runtime with the expected high-level
   settings, without leaking secrets such as private keys?
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ..serialization import serialize_for_json
from .auth import require_auth

router = APIRouter()


@router.get("/ping")
async def ping(
    request: Request,
    _: None = Depends(require_auth),
) -> dict[str, Any]:
    """Return a liveness payload plus a non-secret runtime summary.

    We serialize the runtime payload before returning so values such as Decimals
    or other Python-native objects never leak through as non-JSON responses.
    """

    runtime = request.app.state.runtime
    return serialize_for_json(await runtime.health_payload())
