from __future__ import annotations

from fastapi import FastAPI

from .runtime import BridgeRuntime
from .routes import call_router, describe_router, ping_router


def create_app(runtime: BridgeRuntime) -> FastAPI:
    """Create the FastAPI app and attach the singleton bridge runtime.

    The actual endpoint handlers live in dedicated route modules so each public
    HTTP surface can be documented and maintained independently.
    """

    app = FastAPI(title="GMX CCXT Bridge", version="0.1.0")
    app.state.runtime = runtime
    app.include_router(ping_router)
    app.include_router(describe_router)
    app.include_router(call_router)
    return app
