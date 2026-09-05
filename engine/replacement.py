from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

from selection_solver import ConditionalMetric, solve_binary_selection
from select import (
    ConditionalShareAchievement,
    ConditionalShareTarget,
    ShareAchievement,
    ShareTarget,
    TargetSelection,
    _conditional_vectors,
    _membership,
    _population_key,
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
        [source.iloc[keep_source_indices], candidates.iloc[selected_candidate_indices]],
        ignore_index=True,
    )
    scores = pd.to_numeric(final[target_column], errors="coerce")
    if scores.isna().any():
        raise RuntimeError("Replacement selection produced an invalid target score")

    achieved_mean = float(scores.mean())
    shares: list[ShareAchievement] = []
    for target in share_targets:
        achieved_share = float(final[target.column].isin(target.member_values).mean())
        shares.append(
            ShareAchievement(
                id=target.id,
                value=target.value,
                achieved_share=achieved_share,
                absolute_error=abs(achieved_share - target.value),
            )
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

    mean_error = abs(achieved_mean - target_mean)
    return TargetSelection(
        selected_indices=selected_candidate_indices,
        achieved_mean=achieved_mean,
        mean_absolute_error=mean_error,
        mean_exact=mean_error <= 1e-9,
        shares=tuple(shares),
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
    source_scores = pd.to_numeric(source[target_column], errors="coerce").to_numpy(dtype=float)
    candidate_scores = pd.to_numeric(candidates[target_column], errors="coerce").to_numpy(
        dtype=float
    )
    source_memberships = [_membership(source, target) for target in share_targets]
    candidate_memberships = [_membership(candidates, target) for target in share_targets]
    source_conditional = [
        _conditional_vectors(source, target) for target in conditional_share_targets
    ]
    candidate_conditional = [
        _conditional_vectors(candidates, target) for target in conditional_share_targets
    ]

    conditional_groups: dict[tuple[str, frozenset[str]], list[ConditionalShareTarget]] = {}
    for target in conditional_share_targets:
        conditional_groups.setdefault(_population_key(target), []).append(target)

    solution = solve_binary_selection(
        scores=np.concatenate([source_scores, candidate_scores]),
        final_count=final_count,
        target_mean=target_mean,
        source_count=source_count,
        fix_source=False,
        share_memberships=tuple(
            np.concatenate([source_membership, candidate_membership])
            for source_membership, candidate_membership in zip(
                source_memberships, candidate_memberships, strict=True
            )
        ),
        share_values=tuple(target.value for target in share_targets),
        conditionals=tuple(
            ConditionalMetric(
                population_key=_population_key(target),
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
    share_targets: tuple[ShareTarget, ...] = (),
    conditional_share_targets: tuple[ConditionalShareTarget, ...] = (),
    append_only_outcome: TargetSelection | None = None,
) -> EditPlanSelection:
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
