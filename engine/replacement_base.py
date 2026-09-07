from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

from selection_solver import ConditionalMetric, PopulationKey, solve_binary_selection
from candidate_selection import (
    CountAchievement,
    CountTarget,
    ConditionalShareAchievement,
    ConditionalShareTarget,
    ShareAchievement,
    ShareTarget,
    TargetSelection,
    MeanTarget,
    MeanAchievement,
    _conditional_group_key,
    _conditional_vectors,
    _membership,
    _share_vectors,
    _count_membership,
    _mean_vectors,
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


def _selection_error(
    selection: TargetSelection,
    mean_targets: tuple[MeanTarget, ...],
) -> float:
    if any(target.absolute_error > 0 for target in selection.counts):
        return float("inf")
    mean_by_id = {target.id: target for target in mean_targets}
    mean_error = 0.0
    for achieved in selection.means:
        spec = mean_by_id.get(achieved.id)
        allowed_range = float(spec.maximum - spec.minimum) if spec is not None else 1.0
        mean_error += achieved.absolute_error / max(allowed_range, 1.0)
    return (
        mean_error
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
    target_min: int,
    target_max: int,
    count_targets: tuple[CountTarget, ...],
    share_targets: tuple[ShareTarget, ...],
    conditional_share_targets: tuple[ConditionalShareTarget, ...],
    extra_mean_targets: tuple[MeanTarget, ...] = (),
    primary_mean_id: str = "mean",
) -> TargetSelection:
    final = pd.concat(
        [source.iloc[keep_source_indices], candidates.iloc[selected_candidate_indices]],
        ignore_index=True,
    )
    mean_specs = (
        MeanTarget(primary_mean_id, target_column, target_mean, target_min, target_max),
        *extra_mean_targets,
    )
    mean_results: list[MeanAchievement] = []
    for target in mean_specs:
        values, denominator = _mean_vectors(final, target.column)
        denominator_count = int(denominator.sum())
        if denominator_count <= 0:
            raise RuntimeError(f"Mean target {target.id} ended with an empty answered denominator")
        achieved = float(values.sum()) / denominator_count
        mean_results.append(
            MeanAchievement(target.id, target.value, achieved, abs(achieved - target.value))
        )

    counts = tuple(
        CountAchievement(
            target.id,
            target.value,
            int(_count_membership(final, target).sum()),
            abs(int(_count_membership(final, target).sum()) - target.value),
        )
        for target in count_targets
    )
    shares: list[ShareAchievement] = []
    for target in share_targets:
        denominator, numerator = _share_vectors(final, target)
        denominator_count = int(denominator.sum())
        if denominator_count <= 0:
            raise RuntimeError(f"Share target {target.id} ended with an empty eligible denominator")
        numerator_count = int(numerator.sum())
        achieved_share = numerator_count / denominator_count
        shares.append(
            ShareAchievement(
                id=target.id,
                value=target.value,
                achieved_share=achieved_share,
                absolute_error=abs(achieved_share - target.value),
                numerator_count=numerator_count,
                denominator_count=denominator_count,
            )
        )

    conditional_results: list[ConditionalShareAchievement] = []
    for target in conditional_share_targets:
        population, numerator = _conditional_vectors(final, target)
        denominator_count = int(population.sum())
        if denominator_count <= 0:
            raise RuntimeError(f"Conditional target {target.id} ended with an empty eligible population")
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

    primary = mean_results[0]
    return TargetSelection(
        selected_indices=selected_candidate_indices,
        achieved_mean=primary.achieved_mean,
        mean_absolute_error=primary.absolute_error,
        mean_exact=primary.absolute_error <= 1e-9,
        counts=counts,
        shares=tuple(shares),
        conditional_shares=tuple(conditional_results),
        means=tuple(mean_results),
    )


def _solve_replacement_selection(
    source: pd.DataFrame,
    candidates: pd.DataFrame,
    *,
    target_column: str,
    final_count: int,
    target_mean: float,
    target_min: int,
    target_max: int,
    count_targets: tuple[CountTarget, ...],
    share_targets: tuple[ShareTarget, ...],
    conditional_share_targets: tuple[ConditionalShareTarget, ...],
    extra_mean_targets: tuple[MeanTarget, ...] = (),
    primary_mean_id: str = "mean",
    target_limit: float | None = None,
    minimize_replacements: bool = False,
) -> _ReplacementSolve | None:
    source_count = len(source)
    mean_targets = (
        MeanTarget(primary_mean_id, target_column, target_mean, target_min, target_max),
        *extra_mean_targets,
    )
    score_columns: list[np.ndarray] = []
    mean_denominators: list[np.ndarray] = []
    for target in mean_targets:
        source_values, source_denominator = _mean_vectors(source, target.column)
        candidate_values, candidate_denominator = _mean_vectors(candidates, target.column)
        score_columns.append(
            np.concatenate(
                [source_values.to_numpy(dtype=float), candidate_values.to_numpy(dtype=float)]
            )
        )
        mean_denominators.append(np.concatenate([source_denominator, candidate_denominator]))

    source_share_vectors = [_share_vectors(source, target) for target in share_targets]
    candidate_share_vectors = [_share_vectors(candidates, target) for target in share_targets]
    source_count_memberships = [_count_membership(source, target) for target in count_targets]
    candidate_count_memberships = [_count_membership(candidates, target) for target in count_targets]
    source_conditional = [
        _conditional_vectors(source, target) for target in conditional_share_targets
    ]
    candidate_conditional = [
        _conditional_vectors(candidates, target) for target in conditional_share_targets
    ]

    conditional_groups: dict[PopulationKey, list[ConditionalShareTarget]] = {}
    for target in conditional_share_targets:
        conditional_groups.setdefault(_conditional_group_key(target), []).append(target)

    solution = solve_binary_selection(
        scores=np.column_stack(tuple(score_columns)),
        final_count=final_count,
        target_means=tuple(target.value for target in mean_targets),
        mean_denominators=tuple(mean_denominators),
        mean_ranges=tuple(float(target.maximum - target.minimum) for target in mean_targets),
        source_count=source_count,
        fix_source=False,
        share_memberships=tuple(
            np.concatenate([source_vectors[1], candidate_vectors[1]])
            for source_vectors, candidate_vectors in zip(
                source_share_vectors, candidate_share_vectors, strict=True
            )
        ),
        share_denominators=tuple(
            np.concatenate([source_vectors[0], candidate_vectors[0]])
            for source_vectors, candidate_vectors in zip(
                source_share_vectors, candidate_share_vectors, strict=True
            )
        ),
        share_values=tuple(target.value for target in share_targets),
        count_memberships=tuple(
            np.concatenate([source_membership, candidate_membership])
            for source_membership, candidate_membership in zip(
                source_count_memberships, candidate_count_memberships, strict=True
            )
        ),
        count_values=tuple(target.value for target in count_targets),
        conditionals=tuple(
            ConditionalMetric(
                population_key=_conditional_group_key(target),
                value=target.value,
                population=np.concatenate([source_vectors[0], candidate_vectors[0]]),
                numerator=np.concatenate([source_vectors[1], candidate_vectors[1]]),
            )
            for target, source_vectors, candidate_vectors in zip(
                conditional_share_targets,
                source_conditional,
                candidate_conditional,
                strict=True,
            )
        ),
        group_denominators={
            key: list(range(1, final_count + 1)) for key in conditional_groups
        },
        target_limit=target_limit,
        minimize_replacements=minimize_replacements,
    )
    if solution is None:
        return None

    keep_source = solution.selected_indices[solution.selected_indices < source_count]
    selected_candidates = solution.selected_indices[solution.selected_indices >= source_count] - source_count
    return _ReplacementSolve(
        keep_source_indices=keep_source,
        selected_candidate_indices=selected_candidates,
        target_objective=solution.target_objective,
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
    count_targets: tuple[CountTarget, ...] = (),
    share_targets: tuple[ShareTarget, ...] = (),
    conditional_share_targets: tuple[ConditionalShareTarget, ...] = (),
    append_only_outcome: TargetSelection | None = None,
    extra_mean_targets: tuple[MeanTarget, ...] = (),
    primary_mean_id: str = "mean",
) -> EditPlanSelection:
    mean_targets = (
        MeanTarget(primary_mean_id, target_column, target_mean, target_min, target_max),
        *extra_mean_targets,
    )
    append_only = append_only_outcome
    if append_only is None:
        append_only = select_for_targets(
            source,
            candidates,
            target_column=target_column,
            final_count=final_count,
            target_mean=target_mean,
            target_min=target_min,
            target_max=target_max,
            count_targets=count_targets,
            share_targets=share_targets,
            conditional_share_targets=conditional_share_targets,
            extra_mean_targets=extra_mean_targets,
            primary_mean_id=primary_mean_id,
        )
    append_error = _selection_error(append_only, mean_targets)

    best = _solve_replacement_selection(
        source,
        candidates,
        target_column=target_column,
        final_count=final_count,
        target_mean=target_mean,
        target_min=target_min,
        target_max=target_max,
        count_targets=count_targets,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
        extra_mean_targets=extra_mean_targets,
        primary_mean_id=primary_mean_id,
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
        target_min=target_min,
        target_max=target_max,
        count_targets=count_targets,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
        extra_mean_targets=extra_mean_targets,
        primary_mean_id=primary_mean_id,
    )
    if _selection_error(best_outcome, mean_targets) >= append_error - 1e-9:
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
        target_min=target_min,
        target_max=target_max,
        count_targets=count_targets,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
        extra_mean_targets=extra_mean_targets,
        primary_mean_id=primary_mean_id,
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
        target_min=target_min,
        target_max=target_max,
        count_targets=count_targets,
        share_targets=share_targets,
        conditional_share_targets=conditional_share_targets,
        extra_mean_targets=extra_mean_targets,
        primary_mean_id=primary_mean_id,
    )

    return EditPlanSelection(
        status="available",
        replacement_count=replacement_count,
        proposed_replacements=proposed_replacements,
        addition_candidate_indices=addition_candidates,
        append_only_outcome=append_only,
        replacement_outcome=replacement_outcome,
    )
