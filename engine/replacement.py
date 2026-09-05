from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, milp

from select import (
    ConditionalShareAchievement,
    ConditionalShareTarget,
    ShareAchievement,
    ShareTarget,
    TargetSelection,
    select_for_targets,
)


@dataclass(frozen=True)
class ProposedReplacement:
    source_index: int
    candidate_index: int


@dataclass(frozen=True)
class EditPlanSelection:
    status: Literal["not_required", "available", "impossible"]
    replacement_count: int
    proposed_replacements: tuple[ProposedReplacement, ...]
    addition_candidate_indices: np.ndarray
    append_only_outcome: TargetSelection
    replacement_outcome: TargetSelection | None


@dataclass(frozen=True)
class _ReplacementSolve:
    keep_source_indices: np.ndarray
    selected_candidate_indices: np.ndarray
    target_objective: float


def _membership(data: pd.DataFrame, column: str, values: frozenset[str]) -> np.ndarray:
    return data[column].isin(values).to_numpy(dtype=float)


def _conditional_vectors(
    data: pd.DataFrame,
    target: ConditionalShareTarget,
) -> tuple[np.ndarray, np.ndarray]:
    population = _membership(data, target.population_column, target.population_member_values)
    option = _membership(data, target.option_column, target.option_values)
    return population, population * option


def _selection_error(selection: TargetSelection) -> float:
    return (
        selection.mean_absolute_error
        + sum(target.absolute_error for target in selection.shares)
        + sum(target.absolute_error for target in selection.conditional_shares)
    )


def _evaluate_selection(
    source: pd.DataFrame,
    candidates: pd.DataFrame,
    *,
    keep_source_indices: np.ndarray,
    selected_candidate_indices: np.ndarray,
    target_column: str,
    target_mean: float,
    share_targets: tuple[ShareTarget, ...],
    conditional_share_targets: tuple[ConditionalShareTarget, ...],
) -> TargetSelection:
    final = pd.concat(
        [
            source.iloc[keep_source_indices],
            candidates.iloc[selected_candidate_indices],
        ],
        ignore_index=True,
    )
    scores = pd.to_numeric(final[target_column], errors="coerce")
    if scores.isna().any():
        raise RuntimeError("Replacement selection produced an invalid target score")

    achieved_mean = float(scores.mean())
    mean_error = abs(achieved_mean - target_mean)
    shares = tuple(
        ShareAchievement(
            id=target.id,
            value=target.value,
            achieved_share=float(final[target.column].isin(target.member_values).mean()),
            absolute_error=abs(
                float(final[target.column].isin(target.member_values).mean()) - target.value
            ),
        )
        for target in share_targets
    )

    conditional_results: list[ConditionalShareAchievement] = []
    for target in conditional_share_targets:
        population = final[target.population_column].isin(target.population_member_values)
        option = final[target.option_column].isin(target.option_values)
        denominator_count = int(population.sum())
        if denominator_count <= 0:
            raise RuntimeError(f"Conditional target {target.id} ended with an empty population")
        numerator_count = int((population & option).sum())
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
        selected_indices=selected_candidate_indices,
        achieved_mean=achieved_mean,
        mean_absolute_error=mean_error,
        mean_exact=mean_error <= 1e-9,
        shares=shares,
        conditional_shares=tuple(conditional_results),
    )


def _solve_replacement_selection(
    source: pd.DataFrame,
    candidates: pd.DataFrame,
    *,
    target_column: str,
    final_count: int,
    target_mean: float,
    share_targets: tuple[ShareTarget, ...],
    conditional_share_targets: tuple[ConditionalShareTarget, ...],
    target_limit: float | None = None,
    minimize_replacements: bool = False,
) -> _ReplacementSolve | None:
    source_count = len(source)
    candidate_count = len(candidates)
    source_scores = pd.to_numeric(source[target_column], errors="coerce").to_numpy(dtype=float)
    candidate_scores = pd.to_numeric(candidates[target_column], errors="coerce").to_numpy(
        dtype=float
    )

    conditional_groups: dict[tuple[str, frozenset[str]], list[ConditionalShareTarget]] = {}
    for target in conditional_share_targets:
        key = (target.population_column, target.population_member_values)
        conditional_groups.setdefault(key, []).append(target)

    row_count = source_count + candidate_count
    mean_slack_index = row_count
    share_slack_start = mean_slack_index + 1
    conditional_slack_start = share_slack_start + len(share_targets)
    selector_start = conditional_slack_start + len(conditional_share_targets)
    selector_count = final_count * len(conditional_groups)
    variable_count = selector_start + selector_count

    target_objective = np.zeros(variable_count, dtype=float)
    target_objective[mean_slack_index] = 1.0 / final_count
    target_objective[share_slack_start:conditional_slack_start] = 1.0 / final_count
    target_objective[conditional_slack_start:selector_start] = 1.0

    objective = target_objective.copy()
    if minimize_replacements:
        objective[:] = 0.0
        objective[:source_count] = -1.0

    integrality = np.zeros(variable_count, dtype=int)
    integrality[:row_count] = 1
    integrality[selector_start:] = 1

    lower_bounds = np.zeros(variable_count, dtype=float)
    upper_bounds = np.ones(variable_count, dtype=float)
    upper_bounds[mean_slack_index:selector_start] = np.inf

    rows: list[np.ndarray] = []
    lower: list[float] = []
    upper: list[float] = []

    def constrain(coefficients: np.ndarray, minimum: float, maximum: float) -> None:
        rows.append(coefficients)
        lower.append(minimum)
        upper.append(maximum)

    final_count_row = np.zeros(variable_count, dtype=float)
    final_count_row[:row_count] = 1.0
    constrain(final_count_row, float(final_count), float(final_count))

    mean_rhs = target_mean * final_count
    mean_upper = np.zeros(variable_count, dtype=float)
    mean_upper[:source_count] = source_scores
    mean_upper[source_count:row_count] = candidate_scores
    mean_upper[mean_slack_index] = -1.0
    constrain(mean_upper, -np.inf, mean_rhs)

    mean_lower = np.zeros(variable_count, dtype=float)
    mean_lower[:source_count] = source_scores
    mean_lower[source_count:row_count] = candidate_scores
    mean_lower[mean_slack_index] = 1.0
    constrain(mean_lower, mean_rhs, np.inf)

    for index, target in enumerate(share_targets):
        source_membership = _membership(source, target.column, target.member_values)
        candidate_membership = _membership(candidates, target.column, target.member_values)
        slack_index = share_slack_start + index
        share_rhs = target.value * final_count

        share_upper = np.zeros(variable_count, dtype=float)
        share_upper[:source_count] = source_membership
        share_upper[source_count:row_count] = candidate_membership
        share_upper[slack_index] = -1.0
        constrain(share_upper, -np.inf, share_rhs)

        share_lower = np.zeros(variable_count, dtype=float)
        share_lower[:source_count] = source_membership
        share_lower[source_count:row_count] = candidate_membership
        share_lower[slack_index] = 1.0
        constrain(share_lower, share_rhs, np.inf)

    selector_indices: dict[tuple[str, frozenset[str]], list[tuple[int, int]]] = {}
    next_selector = selector_start
    for key, targets in conditional_groups.items():
        selector_indices[key] = []
        selector_sum = np.zeros(variable_count, dtype=float)
        for denominator in range(1, final_count + 1):
            selector_indices[key].append((denominator, next_selector))
            selector_sum[next_selector] = 1.0
            next_selector += 1
        constrain(selector_sum, 1.0, 1.0)

        source_population = _conditional_vectors(source, targets[0])[0]
        candidate_population = _conditional_vectors(candidates, targets[0])[0]
        denominator_row = np.zeros(variable_count, dtype=float)
        denominator_row[:source_count] = source_population
        denominator_row[source_count:row_count] = candidate_population
        for denominator, selector_index in selector_indices[key]:
            denominator_row[selector_index] = -float(denominator)
        constrain(denominator_row, 0.0, 0.0)

    big_m = float(final_count)
    for index, target in enumerate(conditional_share_targets):
        key = (target.population_column, target.population_member_values)
        source_numerator = _conditional_vectors(source, target)[1]
        candidate_numerator = _conditional_vectors(candidates, target)[1]
        slack_index = conditional_slack_start + index

        for denominator, selector_index in selector_indices[key]:
            conditional_upper = np.zeros(variable_count, dtype=float)
            conditional_upper[:source_count] = source_numerator
            conditional_upper[source_count:row_count] = candidate_numerator
            conditional_upper[slack_index] = -float(denominator)
            conditional_upper[selector_index] = big_m
            constrain(
                conditional_upper,
                -np.inf,
                target.value * denominator + big_m,
            )

            conditional_lower = np.zeros(variable_count, dtype=float)
            conditional_lower[:source_count] = -source_numerator
            conditional_lower[source_count:row_count] = -candidate_numerator
            conditional_lower[slack_index] = -float(denominator)
            conditional_lower[selector_index] = big_m
            constrain(
                conditional_lower,
                -np.inf,
                -target.value * denominator + big_m,
            )

    if target_limit is not None:
        constrain(target_objective.copy(), -np.inf, target_limit)

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
        return None

    keep_source = np.flatnonzero(result.x[:source_count] > 0.5)
    selected_candidates = np.flatnonzero(result.x[source_count:row_count] > 0.5)
    return _ReplacementSolve(
        keep_source_indices=keep_source,
        selected_candidate_indices=selected_candidates,
        target_objective=float(np.dot(target_objective, result.x)),
    )


def plan_replacements(
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
) -> EditPlanSelection:
    append_only = select_for_targets(
        source,
        candidates,
        target_column=target_column,
        final_count=final_count,
        target_mean=target_mean,
        target_min=target_min,
        target_max=target_max,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
    )
    append_error = _selection_error(append_only)

    best = _solve_replacement_selection(
        source,
        candidates,
        target_column=target_column,
        final_count=final_count,
        target_mean=target_mean,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
    )
    if best is None:
        return EditPlanSelection(
            status="impossible",
            replacement_count=0,
            proposed_replacements=(),
            addition_candidate_indices=append_only.selected_indices,
            append_only_outcome=append_only,
            replacement_outcome=None,
        )

    best_outcome = _evaluate_selection(
        source,
        candidates,
        keep_source_indices=best.keep_source_indices,
        selected_candidate_indices=best.selected_candidate_indices,
        target_column=target_column,
        target_mean=target_mean,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
    )
    if _selection_error(best_outcome) >= append_error - 1e-9:
        return EditPlanSelection(
            status="not_required",
            replacement_count=0,
            proposed_replacements=(),
            addition_candidate_indices=append_only.selected_indices,
            append_only_outcome=append_only,
            replacement_outcome=None,
        )

    minimal = _solve_replacement_selection(
        source,
        candidates,
        target_column=target_column,
        final_count=final_count,
        target_mean=target_mean,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
        target_limit=best.target_objective + 1e-9,
        minimize_replacements=True,
    )
    if minimal is None:
        return EditPlanSelection(
            status="impossible",
            replacement_count=0,
            proposed_replacements=(),
            addition_candidate_indices=append_only.selected_indices,
            append_only_outcome=append_only,
            replacement_outcome=None,
        )

    removed_source = np.setdiff1d(
        np.arange(len(source), dtype=int),
        minimal.keep_source_indices,
        assume_unique=True,
    )
    replacement_count = len(removed_source)
    replacement_candidates = minimal.selected_candidate_indices[:replacement_count]
    addition_candidates = minimal.selected_candidate_indices[replacement_count:]
    proposed_replacements = tuple(
        ProposedReplacement(source_index=int(source_index), candidate_index=int(candidate_index))
        for source_index, candidate_index in zip(
            removed_source,
            replacement_candidates,
            strict=True,
        )
    )
    replacement_outcome = _evaluate_selection(
        source,
        candidates,
        keep_source_indices=minimal.keep_source_indices,
        selected_candidate_indices=minimal.selected_candidate_indices,
        target_column=target_column,
        target_mean=target_mean,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
    )

    return EditPlanSelection(
        status="available",
        replacement_count=replacement_count,
        proposed_replacements=proposed_replacements,
        addition_candidate_indices=addition_candidates,
        append_only_outcome=append_only,
        replacement_outcome=replacement_outcome,
    )
