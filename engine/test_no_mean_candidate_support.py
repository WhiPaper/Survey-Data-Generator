from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import pandas as pd

from candidate_selection import (
    ConditionalShareTarget,
    CountTarget,
    ShareTarget,
    select_for_targets,
)
from generate import (
    ConditionalCandidateSupport,
    ShareCandidateSupport,
    generate_candidates,
)


NO_MEAN_COLUMN = "__no_mean_score"


class _Condition:
    def __init__(self, *, num_rows: int, column_values: dict[str, object]) -> None:
        self.num_rows = num_rows
        self.column_values = column_values


class _DeterministicSynthesizer:
    """Makes directed support deterministic and leaves undirected samples on row 0."""

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        self.model_data: pd.DataFrame | None = None

    def fit(self, model_data: pd.DataFrame) -> None:
        self.model_data = model_data.reset_index(drop=True).copy()

    def sample(self, *, num_rows: int) -> pd.DataFrame:
        assert self.model_data is not None
        return pd.concat([self.model_data.iloc[[0]]] * num_rows, ignore_index=True)

    def sample_from_conditions(self, conditions: list[_Condition]) -> pd.DataFrame:
        assert len(conditions) == 1
        condition = conditions[0]
        sampled = self.sample(num_rows=condition.num_rows)
        for column, value in condition.column_values.items():
            sampled[column] = value
        return sampled


def _slot(value: dict[str, object]) -> str:
    return json.dumps(
        {"state": "answered", "value": value},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _with_no_mean(source: pd.DataFrame) -> pd.DataFrame:
    data = source.copy()
    data[NO_MEAN_COLUMN] = 0
    return data


def _generate(
    source: pd.DataFrame,
    *,
    categorical_columns: list[str],
    share_supports: tuple[ShareCandidateSupport, ...] = (),
    conditional_supports: tuple[ConditionalCandidateSupport, ...] = (),
    additions: int = 5,
) -> pd.DataFrame:
    with (
        patch("generate._build_metadata", return_value=(object(), {})),
        patch("generate.Condition", _Condition),
        patch("generate.GaussianCopulaSynthesizer", _DeterministicSynthesizer),
    ):
        pool = generate_candidates(
            source,
            id_column="response_id",
            target_column=NO_MEAN_COLUMN,
            target_min=0,
            target_max=0,
            target_score_counts={0: additions},
            pool_size=20,
            seed=20260907,
            categorical_columns=categorical_columns,
            share_supports=share_supports,
            conditional_supports=conditional_supports,
        )
    return pool.data


def _select(
    source: pd.DataFrame,
    candidates: pd.DataFrame,
    *,
    share_targets: tuple[ShareTarget, ...] = (),
    count_targets: tuple[CountTarget, ...] = (),
    conditional_targets: tuple[ConditionalShareTarget, ...] = (),
    additions: int = 5,
):
    return select_for_targets(
        source,
        candidates,
        target_column=NO_MEAN_COLUMN,
        final_count=len(source) + additions,
        target_mean=0.0,
        target_min=0,
        target_max=0,
        share_targets=share_targets,
        count_targets=count_targets,
        conditional_share_targets=conditional_targets,
        primary_mean_id="__no_mean__",
    )


class NoMeanCandidateSupportRegressionTest(unittest.TestCase):
    def test_no_mean_observed_option_share_increase_gets_directed_support(self) -> None:
        option_a = _slot({"kind": "single_choice", "optionKey": "A", "label": "A"})
        option_b = _slot({"kind": "single_choice", "optionKey": "B", "label": "B"})
        source = _with_no_mean(
            pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(10)],
                    "choice": [option_b] * 9 + [option_a],
                }
            )
        )
        target = ShareTarget("share-A", "choice", frozenset({option_a}), 6 / 15)
        candidates = _generate(
            source,
            categorical_columns=["choice"],
            share_supports=(
                ShareCandidateSupport(
                    column="choice",
                    member_values=frozenset({option_a}),
                    synthetic_member_count=5,
                    synthetic_nonmember_count=0,
                ),
            ),
        )

        selection = _select(source, candidates, share_targets=(target,))

        self.assertGreaterEqual(int((candidates["choice"] == option_a).sum()), 5)
        self.assertAlmostEqual(selection.shares[0].achieved_share, 6 / 15)
        self.assertAlmostEqual(selection.shares[0].absolute_error, 0.0)

    def test_no_mean_zero_observed_structured_option_share_gets_schema_support(self) -> None:
        option_a = _slot({"kind": "single_choice", "optionKey": "A", "label": "A"})
        option_b = _slot({"kind": "single_choice", "optionKey": "B", "label": "B"})
        source = _with_no_mean(
            pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(10)],
                    "choice": [option_b] * 10,
                }
            )
        )
        target = ShareTarget("share-A", "choice", frozenset({option_a}), 5 / 15)
        candidates = _generate(
            source,
            categorical_columns=["choice"],
            share_supports=(
                ShareCandidateSupport(
                    column="choice",
                    member_values=frozenset({option_a}),
                    synthetic_member_count=5,
                    synthetic_nonmember_count=0,
                ),
            ),
        )

        selection = _select(source, candidates, share_targets=(target,))

        self.assertIn(option_a, set(candidates["choice"]))
        self.assertAlmostEqual(selection.shares[0].achieved_share, 5 / 15)
        self.assertAlmostEqual(selection.shares[0].absolute_error, 0.0)

    def test_no_mean_exact_count_gets_synthetic_member_support(self) -> None:
        source = _with_no_mean(
            pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(10)],
                    "count_group": ["other"] * 9 + ["member"],
                }
            )
        )
        target = CountTarget("count-member", "count_group", frozenset({"member"}), 6)
        candidates = _generate(
            source,
            categorical_columns=["count_group"],
            share_supports=(
                ShareCandidateSupport(
                    column="count_group",
                    member_values=frozenset({"member"}),
                    synthetic_member_count=5,
                    synthetic_nonmember_count=0,
                ),
            ),
        )

        selection = _select(source, candidates, count_targets=(target,))

        self.assertGreaterEqual(int((candidates["count_group"] == "member").sum()), 5)
        self.assertEqual(selection.counts[0].achieved_count, 6)
        self.assertEqual(selection.counts[0].absolute_error, 0)

    def test_no_mean_conditional_share_gets_directed_joint_support(self) -> None:
        source = _with_no_mean(
            pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(10)],
                    "population": ["O"] * 6 + ["P"] * 4,
                    "checkbox": ["B"] * 6 + ["A", "B", "B", "B"],
                }
            )
        )
        target = ConditionalShareTarget(
            "conditional-A",
            "population",
            frozenset({"P"}),
            "checkbox",
            frozenset({"A"}),
            2 / 3,
        )
        candidates = _generate(
            source,
            categorical_columns=["population", "checkbox"],
            conditional_supports=(
                ConditionalCandidateSupport(
                    id="conditional-A",
                    population_column="population",
                    population_member_values=frozenset({"P"}),
                    option_column="checkbox",
                    option_values=frozenset({"A"}),
                    target_value=2 / 3,
                ),
            ),
        )

        selection = _select(source, candidates, conditional_targets=(target,))

        self.assertGreaterEqual(
            int(((candidates["population"] == "P") & (candidates["checkbox"] == "A")).sum()),
            5,
        )
        self.assertAlmostEqual(selection.conditional_shares[0].achieved_share, 2 / 3)
        self.assertAlmostEqual(selection.conditional_shares[0].absolute_error, 0.0)

    def test_no_mean_multiple_shares_count_and_conditional_solve_together(self) -> None:
        source = _with_no_mean(
            pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(10)],
                    "share_one": ["B", "B", "B", "B", "B", "B", "B", "B", "B", "A"],
                    "share_two": ["X", "N", "N", "N", "N", "N", "N", "N", "N", "N"],
                    "count_group": ["member", "other", "other", "other", "other", "other", "other", "other", "other", "other"],
                    "population": ["P", "O", "O", "O", "O", "O", "P", "P", "P", "O"],
                    "checkbox": ["A", "B", "B", "B", "B", "B", "B", "B", "B", "B"],
                }
            )
        )
        share_targets = (
            ShareTarget("share-one", "share_one", frozenset({"A"}), 6 / 15),
            ShareTarget("share-two", "share_two", frozenset({"X"}), 6 / 15),
        )
        count_target = CountTarget("count-member", "count_group", frozenset({"member"}), 6)
        conditional_target = ConditionalShareTarget(
            "conditional-A",
            "population",
            frozenset({"P"}),
            "checkbox",
            frozenset({"A"}),
            2 / 3,
        )
        candidates = _generate(
            source,
            categorical_columns=[
                "share_one",
                "share_two",
                "count_group",
                "population",
                "checkbox",
            ],
            share_supports=(
                ShareCandidateSupport("share_one", frozenset({"A"}), 5, 0),
                ShareCandidateSupport("share_two", frozenset({"X"}), 5, 0),
                ShareCandidateSupport("count_group", frozenset({"member"}), 5, 0),
            ),
            conditional_supports=(
                ConditionalCandidateSupport(
                    id="conditional-A",
                    population_column="population",
                    population_member_values=frozenset({"P"}),
                    option_column="checkbox",
                    option_values=frozenset({"A"}),
                    target_value=2 / 3,
                ),
            ),
        )

        selection = _select(
            source,
            candidates,
            share_targets=share_targets,
            count_targets=(count_target,),
            conditional_targets=(conditional_target,),
        )

        self.assertTrue(all(item.absolute_error == 0 for item in selection.shares))
        self.assertEqual(selection.counts[0].absolute_error, 0)
        self.assertAlmostEqual(selection.conditional_shares[0].absolute_error, 0.0)


if __name__ == "__main__":
    unittest.main()
