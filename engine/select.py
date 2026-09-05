from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, milp


class TargetInfeasible(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class MeanSelection:
    selected_indices: np.ndarray
    achieved_mean: float
    absolute_error: float
    exact_target: bool


def select_for_mean(
    source: pd.DataFrame,
    candidates: pd.DataFrame,
    *,
    target_column: str,
    final_count: int,
    target_mean: float,
    target_min: int,
    target_max: int,
) -> MeanSelection:
    source_count = len(source)
    if source_count == 0:
        raise TargetInfeasible("empty_source_scope", "SourceScope contains no responses")
    if final_count < source_count:
        raise TargetInfeasible(
            "final_count_below_source",
            f"Final response count {final_count} is below immutable source count {source_count}",
        )
    if not target_min <= target_mean <= target_max:
        raise TargetInfeasible(
            "mean_out_of_range",
            f"Requested mean {target_mean} is outside [{target_min}, {target_max}]",
        )

    source_scores = pd.to_numeric(source[target_column], errors="coerce")
    if source_scores.isna().any():
        raise TargetInfeasible(
            "mean_requires_answered_source",
            "M4 mean targets currently require the target ordinal question to be answered in every source row",
        )

    additions = final_count - source_count
    if additions == 0:
        achieved = float(source_scores.mean())
        error = abs(achieved - target_mean)
        return MeanSelection(
            selected_indices=np.array([], dtype=int),
            achieved_mean=achieved,
            absolute_error=error,
            exact_target=error <= 1e-9,
        )

    if len(candidates) < additions:
        raise TargetInfeasible(
            "candidate_support",
            f"Candidate pool contains {len(candidates)} rows but {additions} additions are required",
        )

    candidate_scores = pd.to_numeric(candidates[target_column], errors="coerce")
    if candidate_scores.isna().any():
        raise TargetInfeasible(
            "candidate_support",
            "Candidate pool contains unanswered or invalid target scores",
        )

    count = len(candidates)
    objective = np.zeros(count + 1, dtype=float)
    objective[-1] = 1.0

    integrality = np.zeros(count + 1, dtype=int)
    integrality[:count] = 1

    lower_bounds = np.zeros(count + 1, dtype=float)
    upper_bounds = np.ones(count + 1, dtype=float)
    upper_bounds[-1] = np.inf

    source_sum = float(source_scores.sum())
    base_residual = source_sum - target_mean * final_count
    scores = candidate_scores.to_numpy(dtype=float)

    matrix = np.zeros((3, count + 1), dtype=float)
    matrix[0, :count] = 1.0
    matrix[1, :count] = scores
    matrix[1, -1] = -1.0
    matrix[2, :count] = scores
    matrix[2, -1] = 1.0

    constraint = LinearConstraint(
        matrix,
        lb=np.array([additions, -np.inf, -base_residual], dtype=float),
        ub=np.array([additions, -base_residual, np.inf], dtype=float),
    )

    result = milp(
        c=objective,
        integrality=integrality,
        bounds=Bounds(lower_bounds, upper_bounds),
        constraints=constraint,
    )
    if not result.success or result.x is None:
        raise TargetInfeasible(
            "solver_infeasible",
            result.message or "SciPy MILP could not select a feasible candidate set",
        )

    selected = np.flatnonzero(result.x[:count] > 0.5)
    if len(selected) != additions:
        raise RuntimeError(
            f"MILP selected {len(selected)} rows but {additions} additions were required"
        )

    achieved = float((source_sum + float(scores[selected].sum())) / final_count)
    error = abs(achieved - target_mean)
    return MeanSelection(
        selected_indices=selected,
        achieved_mean=achieved,
        absolute_error=error,
        exact_target=error <= 1e-9,
    )
