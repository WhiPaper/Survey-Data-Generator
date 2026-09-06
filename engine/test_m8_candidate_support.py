from __future__ import annotations

import unittest

import pandas as pd

from generate import generate_candidates
from replacement import plan_replacements
from candidate_selection import select_for_targets


class CandidateSupportRegenerationTest(unittest.TestCase):
    def test_preserves_observed_scores_for_replacement_when_append_only_needs_no_rows(self) -> None:
        source = pd.DataFrame(
            {
                "response_id": [f"source-{index + 1}" for index in range(5)],
                "score": [5, 5, 5, 5, 1],
                "segment": ["A", "B", "A", "B", "A"],
            }
        )

        pool = generate_candidates(
            source,
            id_column="response_id",
            target_column="score",
            target_min=1,
            target_max=5,
            target_score_counts={},
            pool_size=20,
            seed=20260906,
            categorical_columns=["segment"],
        )
        generated_scores = set(pd.to_numeric(pool.data["score"], errors="raise").astype(int))
        self.assertTrue({1, 5} <= generated_scores)
        self.assertTrue(set(pool.data["segment"]) <= {"A", "B"})

        append_only = select_for_targets(
            source,
            pool.data,
            target_column="score",
            final_count=5,
            target_mean=3.4,
            target_min=1,
            target_max=5,
        )
        self.assertEqual(append_only.selected_indices.tolist(), [])
        self.assertAlmostEqual(append_only.achieved_mean, 4.2)

        plan = plan_replacements(
            source,
            pool.data,
            target_column="score",
            final_count=5,
            target_mean=3.4,
            target_min=1,
            target_max=5,
            append_only_outcome=append_only,
        )
        self.assertEqual(plan.status, "available")
        self.assertEqual(plan.replacement_count, 1)
        self.assertIsNotNone(plan.replacement_outcome)
        assert plan.replacement_outcome is not None
        self.assertAlmostEqual(plan.replacement_outcome.achieved_mean, 3.4)
        self.assertAlmostEqual(plan.replacement_outcome.mean_absolute_error, 0.0)


if __name__ == "__main__":
    unittest.main()
