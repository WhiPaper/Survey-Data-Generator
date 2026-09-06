from __future__ import annotations

import unittest

import numpy as np

from selection_solver import solve_binary_selection


class TargetContractSolverSemanticsTest(unittest.TestCase):
    def test_mean_uses_answered_denominator_instead_of_final_count(self) -> None:
        solution = solve_binary_selection(
            scores=np.array([[5.0], [0.0], [1.0]]),
            final_count=2,
            target_means=(3.0,),
            mean_denominators=(np.array([1.0, 0.0, 1.0]),),
            mean_ranges=(4.0,),
            source_count=0,
            fix_source=False,
        )

        self.assertIsNotNone(solution)
        assert solution is not None
        self.assertEqual(set(solution.selected_indices.tolist()), {0, 2})
        self.assertAlmostEqual(solution.target_objective, 0.0)

    def test_share_excludes_ineligible_rows_from_denominator(self) -> None:
        solution = solve_binary_selection(
            scores=np.empty((3, 0)),
            final_count=2,
            target_means=(),
            share_memberships=(np.array([1.0, 0.0, 0.0]),),
            share_denominators=(np.array([1.0, 0.0, 1.0]),),
            share_values=(1.0,),
            source_count=0,
            fix_source=False,
        )

        self.assertIsNotNone(solution)
        assert solution is not None
        self.assertEqual(set(solution.selected_indices.tolist()), {0, 1})
        self.assertAlmostEqual(solution.target_objective, 0.0)

    def test_mean_errors_are_normalized_by_allowed_range(self) -> None:
        solution = solve_binary_selection(
            scores=np.array([[2.0, 0.0], [0.0, 0.5]]),
            final_count=1,
            target_means=(0.0, 0.0),
            mean_denominators=(np.ones(2), np.ones(2)),
            mean_ranges=(10.0, 1.0),
            source_count=0,
            fix_source=False,
        )

        self.assertIsNotNone(solution)
        assert solution is not None
        self.assertEqual(solution.selected_indices.tolist(), [0])
        self.assertAlmostEqual(solution.target_objective, 0.2)

    def test_count_target_is_exact_and_has_no_nearest_fallback(self) -> None:
        solution = solve_binary_selection(
            scores=np.empty((2, 0)),
            final_count=2,
            target_means=(),
            count_memberships=(np.array([1.0, 0.0]),),
            count_values=(2,),
            source_count=0,
            fix_source=False,
        )

        self.assertIsNone(solution)


if __name__ == "__main__":
    unittest.main()
