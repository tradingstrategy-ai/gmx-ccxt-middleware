from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

try:
    from hexbytes import HexBytes
except ImportError:  # pragma: no cover - optional import during static analysis
    HexBytes = bytes  # type: ignore[assignment]


def serialize_for_json(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, type):
        return value.__name__
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, HexBytes)):
        return "0x" + bytes(value).hex()
    if is_dataclass(value):
        return serialize_for_json(asdict(value))
    if hasattr(value, "model_dump"):
        return serialize_for_json(value.model_dump())
    if isinstance(value, dict):
        return {str(key): serialize_for_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [serialize_for_json(item) for item in value]
    if hasattr(value, "__dict__"):
        return serialize_for_json(vars(value))
    return str(value)


def serialize_exception(exc: Exception) -> dict[str, Any]:
    return {
        "type": exc.__class__.__name__,
        "message": str(exc),
        "ccxt_error": exc.__class__.__name__,
        "details": {
            "args": [serialize_for_json(arg) for arg in getattr(exc, "args", ())],
        },
    }
