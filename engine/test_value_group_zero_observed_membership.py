from __future__ import annotations

import json
import unittest

import pandas as pd

from candidate_selection import CountTarget, ShareTarget, select_for_targets


def _choice(key: str) -> str:
    return json.dumps(
        {
            "state": "answered",
            "value": {"kind": "single_choice", "optionKey": key, "label": key},
        },
        separators=(",", ":"),
    )


class ValueGroupZeroObservedMembershipTest(unittest.TestCase):
    def test_zero_observed_member_counts_for_direct_and_value_group_targets(self) -> None:
        option_a = _choice("A")
        option_b = _choice("B")
        option_c = _choice("C")

        source = pd.DataFrame(
            {
                "score": [3] * 100,
                "choice": [option_a] * 80 + [option_b] * 20,
            }
        )
        candidates = pd.DataFrame(
            {
                "score": [3] * 100,
                "choice": [option_c] * 40 + [option_b] * 60,
            }
        )

        result = select_for_targets(
            source,
            candidates,
            target_column="score",
            final_count=200,
            target_mean=3.0,
            target_min=1,
            target_max=5,
            share_targets=(
                ShareTarget("c-share", "choice", frozenset({option_c}), 0.20),
                ShareTarget("group-share", "choice", frozenset({option_a, option_c}), 0.60),
            ),
            count_targets=(
                CountTarget("c-count", "choice", frozenset({option_c}), 40),
                CountTarget("group-count", "choice", frozenset({option_a, option_c}), 120),
            ),
        )

        shares = {item.id: item for item in result.shares}
        counts = {item.id: item for item in result.counts}
        self.assertEqual(shares["c-share"].numerator_count, 40)
        self.assertEqual(shares["group-share"].numerator_count, 120)
        self.assertAlmostEqual(shares["c-share"].achieved_share, 0.20)
        self.assertAlmostEqual(shares["group-share"].achieved_share, 0.60)
        self.assertEqual(counts["c-count"].achieved_count, 40)
        self.assertEqual(counts["group-count"].achieved_count, 120)
        self.assertEqual(counts["c-count"].absolute_error, 0)
        self.assertEqual(counts["group-count"].absolute_error, 0)


if __name__ == "__main__":
    unittest.main()
