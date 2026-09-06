from __future__ import annotations

import unittest

import pandas as pd

from replacement import plan_replacements
from candidate_selection import ConditionalShareTarget, ShareTarget


class ReplacementPlanningTest(unittest.TestCase):
    def test_returns_not_required_when_append_only_is_already_best(self) -> None:
        source = pd.DataFrame({"score": [4, 4]})
        candidates = pd.DataFrame({"score": [5, 5, 4]})

        plan = plan_replacements(
            source,
            candidates,
            target_column="score",
            final_count=4,
            target_mean=4.5,
            target_min=1,
            target_max=5,
        )

        self.assertEqual(plan.status, "not_required")
        self.assertEqual(plan.replacement_count, 0)
        self.assertEqual(len(plan.addition_candidate_indices), 2)
        self.assertIsNone(plan.replacement_outcome)

    def test_minimizes_replaced_source_rows_for_mean_target(self) -> None:
        source = pd.DataFrame({"score": [5, 5, 5]})
        candidates = pd.DataFrame({"score": [1, 1, 1, 5]})

        plan = plan_replacements(
            source,
            candidates,
            target_column="score",
            final_count=4,
            target_mean=3.0,
            target_min=1,
            target_max=5,
        )

        self.assertEqual(plan.status, "available")
        self.assertEqual(plan.replacement_count, 1)
        self.assertEqual(len(plan.proposed_replacements), 1)
        self.assertEqual(len(plan.addition_candidate_indices), 1)
        self.assertIsNotNone(plan.replacement_outcome)
        assert plan.replacement_outcome is not None
        self.assertAlmostEqual(plan.replacement_outcome.achieved_mean, 3.0)
        self.assertAlmostEqual(plan.replacement_outcome.mean_absolute_error, 0.0)
        self.assertGreater(plan.append_only_outcome.mean_absolute_error, 0.0)

    def test_minimizes_replacement_for_share_target(self) -> None:
        source = pd.DataFrame(
            {
                "score": [4, 4, 4],
                "group": ["member", "member", "other"],
            }
        )
        candidates = pd.DataFrame(
            {
                "score": [4, 4, 4, 4, 4],
                "group": ["other", "other", "other", "member", "member"],
            }
        )

        plan = plan_replacements(
            source,
            candidates,
            target_column="score",
            final_count=4,
            target_mean=4.0,
            target_min=1,
            target_max=5,
            share_targets=(
                ShareTarget(
                    id="group",
                    column="group",
                    member_values=frozenset({"member"}),
                    value=0.25,
                ),
            ),
        )

        self.assertEqual(plan.status, "available")
        self.assertEqual(plan.replacement_count, 1)
        assert plan.replacement_outcome is not None
        self.assertAlmostEqual(plan.replacement_outcome.shares[0].achieved_share, 0.25)
        self.assertAlmostEqual(plan.replacement_outcome.shares[0].absolute_error, 0.0)

    def test_replacement_preserves_conditional_denominator_semantics(self) -> None:
        source = pd.DataFrame(
            {
                "score": [4, 4, 4],
                "population": ["member", "member", "member"],
                "checkbox": ["A", "A", "none"],
            }
        )
        candidates = pd.DataFrame(
            {
                "score": [4, 4, 4, 4, 4],
                "population": ["member", "member", "member", "member", "member"],
                "checkbox": ["none", "none", "none", "none", "none"],
            }
        )

        plan = plan_replacements(
            source,
            candidates,
            target_column="score",
            final_count=4,
            target_mean=4.0,
            target_min=1,
            target_max=5,
            conditional_share_targets=(
                ConditionalShareTarget(
                    id="option-a",
                    population_column="population",
                    population_member_values=frozenset({"member"}),
                    option_column="checkbox",
                    option_values=frozenset({"A"}),
                    value=0.25,
                ),
            ),
        )

        self.assertEqual(plan.status, "available")
        self.assertEqual(plan.replacement_count, 1)
        assert plan.replacement_outcome is not None
        achieved = plan.replacement_outcome.conditional_shares[0]
        self.assertEqual(achieved.numerator_count, 1)
        self.assertEqual(achieved.denominator_count, 4)
        self.assertAlmostEqual(achieved.achieved_share, 0.25)
        self.assertAlmostEqual(achieved.absolute_error, 0.0)


if __name__ == "__main__":
    unittest.main()
