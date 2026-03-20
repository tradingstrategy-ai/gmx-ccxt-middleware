from __future__ import annotations

import asyncio

import uvicorn

from gmx_ccxt_server.app import create_app
from gmx_ccxt_server.config import load_config_from_env
from gmx_ccxt_server.logging_utils import configure_logging
from gmx_ccxt_server.runtime import BridgeRuntime


def main() -> None:
    config = load_config_from_env()
    configure_logging(config.server.log_level)
    runtime = asyncio.run(BridgeRuntime.from_config(config))
    app = create_app(runtime)
    uvicorn.run(
        app,
        host=runtime.config.server.host,
        port=runtime.config.server.port,
        log_level=runtime.config.server.log_level,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
