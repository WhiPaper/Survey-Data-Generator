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
class ShareSupportPlan:
    id: str
    source_member_count: int
    synthetic_member_count: int
    achieved_share: float
    absolute_error: float


@dataclass(frozen=True)
class ShareAchievement:
    id: str
    value: float
    achieved_share: float
    absolute_error: float


@dataclass(frozen=True)
class ConditionalShareTarget:
    id: str
    population_column: str
    population_member_values: frozenset[str]
    option_column: str
    option_values: frozenset[str]
    value: float


@dataclass(frozen=True)
class ConditionalShareAchievement:
    id: str
    value: float
    numerator_count: int
    denominator_count: int
    achieved_share: float
    absolute_error: float


@dataclass(frozen=True)
class TargetSelection:
    selected_indices: np.ndarray
    achieved_mean: float
    mean_absolute_error: float
    mean_exact: bool
    shares: tuple[ShareAchievement, ...]
    conditional_shares: tuple[ConditionalShareAchievement, ...]


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


def _categorical_membership(
    data: pd.DataFrame,
    *,
    column: str,
    values: frozenset[str],
    missing_code: str,
) -> np.ndarray:
    if column not in data.columns:
        raise TargetInfeasible(missing_code, f"Target column is missing: {column}")
    return data[column].isin(values).to_numpy(dtype=float)


def _membership(data: pd.DataFrame, target: ShareTarget) -> np.ndarray:
    return _categorical_membership(
        data,
        column=target.column,
        values=target.member_values,
        missing_code="share_column_missing",
    )


def _conditional_vectors(
    data: pd.DataFrame,
    target: ConditionalShareTarget,
) -> tuple[np.ndarray, np.ndarray]:
    population = _categorical_membership(
        data,
        column=target.population_column,
        values=target.population_member_values,
        missing_code="conditional_population_column_missing",
    )
    option = _categorical_membership(
        data,
        column=target.option_column,
        values=target.option_values,
        missing_code="conditional_option_column_missing",
    )
    return population, population * option


def plan_share_support(
    source: pd.DataFrame,
    *,
    target: ShareTarget,
    final_count: int,
) -> ShareSupportPlan:
    source_count = len(source)
    if source_count == 0:
        raise TargetInfeasible("empty_source_scope", "SourceScope contains no responses")
    if final_count < source_count:
        raise TargetInfeasible(
            "final_count_below_source",
            f"Final response count {final_count} is below immutable source count {source_count}",
        )
    if not 0 <= target.value <= 1:
        raise TargetInfeasible(
            "share_out_of_range",
            f"Requested share {target.value} is outside [0, 1]",
        )
    if not target.member_values:
        raise TargetInfeasible(
            "share_member_support",
            f"ValueGroup {target.id} has no observed member values in this SourceScope",
        )

    source_member_count = int(_membership(source, target).sum())
    additions = final_count - source_count
    nearest_final_members = int(np.floor(target.value * final_count + 0.5))
    final_member_count = min(
        max(nearest_final_members, source_member_count),
        source_member_count + additions,
    )
    synthetic_member_count = final_member_count - source_member_count
    achieved_share = final_member_count / final_count
    return ShareSupportPlan(
        id=target.id,
        source_member_count=source_member_count,
        synthetic_member_count=synthetic_member_count,
        achieved_share=achieved_share,
        absolute_error=abs(achieved_share - target.value),
    )


def _validate_conditional_target(target: ConditionalShareTarget) -> None:
    if not 0 <= target.value <= 1:
        raise TargetInfeasible(
            "conditional_share_out_of_range",
            f"Requested conditional share {target.value} is outside [0, 1]",
        )
    if not target.population_member_values:
        raise TargetInfeasible(
            "conditional_population_support",
            f"Conditional target {target.id} has no observed population member values",
        )
    if not target.option_values:
        raise TargetInfeasible(
            "conditional_option_support",
            f"Conditional target {target.id} has no observed checkbox option values",
        )


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
    conditional_share_targets: tuple[ConditionalShareTarget, ...] = (),
) -> TargetSelection:
    if len(share_targets) > 1:
        raise TargetInfeasible(
            "too_many_share_targets",
            "M6 currently supports at most one overall ValueGroup share target per Run",
        )
    if len({target.id for target in conditional_share_targets}) != len(conditional_share_targets):
        raise TargetInfeasible(
            "duplicate_conditional_share_target",
            "Conditional share target ids must be unique",
        )
    for target in conditional_share_targets:
        _validate_conditional_target(target)

    source_count = len(source)
    mean_support = plan_mean_support(
        source,
        target_column=target_column,
        final_count=final_count,
        target_mean=target_mean,
        target_min=target_min,
        target_max=target_max,
    )
    share_supports = tuple(
        plan_share_support(source, target=share, final_count=final_count)
        for share in share_targets
    )
    source_scores = _source_scores(source, target_column)

    additions = final_count - source_count
    source_sum = float(source_scores.sum())
    source_memberships = [support.source_member_count for support in share_supports]
    source_conditional = [
        _conditional_vectors(source, target) for target in conditional_share_targets
    ]

    if additions == 0:
        shares = tuple(
            ShareAchievement(
                id=share.id,
                value=share.value,
                achieved_share=support.achieved_share,
                absolute_error=support.absolute_error,
            )
            for share, support in zip(share_targets, share_supports, strict=True)
        )
        conditional_results: list[ConditionalShareAchievement] = []
        for target, (population, numerator) in zip(
            conditional_share_targets, source_conditional, strict=True
        ):
            denominator_count = int(population.sum())
            if denominator_count == 0:
                raise TargetInfeasible(
                    "conditional_population_empty",
                    f"Conditional target {target.id} has an empty population",
                )
            numerator_count = int(numerator.sum())
            achieved_share = numerator_count / denominator_count
            conditional_results.append(
                ConditionalShareAchievement(
                    id=target.id,
                    value=target.value,
                    numerator_count=numerator_count,
                    denominator_count=denominator_count,
                    achieved_share=achieved_share,
                    absolute_error=abs(achieved_share - target.value),
                )
            )
        return TargetSelection(
            selected_indices=np.array([], dtype=int),
            achieved_mean=mean_support.achieved_mean,
            mean_absolute_error=mean_support.absolute_error,
            mean_exact=mean_support.absolute_error <= 1e-9,
            shares=shares,
            conditional_shares=tuple(conditional_results),
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
    candidate_conditional = [
        _conditional_vectors(candidates, target) for target in conditional_share_targets
    ]
    candidate_count = len(candidates)
    slack_count = 1 + len(share_targets) + len(conditional_share_targets)
    variable_count = candidate_count + slack_count
    mean_slack_index = candidate_count
    conditional_slack_start = candidate_count + 1 + len(share_targets)

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

    for index, (target, source_vectors, candidate_vectors) in enumerate(
        zip(
            conditional_share_targets,
            source_conditional,
            candidate_conditional,
            strict=True,
        )
    ):
        source_population, source_numerator = source_vectors
        candidate_population, candidate_numerator = candidate_vectors
        source_population_count = int(source_population.sum())
        source_numerator_count = int(source_numerator.sum())
        slack_index = conditional_slack_start + index

        denominator_row = np.zeros(variable_count, dtype=float)
        denominator_row[:candidate_count] = candidate_population
        rows.append(denominator_row)
        lower.append(float(max(0, 1 - source_population_count)))
        upper.append(np.inf)

        residual_coefficients = candidate_numerator - target.value * candidate_population
        residual_rhs = -(source_numerator_count - target.value * source_population_count)

        conditional_upper = np.zeros(variable_count, dtype=float)
        conditional_upper[:candidate_count] = residual_coefficients
        conditional_upper[slack_index] = -1.0
        rows.append(conditional_upper)
        lower.append(-np.inf)
        upper.append(residual_rhs)

        conditional_lower = np.zeros(variable_count, dtype=float)
        conditional_lower[:candidate_count] = residual_coefficients
        conditional_lower[slack_index] = 1.0
        rows.append(conditional_lower)
        lower.append(residual_rhs)
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
    if mean_error > mean_support.absolute_error + 1e-9:
        raise TargetInfeasible(
            "candidate_target_support",
            (
                f"Candidate pool can only reach mean {achieved_mean:.6f}, but the ordinal score domain "
                f"can reach {mean_support.achieved_mean:.6f} for this immutable source"
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
    for achieved, support in zip(share_results, share_supports, strict=True):
        if achieved.absolute_error > support.absolute_error + 1e-9:
            raise TargetInfeasible(
                "candidate_target_support",
                (
                    f"Candidate pool can only reach share {achieved.achieved_share:.6f} for {achieved.id}, "
                    f"but immutable source counts can reach {support.achieved_share:.6f}"
                ),
            )

    conditional_results: list[ConditionalShareAchievement] = []
    for target, source_vectors, candidate_vectors in zip(
        conditional_share_targets,
        source_conditional,
        candidate_conditional,
        strict=True,
    ):
        source_population, source_numerator = source_vectors
        candidate_population, candidate_numerator = candidate_vectors
        denominator_count = int(source_population.sum() + candidate_population[selected].sum())
        numerator_count = int(source_numerator.sum() + candidate_numerator[selected].sum())
        if denominator_count <= 0:
            raise RuntimeError(f"Conditional target {target.id} ended with an empty population")
        achieved_share = numerator_count / denominator_count
        conditional_results.append(
            ConditionalShareAchievement(
                id=target.id,
                value=target.value,
                numerator_count=numerator_count,
                denominator_count=denominator_count,
                achieved_share=achieved_share,
                absolute_error=abs(achieved_share - target.value),
            )
        )

    return TargetSelection(
        selected_indices=selected,
        achieved_mean=achieved_mean,
        mean_absolute_error=mean_error,
        mean_exact=mean_error <= 1e-9,
        shares=share_results,
        conditional_shares=tuple(conditional_results),
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
