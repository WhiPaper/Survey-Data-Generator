from __future__ import annotations

import unittest

import pandas as pd

from select import ShareTarget, TargetInfeasible, select_for_mean, select_for_targets


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
