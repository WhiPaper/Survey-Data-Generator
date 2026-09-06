from __future__ import annotations

import json
import unittest

import pandas as pd

from generate import ConditionalCandidateSupport, ShareCandidateSupport, generate_candidates
from candidate_selection import ConditionalShareTarget, ShareTarget, select_for_targets


def _slot(value: dict[str, object]) -> str:
    return json.dumps(
        {"state": "answered", "value": value},
        ensure_ascii=False,
        separators=(",", ":"),
    )


class ZeroObservedStructuredOptionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.population = _slot(
            {"kind": "single_choice", "optionKey": "P", "label": "서울"}
        )
        self.option_a = _slot(
            {"kind": "multi_choice", "optionKeys": ["A"], "labels": ["공연"]}
        )
        self.option_b = _slot(
            {"kind": "multi_choice", "optionKeys": ["B"], "labels": ["먹거리"]}
        )
        self.source = pd.DataFrame(
            {
                "response_id": [f"source-{index + 1}" for index in range(20)],
                "score": [2, 4] * 10,
                "population": [self.population] * 20,
                "checkbox": [self.option_b] * 20,
                "segment": ["left", "right"] * 10,
            }
        )

    def test_schema_backed_unseen_unconditional_share_enters_pool_and_can_satisfy_target(self) -> None:
        pool = generate_candidates(
            self.source,
            id_column="response_id",
            target_column="score",
            target_min=1,
            target_max=5,
            target_score_counts={2: 5, 4: 5},
            pool_size=40,
            seed=20260906,
            categorical_columns=["population", "checkbox", "segment"],
            share_support=ShareCandidateSupport(
                column="checkbox",
                member_values=frozenset({self.option_a}),
                synthetic_member_count=10,
                synthetic_nonmember_count=0,
            ),
        )

        self.assertIn(self.option_a, set(pool.data["checkbox"]))
        self.assertTrue(set(pool.data["checkbox"]) <= {self.option_a, self.option_b})
        self.assertTrue(set(pool.data["segment"]) <= {"left", "right"})

        selection = select_for_targets(
            self.source,
            pool.data,
            target_column="score",
            final_count=30,
            target_mean=3.0,
            target_min=1,
            target_max=5,
            share_targets=(
                ShareTarget(
                    id="option-A-share",
                    column="checkbox",
                    member_values=frozenset({self.option_a}),
                    value=1 / 3,
                ),
            ),
        )
        achieved = selection.shares[0]
        self.assertAlmostEqual(selection.achieved_mean, 3.0)
        self.assertAlmostEqual(achieved.achieved_share, 1 / 3)
        self.assertAlmostEqual(achieved.absolute_error, 0.0)

    def test_schema_backed_unseen_option_enters_pool_and_can_satisfy_target(self) -> None:
        pool = generate_candidates(
            self.source,
            id_column="response_id",
            target_column="score",
            target_min=1,
            target_max=5,
            target_score_counts={2: 5, 4: 5},
            pool_size=40,
            seed=20260906,
            categorical_columns=["population", "checkbox", "segment"],
            conditional_supports=(
                ConditionalCandidateSupport(
                    id="option-A",
                    population_column="population",
                    population_member_values=frozenset({self.population}),
                    option_column="checkbox",
                    option_values=frozenset({self.option_a}),
                    target_value=1 / 3,
                    schema_option_values=frozenset({self.option_a}),
                ),
            ),
        )

        self.assertIn(self.option_a, set(pool.data["checkbox"]))
        self.assertTrue(set(pool.data["checkbox"]) <= {self.option_a, self.option_b})
        self.assertTrue(set(pool.data["segment"]) <= {"left", "right"})

        selection = select_for_targets(
            self.source,
            pool.data,
            target_column="score",
            final_count=30,
            target_mean=3.0,
            target_min=1,
            target_max=5,
            conditional_share_targets=(
                ConditionalShareTarget(
                    id="option-A",
                    population_column="population",
                    population_member_values=frozenset({self.population}),
                    option_column="checkbox",
                    option_values=frozenset({self.option_a}),
                    value=1 / 3,
                ),
            ),
        )
        achieved = selection.conditional_shares[0]
        self.assertAlmostEqual(selection.achieved_mean, 3.0)
        self.assertEqual(achieved.numerator_count, 10)
        self.assertEqual(achieved.denominator_count, 30)
        self.assertAlmostEqual(achieved.achieved_share, 1 / 3)
        self.assertAlmostEqual(achieved.absolute_error, 0.0)

    def test_unseen_categorical_value_still_requires_explicit_schema_support(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "conditional option support is outside observed or schema-backed support",
        ):
            generate_candidates(
                self.source,
                id_column="response_id",
                target_column="score",
                target_min=1,
                target_max=5,
                target_score_counts={2: 1, 4: 1},
                pool_size=20,
                seed=20260906,
                categorical_columns=["population", "checkbox", "segment"],
                conditional_supports=(
                    ConditionalCandidateSupport(
                        id="option-A",
                        population_column="population",
                        population_member_values=frozenset({self.population}),
                        option_column="checkbox",
                        option_values=frozenset({self.option_a}),
                        target_value=0.5,
                    ),
                ),
            )

    def test_unseen_raw_share_value_is_not_treated_as_schema_backed(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "share support outside observed source support must be schema-backed AnswerSlots",
        ):
            generate_candidates(
                self.source,
                id_column="response_id",
                target_column="score",
                target_min=1,
                target_max=5,
                target_score_counts={2: 1, 4: 1},
                pool_size=20,
                seed=20260906,
                categorical_columns=["population", "checkbox", "segment"],
                share_support=ShareCandidateSupport(
                    column="segment",
                    member_values=frozenset({"unseen-text"}),
                    synthetic_member_count=1,
                    synthetic_nonmember_count=9,
                ),
            )


if __name__ == "__main__":
    unittest.main()
