from __future__ import annotations

import argparse
import asyncio
import logging

import uvicorn

from .app import create_app
from .runtime import BridgeRuntime


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the GMX CCXT FastAPI bridge")
    parser.add_argument("--config", required=True, help="Path to the TOML config file")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    runtime = asyncio.run(BridgeRuntime.from_config_path(args.config))
    logging.basicConfig(level=getattr(logging, runtime.config.server.log_level.upper(), logging.INFO))
    app = create_app(runtime)
    uvicorn.run(app, host=runtime.config.server.host, port=runtime.config.server.port, log_level=runtime.config.server.log_level)


if __name__ == "__main__":
    main()
