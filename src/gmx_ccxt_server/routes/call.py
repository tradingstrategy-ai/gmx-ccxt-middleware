"""`POST /call` endpoint.

This is the bridge's RPC-style transport used by the generated CCXT adapter.
The route accepts a method name plus positional and keyword arguments, then
delegates execution to `BridgeRuntime`, which enforces the allow-list and
serializes access to the singleton Python GMX exchange instance.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ..serialization import serialize_exception, serialize_for_json
from .auth import require_auth
from .models import CallRequest

router = APIRouter()


@router.post("/call")
async def call(
    request: Request,
    payload: CallRequest,
    _: None = Depends(require_auth),
) -> dict[str, Any]:
    """Dispatch a whitelisted exchange call and return a JSON-safe envelope.

    Success responses always return `ok: true` and a serialized `result`.
    Failures are also normalized into JSON so remote CCXT clients can map the
    error back into the correct exchange exception type.
    """

    runtime = request.app.state.runtime

    try:
        result = await runtime.call(payload.method, payload.args, payload.kwargs)
        return {
            "id": payload.id,
            "ok": True,
            "result": serialize_for_json(result),
        }
    except Exception as exc:  # pragma: no cover - exercised in integration tests
        return {
            "id": payload.id,
            "ok": False,
            "error": serialize_exception(exc),
        }
