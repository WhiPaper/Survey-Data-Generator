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
class ShareTarget:
    id: str
    column: str
    member_values: frozenset[str]
    value: float


@dataclass(frozen=True)
class ShareAchievement:
    id: str
    value: float
    achieved_share: float
    absolute_error: float


@dataclass(frozen=True)
class TargetSelection:
    selected_indices: np.ndarray
    achieved_mean: float
    mean_absolute_error: float
    mean_exact: bool
    shares: tuple[ShareAchievement, ...]


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
            "Mean targets currently require the target ordinal question to be answered in every source row",
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


def _membership(data: pd.DataFrame, target: ShareTarget) -> np.ndarray:
    if target.column not in data.columns:
        raise TargetInfeasible(
            "share_column_missing",
            f"Share target column is missing: {target.column}",
        )
    return data[target.column].isin(target.member_values).to_numpy(dtype=float)


def select_for_targets(
    source: pd.DataFrame,
    candidates: pd.DataFrame,
    *,
    target_column: str,
    final_count: int,
    target_mean: float,
    target_min: int,
    target_max: int,
    share_targets: tuple[ShareTarget, ...] = (),
) -> TargetSelection:
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
    for share in share_targets:
        if not 0 <= share.value <= 1:
            raise TargetInfeasible(
                "share_out_of_range",
                f"Requested share {share.value} is outside [0, 1]",
            )
        if not share.member_values:
            raise TargetInfeasible(
                "share_member_support",
                f"ValueGroup {share.id} has no observed member values in this SourceScope",
            )

    additions = final_count - source_count
    source_sum = float(source_scores.sum())
    source_memberships = [int(_membership(source, share).sum()) for share in share_targets]

    if additions == 0:
        shares = tuple(
            ShareAchievement(
                id=share.id,
                value=share.value,
                achieved_share=source_member / final_count,
                absolute_error=abs(source_member / final_count - share.value),
            )
            for share, source_member in zip(share_targets, source_memberships, strict=True)
        )
        return TargetSelection(
            selected_indices=np.array([], dtype=int),
            achieved_mean=support.achieved_mean,
            mean_absolute_error=support.absolute_error,
            mean_exact=support.absolute_error <= 1e-9,
            shares=shares,
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

    scores = candidate_scores.to_numpy(dtype=float)
    candidate_memberships = [_membership(candidates, share) for share in share_targets]
    candidate_count = len(candidates)
    slack_count = 1 + len(share_targets)
    variable_count = candidate_count + slack_count
    mean_slack_index = candidate_count

    objective = np.zeros(variable_count, dtype=float)
    objective[mean_slack_index:] = 1.0 / final_count

    integrality = np.zeros(variable_count, dtype=int)
    integrality[:candidate_count] = 1

    lower_bounds = np.zeros(variable_count, dtype=float)
    upper_bounds = np.ones(variable_count, dtype=float)
    upper_bounds[mean_slack_index:] = np.inf

    rows: list[np.ndarray] = []
    lower: list[float] = []
    upper: list[float] = []

    count_row = np.zeros(variable_count, dtype=float)
    count_row[:candidate_count] = 1.0
    rows.append(count_row)
    lower.append(float(additions))
    upper.append(float(additions))

    mean_rhs = target_mean * final_count - source_sum
    mean_upper = np.zeros(variable_count, dtype=float)
    mean_upper[:candidate_count] = scores
    mean_upper[mean_slack_index] = -1.0
    rows.append(mean_upper)
    lower.append(-np.inf)
    upper.append(mean_rhs)

    mean_lower = np.zeros(variable_count, dtype=float)
    mean_lower[:candidate_count] = scores
    mean_lower[mean_slack_index] = 1.0
    rows.append(mean_lower)
    lower.append(mean_rhs)
    upper.append(np.inf)

    for index, (share, source_member, membership) in enumerate(
        zip(share_targets, source_memberships, candidate_memberships, strict=True)
    ):
        slack_index = candidate_count + 1 + index
        share_rhs = share.value * final_count - source_member

        share_upper = np.zeros(variable_count, dtype=float)
        share_upper[:candidate_count] = membership
        share_upper[slack_index] = -1.0
        rows.append(share_upper)
        lower.append(-np.inf)
        upper.append(share_rhs)

        share_lower = np.zeros(variable_count, dtype=float)
        share_lower[:candidate_count] = membership
        share_lower[slack_index] = 1.0
        rows.append(share_lower)
        lower.append(share_rhs)
        upper.append(np.inf)

    result = milp(
        c=objective,
        integrality=integrality,
        bounds=Bounds(lower_bounds, upper_bounds),
        constraints=LinearConstraint(
            np.vstack(rows),
            lb=np.asarray(lower, dtype=float),
            ub=np.asarray(upper, dtype=float),
        ),
    )
    if not result.success or result.x is None:
        raise TargetInfeasible(
            "solver_infeasible",
            result.message or "SciPy MILP could not select a feasible candidate set",
        )

    selected = np.flatnonzero(result.x[:candidate_count] > 0.5)
    if len(selected) != additions:
        raise RuntimeError(
            f"MILP selected {len(selected)} rows but {additions} additions were required"
        )

    achieved_mean = float((source_sum + float(scores[selected].sum())) / final_count)
    mean_error = abs(achieved_mean - target_mean)
    if not share_targets and mean_error > support.absolute_error + 1e-9:
        raise TargetInfeasible(
            "candidate_target_support",
            (
                f"Candidate pool can only reach mean {achieved_mean:.6f}, but the ordinal score domain "
                f"can reach {support.achieved_mean:.6f} for this immutable source"
            ),
        )

    share_results = tuple(
        ShareAchievement(
            id=share.id,
            value=share.value,
            achieved_share=(source_member + int(membership[selected].sum())) / final_count,
            absolute_error=abs(
                (source_member + int(membership[selected].sum())) / final_count - share.value
            ),
        )
        for share, source_member, membership in zip(
            share_targets, source_memberships, candidate_memberships, strict=True
        )
    )

    return TargetSelection(
        selected_indices=selected,
        achieved_mean=achieved_mean,
        mean_absolute_error=mean_error,
        mean_exact=mean_error <= 1e-9,
        shares=share_results,
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
    result = select_for_targets(
        source,
        candidates,
        target_column=target_column,
        final_count=final_count,
        target_mean=target_mean,
        target_min=target_min,
        target_max=target_max,
    )
    return MeanSelection(
        selected_indices=result.selected_indices,
        achieved_mean=result.achieved_mean,
        absolute_error=result.mean_absolute_error,
        exact_target=result.mean_exact,
    )
