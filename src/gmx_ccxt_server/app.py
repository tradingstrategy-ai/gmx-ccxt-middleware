from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from .runtime import BridgeRuntime
from .serialization import serialize_exception, serialize_for_json


class CallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | int | None = None
    method: str
    args: list[Any] = Field(default_factory=list)
    kwargs: dict[str, Any] = Field(default_factory=dict)


def create_app(runtime: BridgeRuntime) -> FastAPI:
    app = FastAPI(title="GMX CCXT Bridge", version="0.1.0")
    app.state.runtime = runtime

    async def require_auth(authorization: str | None = Header(default=None)) -> None:
        token = runtime.config.server.auth_token
        if not token:
            return
        expected = f"Bearer {token}"
        if authorization != expected:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    @app.get("/healthz")
    async def healthz(_: None = Depends(require_auth)) -> dict[str, Any]:
        return serialize_for_json(await runtime.health_payload())

    @app.get("/describe")
    async def describe(_: None = Depends(require_auth)) -> dict[str, Any]:
        return serialize_for_json(await runtime.describe_payload())

    @app.post("/call")
    async def call(request: CallRequest, _: None = Depends(require_auth)) -> dict[str, Any]:
        try:
            result = await runtime.call(request.method, request.args, request.kwargs)
            return {
                "id": request.id,
                "ok": True,
                "result": serialize_for_json(result),
            }
        except Exception as exc:  # pragma: no cover - exercised in integration tests
            return {
                "id": request.id,
                "ok": False,
                "error": serialize_exception(exc),
            }

    return app
