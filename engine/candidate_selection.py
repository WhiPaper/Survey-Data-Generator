from __future__ import annotations

import json
from dataclasses import replace

import numpy as np
import pandas as pd

from candidate_selection_base import *  # noqa: F403
from candidate_selection_base import (
    _conditional_group_key,
    _conditional_vectors,
    _count_membership,
    _mean_vectors,
    _membership,
    _share_vectors,
    select_for_targets as _select_for_targets,
)

ROUTING_RULES_COLUMN = "__confirmed_routing_rules"


def _answered_option(value: object, option_key: str) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return False
    if not isinstance(parsed, dict) or parsed.get("state") != "answered":
        return False
    answer = parsed.get("value")
    return (
        isinstance(answer, dict)
        and answer.get("kind") == "single_choice"
        and str(answer.get("optionKey")) == option_key
    )


def _answered_slot(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return False
    return isinstance(parsed, dict) and parsed.get("state") == "answered"


def _routing_filtered_candidates(
    source: pd.DataFrame,
    candidates: pd.DataFrame,
) -> tuple[pd.DataFrame, np.ndarray]:
    original_indices = np.arange(len(candidates), dtype=int)
    if ROUTING_RULES_COLUMN not in source.columns or source.empty or candidates.empty:
        return candidates, original_indices

    raw = source.iloc[0][ROUTING_RULES_COLUMN]
    if not isinstance(raw, str):
        raise ValueError("confirmed routing rules metadata must be a JSON string")
    try:
        rules = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("confirmed routing rules metadata is invalid JSON") from error
    if not isinstance(rules, list) or not rules:
        return candidates, original_indices

    invalid = np.zeros(len(candidates), dtype=bool)
    for rule in rules:
        if not isinstance(rule, dict):
            raise ValueError("confirmed routing rule must be an object")
        source_column = rule.get("sourceColumn")
        option_key = rule.get("optionKey")
        forbidden = rule.get("forbidden")
        if not isinstance(source_column, str) or not isinstance(option_key, str):
            raise ValueError("confirmed routing rule source is invalid")
        if not isinstance(forbidden, list):
            raise ValueError("confirmed routing rule forbidden columns are invalid")
        if source_column not in candidates.columns:
            raise ValueError(f"confirmed routing source column is missing: {source_column}")

        branch_matches = candidates[source_column].map(
            lambda value, key=option_key: _answered_option(value, key)
        ).to_numpy(dtype=bool)
        forbidden_answered = np.zeros(len(candidates), dtype=bool)
        for item in forbidden:
            if not isinstance(item, dict):
                raise ValueError("confirmed routing forbidden column is invalid")
            column = item.get("column")
            kind = item.get("kind")
            if not isinstance(column, str) or column not in candidates.columns:
                raise ValueError(f"confirmed routing forbidden column is missing: {column}")
            if kind == "ordinal":
                answered = pd.to_numeric(candidates[column], errors="coerce").notna().to_numpy(dtype=bool)
            elif kind == "answer_slot":
                answered = candidates[column].map(_answered_slot).to_numpy(dtype=bool)
            else:
                raise ValueError(f"confirmed routing forbidden column kind is invalid: {kind}")
            forbidden_answered |= answered
        invalid |= branch_matches & forbidden_answered

    if not invalid.any():
        return candidates, original_indices
    kept_indices = original_indices[~invalid]
    return candidates.iloc[kept_indices].reset_index(drop=True), kept_indices


def select_for_targets(source: pd.DataFrame, candidates: pd.DataFrame, *args: object, **kwargs: object):
    filtered, original_indices = _routing_filtered_candidates(source, candidates)
    selection = _select_for_targets(source, filtered, *args, **kwargs)
    mapped = original_indices[selection.selected_indices]
    return replace(selection, selected_indices=mapped)
