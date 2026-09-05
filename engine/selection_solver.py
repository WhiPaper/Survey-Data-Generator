from __future__ import annotations

from dataclasses import dataclass

type PopulationKey = tuple[str, frozenset[str]]

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


def solve_binary_selection(
    *,
    scores: np.ndarray,
    final_count: int,
    target_mean: float,
    source_count: int,
    fix_source: bool,
    share_memberships: tuple[np.ndarray, ...] = (),
    share_values: tuple[float, ...] = (),
    conditionals: tuple[ConditionalMetric, ...] = (),
    group_denominators: dict[PopulationKey, list[int]] | None = None,
    target_limit: float | None = None,
    minimize_replacements: bool = False,
) -> BinarySelection | None:
    row_count = len(scores)
    groups: dict[PopulationKey, list[ConditionalMetric]] = {}
    for metric in conditionals:
        groups.setdefault(metric.population_key, []).append(metric)

    denominators = group_denominators or {
        key: list(range(1, final_count + 1)) for key in groups
    }
    if any(not values for values in denominators.values()):
        return None

    mean_slack_index = row_count
    share_slack_start = mean_slack_index + 1
    conditional_slack_start = share_slack_start + len(share_values)
    selector_start = conditional_slack_start + len(conditionals)
    selector_count = sum(len(values) for values in denominators.values())
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
    if fix_source:
        lower_bounds[:source_count] = 1.0
    upper_bounds[mean_slack_index:selector_start] = np.inf

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

    mean_rhs = target_mean * final_count
    mean_upper = np.zeros(variable_count, dtype=float)
    mean_upper[:row_count] = scores
    mean_upper[mean_slack_index] = -1.0
    constrain(mean_upper, -np.inf, mean_rhs)

    mean_lower = np.zeros(variable_count, dtype=float)
    mean_lower[:row_count] = scores
    mean_lower[mean_slack_index] = 1.0
    constrain(mean_lower, mean_rhs, np.inf)

    for index, (membership, value) in enumerate(
        zip(share_memberships, share_values, strict=True)
    ):
        slack_index = share_slack_start + index
        share_rhs = value * final_count

        share_upper = np.zeros(variable_count, dtype=float)
        share_upper[:row_count] = membership
        share_upper[slack_index] = -1.0
        constrain(share_upper, -np.inf, share_rhs)

        share_lower = np.zeros(variable_count, dtype=float)
        share_lower[:row_count] = membership
        share_lower[slack_index] = 1.0
        constrain(share_lower, share_rhs, np.inf)

    selector_indices: dict[PopulationKey, list[tuple[int, int]]] = {}
    next_selector = selector_start
    for key, values in denominators.items():
        selector_indices[key] = []
        selector_sum = np.zeros(variable_count, dtype=float)
        for denominator in values:
            selector_indices[key].append((denominator, next_selector))
            selector_sum[next_selector] = 1.0
            next_selector += 1
        constrain(selector_sum, 1.0, 1.0)

        denominator_row = np.zeros(variable_count, dtype=float)
        denominator_row[:row_count] = groups[key][0].population
        for denominator, selector_index in selector_indices[key]:
            denominator_row[selector_index] = -float(denominator)
        constrain(denominator_row, 0.0, 0.0)

    big_m = float(final_count)
    for index, metric in enumerate(conditionals):
        slack_index = conditional_slack_start + index
        for denominator, selector_index in selector_indices[metric.population_key]:
            conditional_upper = np.zeros(variable_count, dtype=float)
            conditional_upper[:row_count] = metric.numerator
            conditional_upper[slack_index] = -float(denominator)
            conditional_upper[selector_index] = big_m
            constrain(
                conditional_upper,
                -np.inf,
                metric.value * denominator + big_m,
            )

            conditional_lower = np.zeros(variable_count, dtype=float)
            conditional_lower[:row_count] = -metric.numerator
            conditional_lower[slack_index] = -float(denominator)
            conditional_lower[selector_index] = big_m
            constrain(
                conditional_lower,
                -np.inf,
                -metric.value * denominator + big_m,
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

    return BinarySelection(
        selected_indices=np.flatnonzero(result.x[:row_count] > 0.5),
        target_objective=float(np.dot(target_objective, result.x)),
    )
