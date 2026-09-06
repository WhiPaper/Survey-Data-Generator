from __future__ import annotations

import json


_ELIGIBLE_STATES = {"answered", "skipped"}
_KNOWN_STATES = _ELIGIBLE_STATES | {"not_reached", "indeterminate"}


def answer_cell_eligible(value: object) -> bool:
    if not isinstance(value, str):
        return True
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return True
    if not isinstance(parsed, dict):
        return True
    state = parsed.get("state")
    return state in _ELIGIBLE_STATES if state in _KNOWN_STATES else True
