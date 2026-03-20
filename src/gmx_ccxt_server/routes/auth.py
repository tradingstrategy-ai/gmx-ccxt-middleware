"""Shared authentication helpers for bridge routes.

The bridge keeps auth intentionally small: if no bearer token is configured
we allow all requests, and if a token is configured every route must present
the exact `Authorization: Bearer ...` header value.
"""

from __future__ import annotations

from fastapi import Header, HTTPException, Request, status


async def require_auth(
    request: Request,
    authorization: str | None = Header(default=None),
) -> None:
    """Guard a route with the bridge's optional bearer token.

    We read the runtime from `app.state` instead of rebuilding configuration
    here so every endpoint shares the same singleton runtime and auth source.
    """

    token = request.app.state.runtime.config.server.auth_token
    if not token:
        return

    expected = f"Bearer {token}"
    if authorization != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
