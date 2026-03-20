from __future__ import annotations

import asyncio
import logging

import uvicorn

from gmx_ccxt_server.app import create_app
from gmx_ccxt_server.runtime import BridgeRuntime


def main() -> None:
    runtime = asyncio.run(BridgeRuntime.from_env())
    logging.basicConfig(level=getattr(logging, runtime.config.server.log_level.upper(), logging.INFO))
    app = create_app(runtime)
    uvicorn.run(app, host=runtime.config.server.host, port=runtime.config.server.port, log_level=runtime.config.server.log_level)


if __name__ == "__main__":
    main()
