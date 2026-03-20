"""Logging helpers for the GMX CCXT middleware server."""

from __future__ import annotations

import logging

from rich.logging import RichHandler

logger = logging.getLogger(__name__)


def configure_logging(log_level: str) -> None:
    """Install Rich-based root logging.

    :param log_level:
        Configured server log level from :class:`gmx_ccxt_server.config.ServerSettings`.
    """

    level = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            RichHandler(
                rich_tracebacks=True,
                show_path=False,
            )
        ],
        force=True,
    )
