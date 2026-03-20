"""FastAPI route modules for the bridge HTTP surface.

Each public endpoint lives in its own module so the request contract,
authorization behavior, and runtime delegation stay easy to inspect.
"""

from .call import router as call_router
from .describe import router as describe_router
from .ping import router as ping_router

__all__ = ["call_router", "describe_router", "ping_router"]
