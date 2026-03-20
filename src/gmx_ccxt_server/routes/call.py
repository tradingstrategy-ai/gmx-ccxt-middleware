"""`POST /call` endpoint.

This is the bridge's RPC-style transport used by the generated CCXT adapter.
The route accepts a method name plus positional and keyword arguments, then
delegates execution to `BridgeRuntime`, which enforces the allow-list and
serializes access to the singleton Python GMX exchange instance.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request

from gmx_ccxt_server.routes.auth import require_auth
from gmx_ccxt_server.routes.models import CallRequest
from gmx_ccxt_server.serialization import serialize_exception, serialize_for_json

router = APIRouter()
logger = logging.getLogger(__name__)


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
    logger.info(
        "Bridge call request id=%s method=%s args=%s kwargs=%s",
        payload.id,
        payload.method,
        serialize_for_json(payload.args),
        serialize_for_json(payload.kwargs),
    )

    try:
        result = await runtime.call(payload.method, payload.args, payload.kwargs)
        serialized_result = serialize_for_json(result)
        response_payload = {
            "id": payload.id,
            "ok": True,
            "result": serialized_result,
        }
        logger.info(
            "Bridge call response id=%s method=%s ok=%s result=%s",
            payload.id,
            payload.method,
            True,
            serialized_result,
        )
        return response_payload
    except Exception as exc:  # pragma: no cover - exercised in integration tests
        logger.exception(
            "Bridge call failed id=%s method=%s args=%s kwargs=%s",
            payload.id,
            payload.method,
            serialize_for_json(payload.args),
            serialize_for_json(payload.kwargs),
        )
        return {
            "id": payload.id,
            "ok": False,
            "error": serialize_exception(exc),
        }
