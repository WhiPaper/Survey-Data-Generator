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
class MeanSupportPlan:
    score_counts: dict[int, int]
    achieved_mean: float
    absolute_error: float


@dataclass(frozen=True)
class MeanSelection:
    selected_indices: np.ndarray
    achieved_mean: float
    absolute_error: float
    exact_target: bool


def _source_scores(source: pd.DataFrame, target_column: str) -> pd.Series:
    scores = pd.to_numeric(source[target_column], errors="coerce")
    if scores.isna().any():
        raise TargetInfeasible(
            "mean_requires_answered_source",
            "M4 mean targets currently require the target ordinal question to be answered in every source row",
        )
    return scores


def plan_mean_support(
    source: pd.DataFrame,
    *,
    target_column: str,
    final_count: int,
    target_mean: float,
    target_min: int,
    target_max: int,
) -> MeanSupportPlan:
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

    source_scores = _source_scores(source, target_column)
    additions = final_count - source_count
    source_sum = float(source_scores.sum())
    if additions == 0:
        achieved = source_sum / final_count
        return MeanSupportPlan(
            score_counts={},
            achieved_mean=achieved,
            absolute_error=abs(achieved - target_mean),
        )

    desired_synthetic_sum = target_mean * final_count - source_sum
    minimum_sum = additions * target_min
    maximum_sum = additions * target_max
    nearest_integer_sum = int(np.floor(desired_synthetic_sum + 0.5))
    synthetic_sum = min(max(nearest_integer_sum, minimum_sum), maximum_sum)

    low_score = synthetic_sum // additions
    remainder = synthetic_sum - low_score * additions
    score_counts: dict[int, int] = {}
    if additions - remainder > 0:
        score_counts[int(low_score)] = int(additions - remainder)
    if remainder > 0:
        score_counts[int(low_score + 1)] = int(remainder)

    achieved = (source_sum + synthetic_sum) / final_count
    return MeanSupportPlan(
        score_counts=score_counts,
        achieved_mean=float(achieved),
        absolute_error=abs(float(achieved) - target_mean),
    )


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
    support = plan_mean_support(
        source,
        target_column=target_column,
        final_count=final_count,
        target_mean=target_mean,
        target_min=target_min,
        target_max=target_max,
    )
    source_scores = _source_scores(source, target_column)

    additions = final_count - source_count
    if additions == 0:
        return MeanSelection(
            selected_indices=np.array([], dtype=int),
            achieved_mean=support.achieved_mean,
            absolute_error=support.absolute_error,
            exact_target=support.absolute_error <= 1e-9,
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
    if error > support.absolute_error + 1e-9:
        raise TargetInfeasible(
            "candidate_target_support",
            (
                f"Candidate pool can only reach mean {achieved:.6f}, but the ordinal score domain "
                f"can reach {support.achieved_mean:.6f} for this immutable source"
            ),
        )

    return MeanSelection(
        selected_indices=selected,
        achieved_mean=achieved,
        absolute_error=error,
        exact_target=error <= 1e-9,
    )
