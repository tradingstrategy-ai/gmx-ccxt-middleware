"""FastAPI route modules for the bridge HTTP surface.

Each public endpoint lives in its own module so the request contract,
authorization behavior, and runtime delegation stay easy to inspect.
"""

from gmx_ccxt_server.routes.call import router as call_router
from gmx_ccxt_server.routes.describe import router as describe_router
from gmx_ccxt_server.routes.ping import router as ping_router

__all__ = ["call_router", "describe_router", "ping_router"]
