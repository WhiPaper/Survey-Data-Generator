from __future__ import annotations

from dataclasses import dataclass
from typing import Hashable

type PopulationKey = tuple[str, frozenset[str], str]

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp


@dataclass(frozen=True)
class ConditionalMetric:
    population_key: PopulationKey
    value: float
    population: np.ndarray
    numerator: np.ndarray


@dataclass(frozen=True)
class BinarySelection:
    selected_indices: np.ndarray
    target_objective: float


def _vector(values: np.ndarray, row_count: int, label: str) -> np.ndarray:
    result = np.asarray(values, dtype=float)
    if result.ndim != 1 or len(result) != row_count:
        raise ValueError(f"{label} must be a one-dimensional row vector")
    return result


def solve_binary_selection(
    *,
    scores: np.ndarray,
    final_count: int,
    target_mean: float | None = None,
    target_means: tuple[float, ...] = (),
    mean_denominators: tuple[np.ndarray, ...] = (),
    mean_ranges: tuple[float, ...] = (),
    source_count: int,
    fix_source: bool,
    share_memberships: tuple[np.ndarray, ...] = (),
    share_denominators: tuple[np.ndarray, ...] = (),
    share_values: tuple[float, ...] = (),
    count_memberships: tuple[np.ndarray, ...] = (),
    count_values: tuple[int, ...] = (),
    conditionals: tuple[ConditionalMetric, ...] = (),
    group_denominators: dict[PopulationKey, list[int]] | None = None,
    target_limit: float | None = None,
    minimize_replacements: bool = False,
) -> BinarySelection | None:
    score_matrix = np.asarray(scores, dtype=float)
    if score_matrix.ndim == 1:
        score_matrix = score_matrix.reshape((-1, 1))
    if score_matrix.ndim != 2:
        raise ValueError("scores must be a one- or two-dimensional array")
    if target_mean is not None:
        target_means = (target_mean, *target_means)
    if score_matrix.shape[1] != len(target_means):
        raise ValueError("score columns and mean targets must have equal length")
    row_count = len(score_matrix)

    if not mean_denominators:
        mean_denominators = tuple(np.ones(row_count, dtype=float) for _ in target_means)
    if len(mean_denominators) != len(target_means):
        raise ValueError("mean denominators and mean targets must have equal length")
    mean_denominators = tuple(
        _vector(values, row_count, "mean denominator") for values in mean_denominators
    )

    if not mean_ranges:
        mean_ranges = tuple(1.0 for _ in target_means)
    if len(mean_ranges) != len(target_means):
        raise ValueError("mean ranges and mean targets must have equal length")
    if any(value <= 0 for value in mean_ranges):
        raise ValueError("mean ranges must be positive")

    if len(share_memberships) != len(share_values):
        raise ValueError("share memberships and values must have equal length")
    share_memberships = tuple(
        _vector(values, row_count, "share membership") for values in share_memberships
    )
    if not share_denominators:
        share_denominators = tuple(np.ones(row_count, dtype=float) for _ in share_values)
    if len(share_denominators) != len(share_values):
        raise ValueError("share denominators and values must have equal length")
    share_denominators = tuple(
        _vector(values, row_count, "share denominator") for values in share_denominators
    )

    if len(count_memberships) != len(count_values):
        raise ValueError("count memberships and values must have equal length")
    count_memberships = tuple(
        _vector(values, row_count, "count membership") for values in count_memberships
    )

    conditional_groups: dict[PopulationKey, list[ConditionalMetric]] = {}
    for metric in conditionals:
        population = _vector(metric.population, row_count, "conditional population")
        numerator = _vector(metric.numerator, row_count, "conditional numerator")
        conditional_groups.setdefault(metric.population_key, []).append(
            ConditionalMetric(metric.population_key, metric.value, population, numerator)
        )

    denominator_vectors: dict[Hashable, np.ndarray] = {}
    denominator_values: dict[Hashable, list[int]] = {}
    for index, denominator in enumerate(mean_denominators):
        key: Hashable = ("mean", index)
        denominator_vectors[key] = denominator
        denominator_values[key] = list(range(1, final_count + 1))
    for index, denominator in enumerate(share_denominators):
        key = ("share", index)
        denominator_vectors[key] = denominator
        denominator_values[key] = list(range(1, final_count + 1))
    configured_conditionals = group_denominators or {}
    for key, metrics in conditional_groups.items():
        denominator_vectors[key] = metrics[0].population
        denominator_values[key] = configured_conditionals.get(
            key, list(range(1, final_count + 1))
        )

    if any(not values for values in denominator_values.values()):
        return None

    mean_slack_start = row_count
    share_slack_start = mean_slack_start + len(target_means)
    conditional_slack_start = share_slack_start + len(share_values)
    selector_start = conditional_slack_start + len(conditionals)
    selector_count = sum(len(values) for values in denominator_values.values())
    variable_count = selector_start + selector_count

    target_objective = np.zeros(variable_count, dtype=float)
    for index, allowed_range in enumerate(mean_ranges):
        target_objective[mean_slack_start + index] = 1.0 / allowed_range
    target_objective[share_slack_start:conditional_slack_start] = 1.0
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
    if fix_source:
        lower_bounds[:source_count] = 1.0
    upper_bounds[mean_slack_start:selector_start] = np.inf

    rows: list[np.ndarray] = []
    lower: list[float] = []
    upper: list[float] = []

    def constrain(coefficients: np.ndarray, minimum: float, maximum: float) -> None:
        rows.append(coefficients)
        lower.append(minimum)
        upper.append(maximum)

    count_row = np.zeros(variable_count, dtype=float)
    count_row[:row_count] = 1.0
    constrain(count_row, float(final_count), float(final_count))

    for membership, value in zip(count_memberships, count_values, strict=True):
        count_target_row = np.zeros(variable_count, dtype=float)
        count_target_row[:row_count] = membership
        constrain(count_target_row, float(value), float(value))

    selector_indices: dict[Hashable, list[tuple[int, int]]] = {}
    next_selector = selector_start
    for key, values in denominator_values.items():
        selector_indices[key] = []
        selector_sum = np.zeros(variable_count, dtype=float)
        for denominator in values:
            selector_indices[key].append((denominator, next_selector))
            selector_sum[next_selector] = 1.0
            next_selector += 1
        constrain(selector_sum, 1.0, 1.0)

        denominator_row = np.zeros(variable_count, dtype=float)
        denominator_row[:row_count] = denominator_vectors[key]
        for denominator, selector_index in selector_indices[key]:
            denominator_row[selector_index] = -float(denominator)
        constrain(denominator_row, 0.0, 0.0)

    def ratio_constraints(
        *,
        key: Hashable,
        numerator: np.ndarray,
        target: float,
        slack_index: int,
        big_m: float,
    ) -> None:
        for denominator, selector_index in selector_indices[key]:
            upper_row = np.zeros(variable_count, dtype=float)
            upper_row[:row_count] = numerator
            upper_row[slack_index] = -float(denominator)
            upper_row[selector_index] = big_m
            constrain(upper_row, -np.inf, target * denominator + big_m)

            lower_row = np.zeros(variable_count, dtype=float)
            lower_row[:row_count] = -numerator
            lower_row[slack_index] = -float(denominator)
            lower_row[selector_index] = big_m
            constrain(lower_row, -np.inf, -target * denominator + big_m)

    for index, value in enumerate(target_means):
        numerator = score_matrix[:, index]
        scale = max(
            1.0,
            abs(value),
            float(np.max(np.abs(numerator))) if len(numerator) else 1.0,
        )
        ratio_constraints(
            key=("mean", index),
            numerator=numerator,
            target=value,
            slack_index=mean_slack_start + index,
            big_m=float(final_count) * scale * 2.0,
        )

    for index, (membership, value) in enumerate(
        zip(share_memberships, share_values, strict=True)
    ):
        ratio_constraints(
            key=("share", index),
            numerator=membership,
            target=value,
            slack_index=share_slack_start + index,
            big_m=float(final_count) * 2.0,
        )

    conditional_by_key: dict[PopulationKey, list[ConditionalMetric]] = conditional_groups
    conditional_index = 0
    for key, metrics in conditional_by_key.items():
        for metric in metrics:
            ratio_constraints(
                key=key,
                numerator=metric.numerator,
                target=metric.value,
                slack_index=conditional_slack_start + conditional_index,
                big_m=float(final_count) * 2.0,
            )
            conditional_index += 1

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

    return BinarySelection(
        selected_indices=np.flatnonzero(result.x[:row_count] > 0.5),
        target_objective=float(np.dot(target_objective, result.x)),
    )
