from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from candidate_selection import _routing_filtered_candidates
from replacement_base import *  # noqa: F403
from replacement_base import plan_replacements as _plan_replacements


def _map_indices(indices: np.ndarray, original_indices: np.ndarray) -> np.ndarray:
    return np.asarray([int(original_indices[index]) for index in indices], dtype=int)


def plan_replacements(source: pd.DataFrame, candidates: pd.DataFrame, *args: object, **kwargs: object):
    filtered, original_indices = _routing_filtered_candidates(source, candidates)
    append_only_supplied = kwargs.get("append_only_outcome") is not None
    plan = _plan_replacements(source, filtered, *args, **kwargs)

    if plan.status != "available":
        additions = (
            plan.addition_candidate_indices
            if append_only_supplied
            else _map_indices(plan.addition_candidate_indices, original_indices)
        )
        return replace(plan, addition_candidate_indices=additions)

    proposed = tuple(
        replace(pair, candidate_index=int(original_indices[pair.candidate_index]))
        for pair in plan.proposed_replacements
    )
    additions = _map_indices(plan.addition_candidate_indices, original_indices)
    replacement_outcome = plan.replacement_outcome
    if replacement_outcome is not None:
        replacement_outcome = replace(
            replacement_outcome,
            selected_indices=_map_indices(replacement_outcome.selected_indices, original_indices),
        )

    return replace(
        plan,
        proposed_replacements=proposed,
        addition_candidate_indices=additions,
        replacement_outcome=replacement_outcome,
    )
