from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from answer_slots import answer_cell_eligible
from selection_solver import ConditionalMetric, PopulationKey, solve_binary_selection


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
class MeanTarget:
    id: str
    column: str
    value: float
    minimum: int
    maximum: int


@dataclass(frozen=True)
class MeanAchievement:
    id: str
    value: float
    achieved_mean: float
    absolute_error: float


@dataclass(frozen=True)
class ShareTarget:
    id: str
    column: str
    member_values: frozenset[str]
    value: float


@dataclass(frozen=True)
class CountTarget:
    id: str
    column: str
    member_values: frozenset[str]
    value: int


@dataclass(frozen=True)
class CountAchievement:
    id: str
    value: int
    achieved_count: int
    absolute_error: int


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
class ConditionalSupportPlan:
    population_column: str
    population_member_values: frozenset[str]
    denominator_count: int
    target_errors: tuple[tuple[str, float], ...]
    total_absolute_error: float


@dataclass(frozen=True)
class TargetSelection:
    selected_indices: np.ndarray
    achieved_mean: float
    mean_absolute_error: float
    mean_exact: bool
    shares: tuple[ShareAchievement, ...]
    conditional_shares: tuple[ConditionalShareAchievement, ...]
    counts: tuple[CountAchievement, ...] = ()
    means: tuple[MeanAchievement, ...] = ()


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


def _count_membership(data: pd.DataFrame, target: CountTarget) -> np.ndarray:
    return _categorical_membership(
        data,
        column=target.column,
        values=target.member_values,
        missing_code="count_column_missing",
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
    if target.option_column not in data.columns:
        raise TargetInfeasible(
            "conditional_option_column_missing",
            f"Target column is missing: {target.option_column}",
        )
    eligible = data[target.option_column].map(answer_cell_eligible).to_numpy(dtype=float)
    option = _categorical_membership(
        data,
        column=target.option_column,
        values=target.option_values,
        missing_code="conditional_option_column_missing",
    )
    eligible_population = population * eligible
    return eligible_population, eligible_population * option


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


def _population_key(target: ConditionalShareTarget) -> tuple[str, frozenset[str]]:
    return target.population_column, target.population_member_values


def _conditional_group_key(target: ConditionalShareTarget) -> PopulationKey:
    return target.population_column, target.population_member_values, target.option_column


def _group_conditional_targets(
    targets: tuple[ConditionalShareTarget, ...],
) -> list[tuple[PopulationKey, tuple[ConditionalShareTarget, ...]]]:
    grouped: dict[PopulationKey, list[ConditionalShareTarget]] = {}
    for target in targets:
        grouped.setdefault(_conditional_group_key(target), []).append(target)
    return [(key, tuple(values)) for key, values in grouped.items()]


def _nearest_feasible_numerator(
    *,
    denominator: int,
    source_population_count: int,
    source_numerator_count: int,
    target_value: float,
) -> tuple[int, float]:
    added_population = denominator - source_population_count
    minimum = source_numerator_count
    maximum = source_numerator_count + added_population
    desired = target_value * denominator
    candidates = {
        minimum,
        maximum,
        min(max(int(np.floor(desired)), minimum), maximum),
        min(max(int(np.ceil(desired)), minimum), maximum),
    }
    numerator = min(candidates, key=lambda value: (abs(value / denominator - target_value), value))
    return numerator, abs(numerator / denominator - target_value)


def plan_conditional_support(
    source: pd.DataFrame,
    *,
    targets: tuple[ConditionalShareTarget, ...],
    final_count: int,
    population_additions: int | None = None,
) -> ConditionalSupportPlan:
    if not targets:
        raise ValueError("conditional support requires at least one target")
    population_column, population_values = _population_key(targets[0])
    option_column = targets[0].option_column
    if any(_population_key(target) != (population_column, population_values) for target in targets):
        raise ValueError("conditional support targets must share one population")
    if any(target.option_column != option_column for target in targets):
        raise ValueError("conditional support targets must share one eligible question")

    source_population_count = int(_conditional_vectors(source, targets[0])[0].sum())
    if source_population_count <= 0:
        raise TargetInfeasible(
            "conditional_population_empty",
            "Conditional target eligible population is empty in the immutable source",
        )
    additions = final_count - len(source)
    available_population_additions = additions if population_additions is None else population_additions
    if not 0 <= available_population_additions <= additions:
        raise TargetInfeasible(
            "conditional_population_conflict",
            "Conditional eligible population conflicts with the overall share target",
        )
    denominators = range(
        source_population_count,
        source_population_count + available_population_additions + 1,
    )

    source_numerators = {
        target.id: int(_conditional_vectors(source, target)[1].sum()) for target in targets
    }
    best: ConditionalSupportPlan | None = None
    for denominator in denominators:
        target_errors: list[tuple[str, float]] = []
        total = 0.0
        for target in targets:
            _, error = _nearest_feasible_numerator(
                denominator=denominator,
                source_population_count=source_population_count,
                source_numerator_count=source_numerators[target.id],
                target_value=target.value,
            )
            target_errors.append((target.id, error))
            total += error
        plan = ConditionalSupportPlan(
            population_column=population_column,
            population_member_values=population_values,
            denominator_count=denominator,
            target_errors=tuple(target_errors),
            total_absolute_error=total,
        )
        if best is None or (plan.total_absolute_error, -plan.denominator_count) < (
            best.total_absolute_error,
            -best.denominator_count,
        ):
            best = plan
    assert best is not None
    return best


def select_for_targets(
    source: pd.DataFrame,
    candidates: pd.DataFrame,
    *,
    target_column: str,
    final_count: int,
    target_mean: float,
    target_min: int,
    target_max: int,
    count_targets: tuple[CountTarget, ...] = (),
    enforce_counts: bool = True,
    share_targets: tuple[ShareTarget, ...] = (),
    conditional_share_targets: tuple[ConditionalShareTarget, ...] = (),
    extra_mean_targets: tuple[MeanTarget, ...] = (),
    primary_mean_id: str = "mean",
) -> TargetSelection:
    if len({target.id for target in (*count_targets, *share_targets)}) != len(count_targets) + len(share_targets):
        raise TargetInfeasible("duplicate_categorical_target", "Categorical target ids must be unique")
    for target in count_targets:
        if not 0 <= target.value <= final_count:
            raise TargetInfeasible("count_out_of_range", f"Requested count {target.value} is outside [0, {final_count}]")
        if not target.member_values:
            raise TargetInfeasible("count_member_support", f"Count target {target.id} has no supported member values")
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
    extra_source_scores = tuple(_source_scores(source, target.column) for target in extra_mean_targets)
    additions = final_count - source_count
    source_sum = float(source_scores.sum())
    source_member_counts = [support.source_member_count for support in share_supports]
    source_conditional = [
        _conditional_vectors(source, target) for target in conditional_share_targets
    ]
    conditional_groups = _group_conditional_targets(conditional_share_targets)

    share_support_by_population = {
        (share.column, share.member_values): support
        for share, support in zip(share_targets, share_supports, strict=True)
    }
    conditional_support_plans: dict[PopulationKey, ConditionalSupportPlan] = {}
    for key, targets in conditional_groups:
        membership_key = _population_key(targets[0])
        population_support = share_support_by_population.get(membership_key)
        conditional_support_plans[key] = plan_conditional_support(
            source,
            targets=targets,
            final_count=final_count,
            population_additions=(
                population_support.synthetic_member_count if population_support is not None else None
            ),
        )

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
                    f"Conditional target {target.id} has an empty eligible population",
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
            counts=tuple(
                CountAchievement(target.id, target.value, int(_count_membership(source, target).sum()), abs(int(_count_membership(source, target).sum()) - target.value))
                for target in count_targets
            ),
            shares=shares,
            conditional_shares=tuple(conditional_results),
            means=(MeanAchievement(primary_mean_id, target_mean, mean_support.achieved_mean, mean_support.absolute_error), *tuple(MeanAchievement(target.id, target.value, float(scores.mean()), abs(float(scores.mean()) - target.value)) for target, scores in zip(extra_mean_targets, extra_source_scores, strict=True))),
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

    candidate_score_values = candidate_scores.to_numpy(dtype=float)
    extra_candidate_scores = tuple(pd.to_numeric(candidates[target.column], errors="coerce") for target in extra_mean_targets)
    if any(scores.isna().any() for scores in extra_candidate_scores):
        raise TargetInfeasible("candidate_support", "Candidate pool contains unanswered or invalid mean scores")
    source_memberships = [_membership(source, share) for share in share_targets]
    candidate_memberships = [_membership(candidates, share) for share in share_targets]
    source_count_memberships = [_count_membership(source, target) for target in count_targets]
    candidate_count_memberships = [_count_membership(candidates, target) for target in count_targets]
    candidate_conditional = [
        _conditional_vectors(candidates, target) for target in conditional_share_targets
    ]

    group_denominators: dict[PopulationKey, list[int]] = {}
    for key, targets in conditional_groups:
        source_population = int(_conditional_vectors(source, targets[0])[0].sum())
        membership_key = _population_key(targets[0])
        population_support = share_support_by_population.get(membership_key)
        population_additions = (
            population_support.synthetic_member_count if population_support is not None else additions
        )
        group_denominators[key] = list(
            range(source_population, source_population + population_additions + 1)
        )

    solution = solve_binary_selection(
        scores=np.column_stack((
            np.concatenate([source_scores.to_numpy(dtype=float), candidate_score_values]),
            *(np.concatenate([source_values.to_numpy(dtype=float), candidate_values.to_numpy(dtype=float)]) for source_values, candidate_values in zip(extra_source_scores, extra_candidate_scores, strict=True)),
        )),
        final_count=final_count,
        target_means=(target_mean, *(target.value for target in extra_mean_targets)),
        source_count=source_count,
        fix_source=True,
        share_memberships=tuple(
            np.concatenate([source_membership, candidate_membership])
            for source_membership, candidate_membership in zip(
                source_memberships, candidate_memberships, strict=True
            )
        ),
        share_values=tuple(target.value for target in share_targets),
        count_memberships=tuple(
            np.concatenate([source_membership, candidate_membership])
            for source_membership, candidate_membership in zip(source_count_memberships, candidate_count_memberships, strict=True)
        ) if enforce_counts else (),
        count_values=tuple(target.value for target in count_targets) if enforce_counts else (),
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
        group_denominators=group_denominators,
    )
    if solution is None:
        raise TargetInfeasible(
            "solver_infeasible",
            "SciPy MILP could not select a feasible candidate set",
        )

    selected = solution.selected_indices[solution.selected_indices >= source_count] - source_count
    if len(selected) != additions:
        raise RuntimeError(
            f"MILP selected {len(selected)} rows but {additions} additions were required"
        )

    achieved_mean = float(
        (source_sum + float(candidate_score_values[selected].sum())) / final_count
    )
    mean_error = abs(achieved_mean - target_mean)
    extra_mean_results = tuple(
        MeanAchievement(
            target.id, target.value,
            float((float(source_values.sum()) + float(candidate_values.iloc[selected].sum())) / final_count),
            abs(float((float(source_values.sum()) + float(candidate_values.iloc[selected].sum())) / final_count) - target.value),
        )
        for target, source_values, candidate_values in zip(extra_mean_targets, extra_source_scores, extra_candidate_scores, strict=True)
    )
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
            share_targets, source_member_counts, candidate_memberships, strict=True
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
            raise RuntimeError(f"Conditional target {target.id} ended with an empty eligible population")
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

    results_by_population: dict[PopulationKey, list[ConditionalShareAchievement]] = {}
    target_by_id = {target.id: target for target in conditional_share_targets}
    for achieved in conditional_results:
        key = _conditional_group_key(target_by_id[achieved.id])
        results_by_population.setdefault(key, []).append(achieved)
    for key, results in results_by_population.items():
        support = conditional_support_plans[key]
        actual_total_error = sum(result.absolute_error for result in results)
        if actual_total_error > support.total_absolute_error + 1e-9:
            raise TargetInfeasible(
                "candidate_target_support",
                (
                    "Candidate pool can only reach total conditional share error "
                    f"{actual_total_error:.6f}, but immutable source counts can reach "
                    f"{support.total_absolute_error:.6f} with eligible population denominator "
                    f"{support.denominator_count}"
                ),
            )

    return TargetSelection(
        selected_indices=selected,
        achieved_mean=achieved_mean,
        mean_absolute_error=mean_error,
        mean_exact=mean_error <= 1e-9,
        counts=tuple(
            CountAchievement(
                target.id,
                target.value,
                (achieved := int(_count_membership(source, target).sum() + _count_membership(candidates, target)[selected].sum())),
                abs(achieved - target.value),
            )
            for target in count_targets
        ),
        shares=share_results,
        conditional_shares=tuple(conditional_results),
        means=(MeanAchievement(primary_mean_id, target_mean, achieved_mean, mean_error), *extra_mean_results),
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
