from __future__ import annotations

import unittest

import pandas as pd

from candidate_selection import (
    ConditionalShareTarget,
    ShareTarget,
    TargetInfeasible,
    select_for_mean,
    select_for_targets,
)


class MeanSelectionTest(unittest.TestCase):
    def test_selects_exact_representable_mean(self) -> None:
        source = pd.DataFrame({"score": [4, 5]})
        candidates = pd.DataFrame({"score": [4, 5, 5]})

        result = select_for_mean(
            source,
            candidates,
            target_column="score",
            final_count=4,
            target_mean=4.75,
            target_min=1,
            target_max=5,
        )

        self.assertEqual(len(result.selected_indices), 2)
        self.assertAlmostEqual(result.achieved_mean, 4.75)
        self.assertTrue(result.exact_target)

    def test_returns_nearest_integer_row_representation(self) -> None:
        source = pd.DataFrame({"score": [4, 4]})
        candidates = pd.DataFrame({"score": [4, 5]})

        result = select_for_mean(
            source,
            candidates,
            target_column="score",
            final_count=3,
            target_mean=4.5,
            target_min=1,
            target_max=5,
        )

        self.assertAlmostEqual(result.achieved_mean, 13 / 3)
        self.assertAlmostEqual(result.absolute_error, 4.5 - 13 / 3)
        self.assertFalse(result.exact_target)

    def test_selects_mean_and_share_in_one_milp(self) -> None:
        source = pd.DataFrame({"score": [4, 4], "group": ["member", "other"]})
        candidates = pd.DataFrame(
            {
                "score": [5, 5, 4, 4],
                "group": ["member", "other", "member", "other"],
            }
        )

        result = select_for_targets(
            source,
            candidates,
            target_column="score",
            final_count=4,
            target_mean=4.5,
            target_min=1,
            target_max=5,
            share_targets=(
                ShareTarget(
                    id="group-1",
                    column="group",
                    member_values=frozenset({"member"}),
                    value=0.5,
                ),
            ),
        )

        self.assertEqual(len(result.selected_indices), 2)
        self.assertAlmostEqual(result.achieved_mean, 4.5)
        self.assertTrue(result.mean_exact)
        self.assertEqual(len(result.shares), 1)
        self.assertAlmostEqual(result.shares[0].achieved_share, 0.5)
        self.assertAlmostEqual(result.shares[0].absolute_error, 0.0)

    def test_one_checkbox_row_contributes_to_multiple_conditional_targets(self) -> None:
        source = pd.DataFrame(
            {
                "score": [4, 4],
                "population": ["member", "member"],
                "checkbox": ["A", "B"],
            }
        )
        candidates = pd.DataFrame(
            {
                "score": [5, 5, 5, 5],
                "population": ["member", "member", "member", "member"],
                "checkbox": ["AB", "AB", "A", "B"],
            }
        )

        result = select_for_targets(
            source,
            candidates,
            target_column="score",
            final_count=4,
            target_mean=4.5,
            target_min=1,
            target_max=5,
            conditional_share_targets=(
                ConditionalShareTarget(
                    id="option-a",
                    population_column="population",
                    population_member_values=frozenset({"member"}),
                    option_column="checkbox",
                    option_values=frozenset({"A", "AB"}),
                    value=0.75,
                ),
                ConditionalShareTarget(
                    id="option-b",
                    population_column="population",
                    population_member_values=frozenset({"member"}),
                    option_column="checkbox",
                    option_values=frozenset({"B", "AB"}),
                    value=0.75,
                ),
            ),
        )

        self.assertEqual(len(result.selected_indices), 2)
        self.assertEqual(candidates.iloc[result.selected_indices]["checkbox"].tolist(), ["AB", "AB"])
        self.assertEqual(len(result.conditional_shares), 2)
        for achieved in result.conditional_shares:
            self.assertEqual(achieved.numerator_count, 3)
            self.assertEqual(achieved.denominator_count, 4)
            self.assertAlmostEqual(achieved.achieved_share, 0.75)
            self.assertAlmostEqual(achieved.absolute_error, 0.0)

    def test_expands_population_when_that_minimizes_actual_percentage_error(self) -> None:
        source = pd.DataFrame(
            {
                "score": [4] * 5,
                "population": ["member"] * 5,
                "checkbox": ["ABC", "A", "C", "AB", "A"],
            }
        )
        population_candidates = pd.DataFrame(
            {
                "score": [5] * 20,
                "population": ["member"] * 20,
                "checkbox": ["BC"] * 4 + ["B"] * 2 + ["C"] * 2 + ["none"] * 12,
            }
        )
        outside_candidates = pd.DataFrame(
            {
                "score": [5] * 95,
                "population": ["other"] * 95,
                "checkbox": ["none"] * 95,
            }
        )
        candidates = pd.concat([population_candidates, outside_candidates], ignore_index=True)

        result = select_for_targets(
            source,
            candidates,
            target_column="score",
            final_count=100,
            target_mean=4.95,
            target_min=1,
            target_max=5,
            conditional_share_targets=(
                ConditionalShareTarget(
                    id="option-a",
                    population_column="population",
                    population_member_values=frozenset({"member"}),
                    option_column="checkbox",
                    option_values=frozenset({"A", "AB", "ABC"}),
                    value=0.20,
                ),
                ConditionalShareTarget(
                    id="option-b",
                    population_column="population",
                    population_member_values=frozenset({"member"}),
                    option_column="checkbox",
                    option_values=frozenset({"B", "BC", "AB", "ABC"}),
                    value=0.30,
                ),
                ConditionalShareTarget(
                    id="option-c",
                    population_column="population",
                    population_member_values=frozenset({"member"}),
                    option_column="checkbox",
                    option_values=frozenset({"C", "BC", "ABC"}),
                    value=0.30,
                ),
            ),
        )

        self.assertEqual(len(result.selected_indices), 95)
        achieved = {item.id: item for item in result.conditional_shares}
        self.assertEqual(achieved["option-a"].denominator_count, 20)
        self.assertEqual(achieved["option-a"].numerator_count, 4)
        self.assertEqual(achieved["option-b"].numerator_count, 6)
        self.assertEqual(achieved["option-c"].numerator_count, 6)
        self.assertAlmostEqual(achieved["option-a"].absolute_error, 0.0)
        self.assertAlmostEqual(achieved["option-b"].absolute_error, 0.0)
        self.assertAlmostEqual(achieved["option-c"].absolute_error, 0.0)

    def test_rejects_mean_outside_question_range(self) -> None:
        with self.assertRaises(TargetInfeasible) as raised:
            select_for_mean(
                pd.DataFrame({"score": [4, 5]}),
                pd.DataFrame({"score": [5, 5]}),
                target_column="score",
                final_count=4,
                target_mean=5.5,
                target_min=1,
                target_max=5,
            )

        self.assertEqual(raised.exception.code, "mean_out_of_range")


if __name__ == "__main__":
    unittest.main()
